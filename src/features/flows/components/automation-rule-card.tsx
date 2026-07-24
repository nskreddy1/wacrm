'use client';

import {
  Zap,
  MoreVertical,
  Pencil,
  Copy,
  FileText,
  Trash2,
  PlayCircle,
  PauseCircle,
} from 'lucide-react';
import type { useTranslations } from 'next-intl';

import type { Automation } from '@/types';
import {
  triggerMeta,
  formatRelative,
} from '@/features/automations/lib/trigger-meta';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * Card for a classic automation rule, rendered inside the unified
 * Flows grid. Matches the FlowCard visual design; the "Classic rule"
 * chip and Zap icon distinguish it from canvas flows.
 */
export function AutomationRuleCard({
  automation,
  onToggle,
  onEdit,
  onLogs,
  onDuplicate,
  onDelete,
  t,
}: {
  automation: Automation;
  onToggle: (next: boolean) => void;
  onEdit: () => void;
  onLogs: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const meta = triggerMeta(automation.trigger_type);
  const StatusIcon = automation.is_active ? PlayCircle : PauseCircle;

  return (
    <div className="border-border bg-card hover:border-border flex flex-col rounded-lg border p-4 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Zap className="text-primary h-4 w-4 shrink-0" />
          <h3 className="text-foreground truncate text-sm font-semibold">
            {automation.name}
          </h3>
        </div>
        <Badge
          variant="outline"
          className={cn(
            'shrink-0 gap-1 text-[10px]',
            automation.is_active
              ? 'border-emerald-600/40 bg-emerald-500/10 text-emerald-300'
              : 'border-border bg-muted text-muted-foreground'
          )}
        >
          <StatusIcon className="h-3 w-3" />
          {automation.is_active ? t('statusActive') : t('statusPaused')}
        </Badge>
      </div>

      <p className="text-muted-foreground mt-2 line-clamp-2 text-xs">
        {automation.description || meta.label}
      </p>

      <div className="text-muted-foreground mt-4 flex flex-wrap items-center gap-2 text-[11px]">
        <span
          className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 font-medium',
            meta.pillClass
          )}
        >
          {meta.label}
        </span>
        <span className="border-border bg-muted/50 inline-flex items-center rounded-full border px-2 py-0.5 font-medium">
          {t('classicRule')}
        </span>
        <span className="tabular-nums">
          {t('runCount', { count: automation.execution_count })}
        </span>
        <span aria-hidden>·</span>
        <span>
          {t('lastRunLabel', {
            time: formatRelative(automation.last_executed_at),
          })}
        </span>
      </div>

      <div className="border-border mt-4 flex items-center justify-between gap-2 border-t pt-3">
        <Switch
          checked={automation.is_active}
          onCheckedChange={(v) => onToggle(!!v)}
          aria-label={
            automation.is_active ? t('deactivateRule') : t('activateRule')
          }
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Open menu"
            className="text-muted-foreground hover:bg-muted hover:text-foreground data-[popup-open]:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors"
          >
            <MoreVertical className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="h-4 w-4" />
              {t('edit')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="h-4 w-4" />
              {t('duplicate')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onLogs}>
              <FileText className="h-4 w-4" />
              {t('viewLogs')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
              {t('delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
