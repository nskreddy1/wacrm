'use client';

/**
 * Per-node forms for the absorbed automation actions (Workflows
 * unification): send_template, update_contact_field,
 * assign_conversation, create_deal, send_webhook,
 * close_conversation, wait.
 *
 * Same contract as every other branch of NodeConfigForm — receive the
 * node's config, forward edits via onUpdateConfig — and the same
 * reusable primitives (TextRow / NextNodeRow / shadcn Select), so the
 * canvas side panel and list editor render identically.
 *
 * Account data (templates, members, pipelines, custom fields) comes
 * from the shared SWR hooks in use-workflow-resources — cached once
 * per dataset regardless of how many forms are open.
 */

import { useTranslations } from 'next-intl';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useAccountMembers,
  useApprovedTemplates,
  useCustomFields,
  usePipelinesWithStages,
} from '../../hooks/use-workflow-resources';
import type { BuilderNode } from '../shared';
import { NextNodeRow, TextRow } from './fields';

type T = ReturnType<typeof useTranslations>;

interface ActionFormProps {
  cfg: Record<string, unknown>;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  t: T;
}

function LabeledRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-muted-foreground mb-1 block text-xs">
        {label}
      </label>
      {children}
    </div>
  );
}

// ============================================================
// send_template
// ============================================================

export function SendTemplateForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  t,
}: ActionFormProps) {
  const templates = useApprovedTemplates();
  const name = (cfg.template_name as string) ?? '';

  return (
    <>
      <LabeledRow label={t('templateLabel')}>
        {templates.length > 0 ? (
          <Select
            value={name || '__none__'}
            onValueChange={(v) => {
              if (v === '__none__') return;
              const tmpl = templates.find((x) => x.name === v);
              onUpdateConfig({
                template_name: v,
                language: tmpl?.language ?? 'en_US',
              });
            }}
          >
            <SelectTrigger className="bg-muted">
              <SelectValue placeholder={t('templatePlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {templates.map((tmpl) => (
                <SelectItem key={tmpl.id} value={tmpl.name}>
                  {tmpl.name}{' '}
                  <span className="text-muted-foreground">
                    · {tmpl.language}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          // No approved templates yet — raw input keeps the form usable.
          <Input
            value={name}
            onChange={(e) => onUpdateConfig({ template_name: e.target.value })}
            placeholder={t('templatePlaceholder')}
            className="bg-muted"
          />
        )}
      </LabeledRow>
      <p className="text-muted-foreground text-[10px]">{t('templateHelp')}</p>
      <NextNodeRow
        value={(cfg.next_node_key as string) ?? ''}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ next_node_key: v })}
        label={t('advancesTo')}
      />
    </>
  );
}

// ============================================================
// update_contact_field
// ============================================================

const BUILTIN_FIELDS = ['name', 'email', 'company'] as const;

export function UpdateContactFieldForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  t,
}: ActionFormProps) {
  const customFields = useCustomFields();
  const field = (cfg.field as string) ?? 'name';

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <LabeledRow label={t('fieldLabel')}>
          <Select
            value={field}
            onValueChange={(v) => onUpdateConfig({ field: v })}
          >
            <SelectTrigger className="bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BUILTIN_FIELDS.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
              {customFields.map((cf) => (
                <SelectItem key={cf.id} value={`custom:${cf.id}`}>
                  {cf.field_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </LabeledRow>
        <TextRow
          label={t('valueLabel')}
          value={(cfg.value as string) ?? ''}
          onChange={(v) => onUpdateConfig({ value: v })}
        />
      </div>
      <p className="text-muted-foreground text-[10px]">
        {t('interpolationHelp')}
      </p>
      <NextNodeRow
        value={(cfg.next_node_key as string) ?? ''}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ next_node_key: v })}
        label={t('advancesTo')}
      />
    </>
  );
}

// ============================================================
// assign_conversation
// ============================================================

export function AssignConversationForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  t,
}: ActionFormProps) {
  const members = useAccountMembers();
  const mode = (cfg.mode as string) ?? 'round_robin';

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <LabeledRow label={t('assignModeLabel')}>
          <Select
            value={mode}
            onValueChange={(v) => onUpdateConfig({ mode: v })}
          >
            <SelectTrigger className="bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="round_robin">{t('roundRobin')}</SelectItem>
              <SelectItem value="specific">{t('specificAgent')}</SelectItem>
            </SelectContent>
          </Select>
        </LabeledRow>
        {mode === 'specific' && (
          <LabeledRow label={t('agentLabel')}>
            {members.length > 0 ? (
              <Select
                value={(cfg.agent_id as string) || '__none__'}
                onValueChange={(v) =>
                  onUpdateConfig({ agent_id: v === '__none__' ? '' : v })
                }
              >
                <SelectTrigger className="bg-muted">
                  <SelectValue placeholder={t('agentPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.full_name || m.email || m.user_id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={(cfg.agent_id as string) ?? ''}
                onChange={(e) => onUpdateConfig({ agent_id: e.target.value })}
                placeholder={t('agentPlaceholder')}
                className="bg-muted font-mono text-xs"
              />
            )}
          </LabeledRow>
        )}
      </div>
      <NextNodeRow
        value={(cfg.next_node_key as string) ?? ''}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ next_node_key: v })}
        label={t('advancesTo')}
      />
    </>
  );
}

// ============================================================
// create_deal
// ============================================================

export function CreateDealForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  t,
}: ActionFormProps) {
  const { pipelines, stages } = usePipelinesWithStages();
  const pipelineId = (cfg.pipeline_id as string) ?? '';
  const pipelineStages = stages.filter((s) => s.pipeline_id === pipelineId);

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <LabeledRow label={t('pipelineLabel')}>
          <Select
            value={pipelineId || '__none__'}
            onValueChange={(v) => {
              if (v === '__none__') return;
              // Reset stage when the pipeline changes — stages belong
              // to exactly one pipeline.
              onUpdateConfig({ pipeline_id: v, stage_id: '' });
            }}
          >
            <SelectTrigger className="bg-muted">
              <SelectValue placeholder={t('pipelinePlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {pipelines.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </LabeledRow>
        <LabeledRow label={t('stageLabel')}>
          <Select
            value={((cfg.stage_id as string) || '__none__') ?? '__none__'}
            onValueChange={(v) =>
              onUpdateConfig({ stage_id: v === '__none__' ? '' : v })
            }
          >
            <SelectTrigger className="bg-muted" disabled={!pipelineId}>
              <SelectValue placeholder={t('stagePlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {pipelineStages.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </LabeledRow>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextRow
          label={t('dealTitleLabel')}
          value={(cfg.title as string) ?? ''}
          onChange={(v) => onUpdateConfig({ title: v })}
        />
        <LabeledRow label={t('dealValueLabel')}>
          <Input
            type="number"
            min={0}
            value={typeof cfg.value === 'number' ? cfg.value : 0}
            onChange={(e) =>
              onUpdateConfig({ value: Number(e.target.value) || 0 })
            }
            className="bg-muted"
          />
        </LabeledRow>
      </div>
      <p className="text-muted-foreground text-[10px]">
        {t('interpolationHelp')}
      </p>
      <NextNodeRow
        value={(cfg.next_node_key as string) ?? ''}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ next_node_key: v })}
        label={t('advancesTo')}
      />
    </>
  );
}

// ============================================================
// send_webhook
// ============================================================

export function SendWebhookForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  t,
}: ActionFormProps) {
  return (
    <>
      <TextRow
        label={t('webhookUrlLabel')}
        value={(cfg.url as string) ?? ''}
        onChange={(v) => onUpdateConfig({ url: v })}
      />
      <TextRow
        label={t('webhookBodyLabel')}
        value={(cfg.body_template as string) ?? ''}
        onChange={(v) => onUpdateConfig({ body_template: v })}
        rows={3}
      />
      <p className="text-muted-foreground text-[10px]">{t('webhookHelp')}</p>
      <NextNodeRow
        value={(cfg.next_node_key as string) ?? ''}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ next_node_key: v })}
        label={t('advancesTo')}
      />
    </>
  );
}

// ============================================================
// wait
// ============================================================

export function WaitForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  t,
}: ActionFormProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <LabeledRow label={t('waitAmountLabel')}>
          <Input
            type="number"
            min={1}
            value={typeof cfg.amount === 'number' ? cfg.amount : 1}
            onChange={(e) =>
              onUpdateConfig({
                amount: Math.max(1, Number(e.target.value) || 1),
              })
            }
            className="bg-muted"
          />
        </LabeledRow>
        <LabeledRow label={t('waitUnitLabel')}>
          <Select
            value={(cfg.unit as string) ?? 'hours'}
            onValueChange={(v) => onUpdateConfig({ unit: v })}
          >
            <SelectTrigger className="bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minutes">{t('minutes')}</SelectItem>
              <SelectItem value="hours">{t('hours')}</SelectItem>
              <SelectItem value="days">{t('days')}</SelectItem>
            </SelectContent>
          </Select>
        </LabeledRow>
      </div>
      <p className="text-muted-foreground text-[10px]">{t('waitHelp')}</p>
      <NextNodeRow
        value={(cfg.next_node_key as string) ?? ''}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ next_node_key: v })}
        label={t('advancesTo')}
      />
    </>
  );
}

// ============================================================
// close_conversation — only a next pointer.
// ============================================================

export function CloseConversationForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  t,
}: ActionFormProps) {
  return (
    <NextNodeRow
      value={(cfg.next_node_key as string) ?? ''}
      allNodes={allNodes}
      currentKey={currentKey}
      onChange={(v) => onUpdateConfig({ next_node_key: v })}
      label={t('advancesTo')}
    />
  );
}
