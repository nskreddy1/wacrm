/**
 * Save-time validation for flows.
 *
 * Run before activation (not on every draft save) — drafts are
 * intentionally allowed to be incomplete so users can save progress
 * mid-build. The builder calls these from BOTH client (so the user
 * sees issues live) and server (so a broken POST/PUT can't slip in
 * via direct API call).
 *
 * Three rule categories:
 *   1. Trigger sanity — keyword flows need keywords, etc.
 *   2. Graph integrity — entry node exists, all next_node_key
 *      references resolve, no unreachable nodes, non-terminal nodes
 *      have an outgoing edge.
 *   3. Meta API limits — button title ≤20 chars, ≤3 buttons per
 *      send_buttons, ≤10 list rows total, ≤24 chars per list row
 *      title. Mirrors the runtime checks inside
 *      `src/lib/whatsapp/meta-api.ts` so save-time and send-time
 *      can never disagree.
 *
 * Issues carry enough field info that the builder can highlight the
 * exact input that triggered them. Node-scoped issues include
 * `node_key`; trigger-scoped use `scope: 'trigger'`.
 */

import { INTERACTIVE_LIMITS } from '@/features/whatsapp/lib/meta-api';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  scope: 'flow' | 'trigger' | 'node';
  /** Stable node_key the issue is attached to, when scope === 'node'. */
  node_key?: string;
  /** Dotted path to the bad field, e.g. 'buttons.0.title'. */
  field?: string;
  message: string;
}

import type { FlowTriggerType } from './types';

interface FlowInput {
  name: string;
  trigger_type: FlowTriggerType;
  trigger_config: Record<string, unknown>;
  entry_node_id: string | null;
}

interface NodeInput {
  node_key: string;
  node_type: string;
  config: Record<string, unknown>;
}

export function validateFlowForActivation(
  flow: FlowInput,
  nodes: NodeInput[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // ---- name ----
  if (!flow.name || !flow.name.trim()) {
    issues.push({
      severity: 'error',
      scope: 'flow',
      field: 'name',
      message: 'Flow name is required.',
    });
  }

  // ---- trigger ----
  issues.push(...validateTrigger(flow.trigger_type, flow.trigger_config));

  // ---- graph integrity ----
  if (!flow.entry_node_id) {
    issues.push({
      severity: 'error',
      scope: 'flow',
      field: 'entry_node_id',
      message: 'Pick an entry node before activating.',
    });
  }

  const keys = new Set(nodes.map((n) => n.node_key));
  if (nodes.length === 0) {
    issues.push({
      severity: 'error',
      scope: 'flow',
      message: 'A flow needs at least one node before activation.',
    });
  }

  if (flow.entry_node_id && !keys.has(flow.entry_node_id)) {
    issues.push({
      severity: 'error',
      scope: 'flow',
      field: 'entry_node_id',
      message: `Entry node "${flow.entry_node_id}" doesn't exist.`,
    });
  }

  // Duplicate node_key (the DB UNIQUE constraint catches this on save
  // too, but surfacing it client-side gives a friendlier error path).
  const seen = new Set<string>();
  for (const n of nodes) {
    if (seen.has(n.node_key)) {
      issues.push({
        severity: 'error',
        scope: 'node',
        node_key: n.node_key,
        message: `Duplicate node_key "${n.node_key}".`,
      });
    }
    seen.add(n.node_key);
  }

  // Per-node rules (Meta limits + dead-end + edge resolution).
  for (const n of nodes) {
    issues.push(...validateNode(n, keys));
  }

  // Reachability — every non-orphan node must be reachable from the
  // entry. Done after per-node validation so we don't double-report
  // when a node has bad config AND is unreachable.
  if (flow.entry_node_id && keys.has(flow.entry_node_id)) {
    const reached = reachableFromEntry(flow.entry_node_id, nodes);
    for (const n of nodes) {
      if (!reached.has(n.node_key)) {
        issues.push({
          severity: 'warning',
          scope: 'node',
          node_key: n.node_key,
          message: `Node "${n.node_key}" is unreachable from the entry node.`,
        });
      }
    }
  }

  return issues;
}

// ============================================================
// Trigger
// ============================================================

function validateTrigger(
  trigger_type: FlowInput['trigger_type'],
  trigger_config: Record<string, unknown>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (trigger_type === 'keyword') {
    const keywords = Array.isArray(trigger_config.keywords)
      ? (trigger_config.keywords as unknown[])
      : null;
    if (!keywords || keywords.length === 0) {
      issues.push({
        severity: 'error',
        scope: 'trigger',
        field: 'trigger_config.keywords',
        message: 'Keyword triggers need at least one keyword.',
      });
    } else {
      // Empty / whitespace-only keywords are silent no-ops at match
      // time — call them out so the user doesn't think they configured
      // a keyword that never fires.
      const blanks = keywords.filter(
        (k) => typeof k !== 'string' || !k.trim()
      ).length;
      if (blanks > 0) {
        issues.push({
          severity: 'warning',
          scope: 'trigger',
          field: 'trigger_config.keywords',
          message: `${blanks} keyword${blanks === 1 ? ' is' : 's are'} blank — they won't match anything.`,
        });
      }
    }
  }
  if (trigger_type === 'interactive_reply') {
    const ids = Array.isArray(trigger_config.reply_ids)
      ? (trigger_config.reply_ids as unknown[])
      : [];
    if (ids.length === 0 || ids.every((r) => typeof r !== 'string' || !r.trim())) {
      issues.push({
        severity: 'error',
        scope: 'trigger',
        field: 'trigger_config.reply_ids',
        message: 'Interactive-reply triggers need at least one reply id.',
      });
    }
  }

  if (trigger_type === 'scheduled') {
    const freq = trigger_config.frequency;
    if (freq !== 'daily' && freq !== 'weekly') {
      issues.push({
        severity: 'error',
        scope: 'trigger',
        field: 'trigger_config.frequency',
        message: 'Scheduled triggers need a frequency (daily or weekly).',
      });
    }
    const hour = trigger_config.hour;
    const minute = trigger_config.minute;
    if (typeof hour !== 'number' || hour < 0 || hour > 23) {
      issues.push({
        severity: 'error',
        scope: 'trigger',
        field: 'trigger_config.hour',
        message: 'Scheduled triggers need an hour between 0 and 23.',
      });
    }
    if (typeof minute !== 'number' || minute < 0 || minute > 59) {
      issues.push({
        severity: 'error',
        scope: 'trigger',
        field: 'trigger_config.minute',
        message: 'Scheduled triggers need a minute between 0 and 59.',
      });
    }
    if (freq === 'weekly') {
      const wd = trigger_config.weekday;
      if (typeof wd !== 'number' || wd < 0 || wd > 6) {
        issues.push({
          severity: 'error',
          scope: 'trigger',
          field: 'trigger_config.weekday',
          message: 'Weekly schedules need a weekday (0 = Sunday … 6).',
        });
      }
    }
  }

  // first_inbound_message / manual / new_message_received /
  // new_contact_created / tag_added / conversation_assigned accept
  // empty config (empty filter = match any).

  return issues;
}

// ============================================================
// Per-node
// ============================================================

function validateNode(
  node: NodeInput,
  knownKeys: Set<string>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  switch (node.node_type) {
    case 'start': {
      const cfg = node.config as { next_node_key?: string };
      if (!cfg.next_node_key) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'next_node_key',
          message: 'Start node must point to a next node.',
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'next_node_key',
          message: `Start points to non-existent node "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case 'send_message': {
      const cfg = node.config as { text?: string; next_node_key?: string };
      if (!cfg.text?.trim()) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'text',
          message: 'Send-message node needs a text body.',
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'next_node_key',
          message: 'Send-message node must point to a next node.',
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'next_node_key',
          message: `Send-message points to non-existent node "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case 'send_media': {
      const cfg = node.config as {
        media_type?: 'image' | 'video' | 'document';
        media_url?: string;
        caption?: string;
        next_node_key?: string;
      };
      if (
        !cfg.media_type ||
        !['image', 'video', 'document'].includes(cfg.media_type)
      ) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'media_type',
          message:
            'Send-media node needs a media type (image, video, or document).',
        });
      }
      if (!cfg.media_url?.trim()) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'media_url',
          message:
            'Send-media node needs a file (upload one before activating).',
        });
      }
      // Caption cap mirrors Meta's interactive body cap; documented as a
      // hard limit in the WhatsApp Cloud API media-message reference.
      if (
        cfg.caption &&
        cfg.caption.length > INTERACTIVE_LIMITS.bodyMaxLength
      ) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'caption',
          message: `Caption exceeds ${INTERACTIVE_LIMITS.bodyMaxLength} chars (WhatsApp limit).`,
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'next_node_key',
          message: 'Send-media node must point to a next node.',
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'next_node_key',
          message: `Send-media points to non-existent node "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case 'send_buttons': {
      const cfg = node.config as {
        text?: string;
        buttons?: Array<{
          reply_id?: string;
          title?: string;
          next_node_key?: string;
        }>;
      };
      if (!cfg.text?.trim()) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'text',
          message: 'Send-buttons node needs a text body.',
        });
      }
      const btns = cfg.buttons ?? [];
      if (btns.length < 1) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'buttons',
          message: 'Send-buttons needs at least one button.',
        });
      }
      if (btns.length > INTERACTIVE_LIMITS.maxButtons) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'buttons',
          message: `WhatsApp allows at most ${INTERACTIVE_LIMITS.maxButtons} buttons per message.`,
        });
      }
      const seenIds = new Set<string>();
      btns.forEach((b, i) => {
        const field = `buttons.${i}`;
        if (!b.reply_id?.trim()) {
          issues.push({
            severity: 'error',
            scope: 'node',
            node_key: node.node_key,
            field: `${field}.reply_id`,
            message: `Button ${i + 1} needs a reply id.`,
          });
        } else if (seenIds.has(b.reply_id)) {
          issues.push({
            severity: 'error',
            scope: 'node',
            node_key: node.node_key,
            field: `${field}.reply_id`,
            message: `Duplicate button reply id "${b.reply_id}".`,
          });
        }
        if (b.reply_id) seenIds.add(b.reply_id);

        if (!b.title?.trim()) {
          issues.push({
            severity: 'error',
            scope: 'node',
            node_key: node.node_key,
            field: `${field}.title`,
            message: `Button ${i + 1} needs a title.`,
          });
        } else if (b.title.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
          issues.push({
            severity: 'error',
            scope: 'node',
            node_key: node.node_key,
            field: `${field}.title`,
            message: `Button ${i + 1} title is over ${INTERACTIVE_LIMITS.buttonTitleMaxLength} chars (WhatsApp limit).`,
          });
        }

        if (!b.next_node_key) {
          issues.push({
            severity: 'error',
            scope: 'node',
            node_key: node.node_key,
            field: `${field}.next_node_key`,
            message: `Button ${i + 1} needs a next node.`,
          });
        } else if (!knownKeys.has(b.next_node_key)) {
          issues.push({
            severity: 'error',
            scope: 'node',
            node_key: node.node_key,
            field: `${field}.next_node_key`,
            message: `Button ${i + 1} points to non-existent node "${b.next_node_key}".`,
          });
        }
      });
      break;
    }

    case 'send_list': {
      const cfg = node.config as {
        text?: string;
        button_label?: string;
        sections?: Array<{
          title?: string;
          rows?: Array<{
            reply_id?: string;
            title?: string;
            description?: string;
            next_node_key?: string;
          }>;
        }>;
      };
      if (!cfg.text?.trim()) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'text',
          message: 'Send-list node needs a text body.',
        });
      }
      if (!cfg.button_label?.trim()) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'button_label',
          message: 'Send-list needs a button label (the tap-to-expand text).',
        });
      }
      const sections = cfg.sections ?? [];
      const totalRows = sections.reduce(
        (sum, s) => sum + (s.rows?.length ?? 0),
        0
      );
      if (totalRows < 1) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'sections',
          message: 'Send-list needs at least one row.',
        });
      }
      if (totalRows > INTERACTIVE_LIMITS.maxListRowsTotal) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'sections',
          message: `Send-list allows at most ${INTERACTIVE_LIMITS.maxListRowsTotal} rows total across sections.`,
        });
      }
      const seenIds = new Set<string>();
      sections.forEach((section, si) => {
        const rows = section.rows ?? [];
        rows.forEach((row, ri) => {
          const field = `sections.${si}.rows.${ri}`;
          if (!row.reply_id?.trim()) {
            issues.push({
              severity: 'error',
              scope: 'node',
              node_key: node.node_key,
              field: `${field}.reply_id`,
              message: `Row ${ri + 1} in section ${si + 1} needs a reply id.`,
            });
          } else if (seenIds.has(row.reply_id)) {
            issues.push({
              severity: 'error',
              scope: 'node',
              node_key: node.node_key,
              field: `${field}.reply_id`,
              message: `Duplicate list row id "${row.reply_id}".`,
            });
          }
          if (row.reply_id) seenIds.add(row.reply_id);

          if (!row.title?.trim()) {
            issues.push({
              severity: 'error',
              scope: 'node',
              node_key: node.node_key,
              field: `${field}.title`,
              message: `Row ${ri + 1} needs a title.`,
            });
          } else if (
            row.title.length > INTERACTIVE_LIMITS.listRowTitleMaxLength
          ) {
            issues.push({
              severity: 'error',
              scope: 'node',
              node_key: node.node_key,
              field: `${field}.title`,
              message: `Row ${ri + 1} title exceeds ${INTERACTIVE_LIMITS.listRowTitleMaxLength} chars.`,
            });
          }
          if (
            row.description &&
            row.description.length >
              INTERACTIVE_LIMITS.listRowDescriptionMaxLength
          ) {
            issues.push({
              severity: 'error',
              scope: 'node',
              node_key: node.node_key,
              field: `${field}.description`,
              message: `Row ${ri + 1} description exceeds ${INTERACTIVE_LIMITS.listRowDescriptionMaxLength} chars.`,
            });
          }
          if (!row.next_node_key) {
            issues.push({
              severity: 'error',
              scope: 'node',
              node_key: node.node_key,
              field: `${field}.next_node_key`,
              message: `Row ${ri + 1} needs a next node.`,
            });
          } else if (!knownKeys.has(row.next_node_key)) {
            issues.push({
              severity: 'error',
              scope: 'node',
              node_key: node.node_key,
              field: `${field}.next_node_key`,
              message: `Row ${ri + 1} points to non-existent node "${row.next_node_key}".`,
            });
          }
        });
      });
      break;
    }

    case 'collect_input': {
      const cfg = node.config as {
        prompt_text?: string;
        var_key?: string;
        next_node_key?: string;
      };
      if (!cfg.prompt_text?.trim()) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'prompt_text',
          message: 'Collect-input needs a prompt to send the customer.',
        });
      }
      if (!cfg.var_key?.trim()) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'var_key',
          message: 'Collect-input needs a var_key to store the answer under.',
        });
      } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cfg.var_key)) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'var_key',
          message: `var_key "${cfg.var_key}" must be alphanumeric+underscore and start with a letter or underscore.`,
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'next_node_key',
          message: 'Collect-input must point to a next node.',
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'next_node_key',
          message: `Collect-input points to non-existent node "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case 'condition': {
      const cfg = node.config as {
        subject?: string;
        subject_key?: string;
        operator?: 'equals' | 'contains' | 'present' | 'absent';
        value?: string;
        true_next?: string;
        false_next?: string;
      };
      if (
        !cfg.subject ||
        ![
          'var',
          'tag',
          'contact_field',
          'message_content',
          'time_of_day',
        ].includes(cfg.subject)
      ) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'subject',
          message:
            'Condition needs a subject (var / tag / contact_field / message_content / time_of_day).',
        });
      }
      // message_content compares the triggering text itself, so no
      // subject_key is needed. time_of_day encodes its window in
      // subject_key ("HH:mm-HH:mm") and still requires it.
      if (cfg.subject !== 'message_content' && !cfg.subject_key?.trim()) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'subject_key',
          message:
            'Condition needs a subject_key (var name, tag id, field name, or time window).',
        });
      }
      if (
        !cfg.operator ||
        !['equals', 'contains', 'present', 'absent'].includes(cfg.operator)
      ) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'operator',
          message: 'Condition needs an operator.',
        });
      } else if (
        (cfg.operator === 'equals' || cfg.operator === 'contains') &&
        (cfg.value === undefined || cfg.value === '')
      ) {
        issues.push({
          severity: 'warning',
          scope: 'node',
          node_key: node.node_key,
          field: 'value',
          message: `Operator "${cfg.operator}" usually expects a comparison value — empty value will only match empty subjects.`,
        });
      }
      for (const branch of ['true_next', 'false_next'] as const) {
        const key = cfg[branch];
        if (!key) {
          issues.push({
            severity: 'error',
            scope: 'node',
            node_key: node.node_key,
            field: branch,
            message: `Condition needs a node for the "${branch === 'true_next' ? 'true' : 'false'}" branch.`,
          });
        } else if (!knownKeys.has(key)) {
          issues.push({
            severity: 'error',
            scope: 'node',
            node_key: node.node_key,
            field: branch,
            message: `Condition's "${branch}" points to non-existent node "${key}".`,
          });
        }
      }
      break;
    }

    case 'set_tag': {
      const cfg = node.config as {
        mode?: 'add' | 'remove';
        tag_id?: string;
        next_node_key?: string;
      };
      if (!cfg.mode || !['add', 'remove'].includes(cfg.mode)) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'mode',
          message: 'Set-tag needs a mode (add or remove).',
        });
      }
      if (!cfg.tag_id) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'tag_id',
          message: 'Set-tag needs a tag to apply.',
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'next_node_key',
          message: 'Set-tag must point to a next node.',
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'next_node_key',
          message: `Set-tag points to non-existent node "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    // ---- Absorbed automation actions (Workflows unification) ----

    case 'send_template': {
      const cfg = node.config as {
        template_name?: string;
        next_node_key?: string;
      };
      if (!cfg.template_name?.trim()) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'template_name',
          message: 'Send-template needs an approved template name.',
        });
      }
      issues.push(...requireNext(node, cfg.next_node_key, knownKeys));
      break;
    }

    case 'update_contact_field': {
      const cfg = node.config as {
        field?: string;
        value?: string;
        next_node_key?: string;
      };
      if (!cfg.field?.trim()) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'field',
          message: 'Update-contact-field needs a target field.',
        });
      }
      if (cfg.value === undefined || cfg.value === '') {
        issues.push({
          severity: 'warning',
          scope: 'node',
          node_key: node.node_key,
          field: 'value',
          message: 'Empty value will clear the field for every contact.',
        });
      }
      issues.push(...requireNext(node, cfg.next_node_key, knownKeys));
      break;
    }

    case 'assign_conversation': {
      const cfg = node.config as {
        mode?: string;
        agent_id?: string;
        next_node_key?: string;
      };
      if (!cfg.mode || !['specific', 'round_robin'].includes(cfg.mode)) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'mode',
          message:
            'Assign-conversation needs a mode (specific or round_robin).',
        });
      }
      if (cfg.mode === 'specific' && !cfg.agent_id) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'agent_id',
          message: 'Pick an agent for specific assignment.',
        });
      }
      issues.push(...requireNext(node, cfg.next_node_key, knownKeys));
      break;
    }

    case 'create_deal': {
      const cfg = node.config as {
        pipeline_id?: string;
        stage_id?: string;
        title?: string;
        next_node_key?: string;
      };
      if (!cfg.pipeline_id) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'pipeline_id',
          message: 'Create-deal needs a pipeline.',
        });
      }
      if (!cfg.stage_id) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'stage_id',
          message: 'Create-deal needs a stage.',
        });
      }
      if (!cfg.title?.trim()) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'title',
          message: 'Create-deal needs a deal title.',
        });
      }
      issues.push(...requireNext(node, cfg.next_node_key, knownKeys));
      break;
    }

    case 'send_webhook': {
      const cfg = node.config as { url?: string; next_node_key?: string };
      if (!cfg.url?.trim()) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'url',
          message: 'Send-webhook needs a URL.',
        });
      } else if (!/^https:\/\//i.test(cfg.url.trim())) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'url',
          message: 'Webhook URLs must use https://.',
        });
      }
      issues.push(...requireNext(node, cfg.next_node_key, knownKeys));
      break;
    }

    case 'close_conversation': {
      const cfg = node.config as { next_node_key?: string };
      issues.push(...requireNext(node, cfg.next_node_key, knownKeys));
      break;
    }

    case 'wait': {
      const cfg = node.config as {
        amount?: number;
        unit?: string;
        next_node_key?: string;
      };
      if (
        typeof cfg.amount !== 'number' ||
        !Number.isFinite(cfg.amount) ||
        cfg.amount <= 0
      ) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'amount',
          message: 'Wait needs a positive duration.',
        });
      }
      if (!cfg.unit || !['minutes', 'hours', 'days'].includes(cfg.unit)) {
        issues.push({
          severity: 'error',
          scope: 'node',
          node_key: node.node_key,
          field: 'unit',
          message: 'Wait needs a unit (minutes, hours, or days).',
        });
      }
      issues.push(...requireNext(node, cfg.next_node_key, knownKeys));
      break;
    }

    case 'handoff':
    case 'end':
      // Terminal nodes have no outgoing edges; nothing to validate
      // beyond their existence.
      break;

    default:
      issues.push({
        severity: 'error',
        scope: 'node',
        node_key: node.node_key,
        message: `Unknown node type "${node.node_type}".`,
      });
  }

  return issues;
}

/**
 * Shared next_node_key rule for auto-advancing nodes — reusable so
 * every absorbed action node reports identical, predictable errors.
 */
function requireNext(
  node: NodeInput,
  nextKey: string | undefined,
  knownKeys: Set<string>
): ValidationIssue[] {
  if (!nextKey) {
    return [
      {
        severity: 'error',
        scope: 'node',
        node_key: node.node_key,
        field: 'next_node_key',
        message: `${node.node_type} must point to a next node.`,
      },
    ];
  }
  if (!knownKeys.has(nextKey)) {
    return [
      {
        severity: 'error',
        scope: 'node',
        node_key: node.node_key,
        field: 'next_node_key',
        message: `${node.node_type} points to non-existent node "${nextKey}".`,
      },
    ];
  }
  return [];
}

// ============================================================
// Reachability — BFS from the entry, follow outgoing edges per node
// ============================================================

export function reachableFromEntry(
  entryKey: string,
  nodes: NodeInput[]
): Set<string> {
  const byKey = new Map<string, NodeInput>();
  for (const n of nodes) byKey.set(n.node_key, n);

  const visited = new Set<string>();
  const queue: string[] = [entryKey];
  while (queue.length > 0) {
    const key = queue.shift() as string;
    if (visited.has(key)) continue;
    visited.add(key);
    const node = byKey.get(key);
    if (!node) continue;
    for (const next of outgoingEdges(node)) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  return visited;
}

function outgoingEdges(node: NodeInput): string[] {
  switch (node.node_type) {
    case 'start':
    case 'send_message':
    case 'send_media':
    case 'collect_input':
    case 'set_tag':
    // Absorbed action nodes are all single-exit.
    case 'send_template':
    case 'update_contact_field':
    case 'assign_conversation':
    case 'create_deal':
    case 'send_webhook':
    case 'close_conversation':
    case 'wait': {
      const cfg = node.config as { next_node_key?: string };
      return cfg.next_node_key ? [cfg.next_node_key] : [];
    }
    case 'condition': {
      const cfg = node.config as {
        true_next?: string;
        false_next?: string;
      };
      const out: string[] = [];
      if (cfg.true_next) out.push(cfg.true_next);
      if (cfg.false_next) out.push(cfg.false_next);
      return out;
    }
    case 'send_buttons': {
      const cfg = node.config as {
        buttons?: Array<{ next_node_key?: string }>;
      };
      return (cfg.buttons ?? [])
        .map((b) => b.next_node_key)
        .filter((k): k is string => !!k);
    }
    case 'send_list': {
      const cfg = node.config as {
        sections?: Array<{ rows?: Array<{ next_node_key?: string }> }>;
      };
      const out: string[] = [];
      for (const s of cfg.sections ?? []) {
        for (const r of s.rows ?? []) {
          if (r.next_node_key) out.push(r.next_node_key);
        }
      }
      return out;
    }
    case 'handoff':
    case 'end':
    default:
      return [];
  }
}
