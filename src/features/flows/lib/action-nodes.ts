import type { SupabaseClient } from '@supabase/supabase-js';

import { isDeliverableUrl } from '@/features/webhooks/lib/ssrf';
import { sendChannelMessage } from '@/features/admin/lib/orchestration/outbound';
import { engineSendTemplate } from './meta-send';
import type {
  AssignConversationNodeConfig,
  CreateDealNodeConfig,
  FlowNodeRow,
  FlowRunRow,
  SendTemplateNodeConfig,
  SendWebhookNodeConfig,
  UpdateContactFieldNodeConfig,
  WaitNodeConfig,
} from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = SupabaseClient<any, 'public', any>;

/**
 * Result of executing an absorbed action node.
 *
 * - `advance`  → continue the in-memory advance loop at next_node_key.
 * - `suspend`  → the run was parked (wait node set wake_at); the cron
 *                sweep resumes it later. Loop must return immediately.
 * - `fail`     → the node raised a fatal error; caller ends the run.
 */
export type ActionNodeResult =
  | { kind: 'advance'; next_node_key: string; detail: string }
  | { kind: 'suspend'; detail: string }
  | { kind: 'fail'; reason: string; detail: string };

/**
 * Interpolates {{vars.X}} and {{message.text}} placeholders. The
 * message text is mirrored into vars.__message_text by the dispatcher
 * so action nodes need only the run row — no extra plumbing.
 */
export function interpolateActionTemplate(
  template: string,
  vars: Record<string, unknown>
): string {
  if (!template) return '';
  return template
    .replace(/\{\{vars\.([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => {
      const v = vars[key];
      return v === undefined || v === null ? '' : String(v);
    })
    .replace(/\{\{message\.text\}\}/g, () => {
      const v = vars.__message_text;
      return v === undefined || v === null ? '' : String(v);
    });
}

/**
 * Executes one absorbed automation-action node for a flow run.
 *
 * Design notes (production hardening carried over from the retired
 * automations engine):
 * - Every branch is account-scoped (service-role client bypasses RLS,
 *   so tenancy is enforced explicitly on each write).
 * - `send_webhook` is SSRF-guarded, never follows redirects, and is
 *   bounded by a 10s timeout. Stored-connection secrets are injected
 *   server-side and never appear in node config or run events.
 * - Non-messaging failures (tag/field writes) are surfaced as `fail`
 *   only when the node cannot advance at all; callers decide whether
 *   that ends the run.
 */
export async function executeActionNode(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow
): Promise<ActionNodeResult> {
  try {
    switch (node.node_type) {
      case 'send_template': {
        const cfg = node.config as unknown as SendTemplateNodeConfig;
        if (!run.contact_id || !run.conversation_id) {
          return fail('send_template_no_target', 'run has no conversation');
        }
        if (!cfg.template_name) {
          return fail('send_template_no_name', 'template_name missing');
        }
        // Positional params in strict numeric order — lexicographic
        // sort would scramble templates with 10+ variables.
        const params = cfg.variables
          ? Object.keys(cfg.variables)
              .sort((a, b) => Number(a) - Number(b))
              .map((k) => String(cfg.variables![k]))
          : [];
        if ((cfg.template_provider ?? 'meta') === 'twilio') {
          const { data: template, error } = await db
            .from('message_templates')
            .select('id,status,twilio_content_sid')
            .eq('account_id', run.account_id)
            .eq('provider', 'twilio')
            .eq('name', cfg.template_name)
            .eq('language', cfg.language)
            .maybeSingle();
          if (error || !template) {
            return fail('send_template_missing', 'Twilio template not found');
          }
          if (template.status !== 'APPROVED' || !template.twilio_content_sid) {
            return fail('send_template_unapproved', 'template not approved');
          }
          const sent = await sendChannelMessage({
            accountId: run.account_id,
            conversationId: run.conversation_id,
            contactId: run.contact_id,
            payload: {
              kind: 'template',
              templateName: cfg.template_name,
              language: cfg.language || 'en_US',
              contentSid: template.twilio_content_sid,
              contentVariables: Object.fromEntries(
                params.map((value, i) => [String(i + 1), value])
              ),
            },
            strictProviderSupport: true,
            senderType: 'bot',
          });
          return advance(cfg.next_node_key, `twilio ${sent.externalMessageId}`);
        }
        const { whatsapp_message_id } = await engineSendTemplate({
          accountId: run.account_id,
          userId: run.user_id,
          conversationId: run.conversation_id,
          contactId: run.contact_id,
          templateName: cfg.template_name,
          language: cfg.language,
          params,
        });
        return advance(cfg.next_node_key, `meta ${whatsapp_message_id}`);
      }

      case 'update_contact_field': {
        const cfg = node.config as unknown as UpdateContactFieldNodeConfig;
        if (!run.contact_id) {
          return fail('update_field_no_contact', 'run has no contact');
        }
        const value = interpolateActionTemplate(cfg.value, run.vars);
        if (cfg.field.startsWith('custom:')) {
          const customFieldId = cfg.field.slice('custom:'.length);
          // Defense in depth: confirm the field belongs to this account
          // before the service-role write.
          const { data: field } = await db
            .from('custom_fields')
            .select('id')
            .eq('id', customFieldId)
            .eq('account_id', run.account_id)
            .maybeSingle();
          if (!field) {
            return advance(cfg.next_node_key, 'field not writable — skipped');
          }
          await db.from('contact_custom_values').upsert(
            {
              contact_id: run.contact_id,
              custom_field_id: customFieldId,
              value,
            },
            { onConflict: 'contact_id,custom_field_id' }
          );
          return advance(cfg.next_node_key, 'custom field updated');
        }
        const allowed = new Set(['name', 'email', 'company']);
        if (!allowed.has(cfg.field)) {
          return advance(cfg.next_node_key, `field ${cfg.field} skipped`);
        }
        await db
          .from('contacts')
          .update({ [cfg.field]: value, updated_at: new Date().toISOString() })
          .eq('id', run.contact_id)
          .eq('account_id', run.account_id);
        return advance(cfg.next_node_key, `${cfg.field} updated`);
      }

      case 'assign_conversation': {
        const cfg = node.config as unknown as AssignConversationNodeConfig;
        if (!run.conversation_id) {
          return advance(cfg.next_node_key, 'no conversation — skipped');
        }
        let agentId = cfg.agent_id;
        if (cfg.mode === 'round_robin') {
          // True round-robin: pick the active member with the fewest
          // open assigned conversations (ties broken by user_id for
          // determinism). One indexed aggregate query.
          const { data: candidates } = await db.rpc(
            'pick_round_robin_agent',
            { p_account_id: run.account_id }
          );
          agentId =
            (candidates as { user_id: string }[] | null)?.[0]?.user_id ??
            undefined;
          if (!agentId) {
            // Fallback: any active member, so assignment still works on
            // accounts where the RPC hasn't been created yet.
            const { data: profiles } = await db
              .from('profiles')
              .select('user_id')
              .eq('account_id', run.account_id)
              .eq('status', 'active')
              .limit(1);
            agentId = profiles?.[0]?.user_id;
          }
        }
        if (!agentId) {
          return advance(cfg.next_node_key, 'no agent resolved — skipped');
        }
        await db
          .from('conversations')
          .update({ assigned_agent_id: agentId })
          .eq('id', run.conversation_id)
          .eq('account_id', run.account_id);
        return advance(cfg.next_node_key, `assigned ${agentId}`);
      }

      case 'create_deal': {
        const cfg = node.config as unknown as CreateDealNodeConfig;
        if (!cfg.pipeline_id || !cfg.stage_id) {
          return fail('create_deal_config', 'pipeline/stage missing');
        }
        const { data: acct } = await db
          .from('accounts')
          .select('default_currency')
          .eq('id', run.account_id)
          .maybeSingle();
        await db.from('deals').insert({
          account_id: run.account_id,
          user_id: run.user_id,
          pipeline_id: cfg.pipeline_id,
          stage_id: cfg.stage_id,
          contact_id: run.contact_id,
          title: interpolateActionTemplate(cfg.title, run.vars),
          value: cfg.value ?? 0,
          currency: acct?.default_currency ?? 'USD',
          status: 'open',
        });
        return advance(cfg.next_node_key, 'deal created');
      }

      case 'send_webhook': {
        const cfg = node.config as unknown as SendWebhookNodeConfig;
        if (!cfg.url) return fail('send_webhook_config', 'url missing');
        // SSRF guard — refuse private/loopback/link-local destinations.
        if (!(await isDeliverableUrl(cfg.url))) {
          return fail('send_webhook_ssrf', 'destination not allowed');
        }
        const headers: Record<string, string> = {
          'content-type': 'application/json',
          ...(cfg.headers ?? {}),
        };
        // Stored connection: inject the secret header server-side so
        // credentials never live in node config or event payloads.
        if (cfg.connection_id) {
          const { data: conn } = await db
            .from('workflow_connections')
            .select('auth_header_name, auth_header_value')
            .eq('id', cfg.connection_id)
            .eq('account_id', run.account_id)
            .maybeSingle();
          if (conn?.auth_header_name && conn.auth_header_value) {
            headers[conn.auth_header_name] = conn.auth_header_value;
          }
        }
        const body = cfg.body_template
          ? interpolateActionTemplate(cfg.body_template, run.vars)
          : JSON.stringify({
              flow_run_id: run.id,
              contact_id: run.contact_id,
              conversation_id: run.conversation_id,
              vars: run.vars,
            });
        const res = await fetch(cfg.url, {
          method: 'POST',
          headers,
          body,
          // Never follow redirects — a public URL could 3xx-bounce to
          // an internal address, defeating the SSRF guard.
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          return fail('send_webhook_status', `webhook returned ${res.status}`);
        }
        return advance(cfg.next_node_key, `webhook ${res.status}`);
      }

      case 'close_conversation': {
        const cfg = node.config as unknown as {
          next_node_key: string;
        };
        if (run.conversation_id) {
          await db
            .from('conversations')
            .update({ status: 'closed', updated_at: new Date().toISOString() })
            .eq('id', run.conversation_id)
            .eq('account_id', run.account_id);
        }
        return advance(cfg.next_node_key, 'conversation closed');
      }

      case 'wait': {
        const cfg = node.config as unknown as WaitNodeConfig;
        const ms = waitMs(cfg);
        const wakeAt = new Date(Date.now() + ms).toISOString();
        // Park the run: status 'waiting' + wake_at. The cron sweep
        // (flows/cron) resumes it and advances to next_node_key. The
        // current_node_key stays on the wait node so resume knows where
        // to continue from.
        const { error } = await db
          .from('flow_runs')
          .update({
            status: 'waiting',
            wake_at: wakeAt,
            current_node_key: node.node_key,
            last_advanced_at: new Date().toISOString(),
          })
          .eq('id', run.id)
          .eq('status', 'active');
        if (error) {
          return fail('wait_park_failed', error.message);
        }
        return { kind: 'suspend', detail: `sleeping until ${wakeAt}` };
      }

      default:
        return fail('not_action_node', `unhandled: ${node.node_type}`);
    }
  } catch (err) {
    return fail(
      `${node.node_type}_threw`,
      err instanceof Error ? err.message : String(err)
    );
  }
}

/** True when the node type is one of the absorbed action nodes. */
export function isActionNodeType(nodeType: string): boolean {
  return ACTION_NODE_TYPES.has(nodeType);
}

const ACTION_NODE_TYPES = new Set([
  'send_template',
  'update_contact_field',
  'assign_conversation',
  'create_deal',
  'send_webhook',
  'close_conversation',
  'wait',
]);

function advance(next: string, detail: string): ActionNodeResult {
  return { kind: 'advance', next_node_key: next, detail };
}

function fail(reason: string, detail: string): ActionNodeResult {
  return { kind: 'fail', reason, detail };
}

function waitMs(cfg: WaitNodeConfig): number {
  const amount = Math.max(1, Math.min(cfg.amount || 1, 10_000));
  switch (cfg.unit) {
    case 'minutes':
      return amount * 60_000;
    case 'hours':
      return amount * 3_600_000;
    case 'days':
      return amount * 86_400_000;
    default:
      return 60_000;
  }
}
