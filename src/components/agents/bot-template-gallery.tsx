'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { BotTemplate } from '@/lib/ai/bot-templates';
import { TONE_LABEL } from './bot-types';

const CATEGORY_LABEL: Record<string, string> = {
  support: 'Support',
  sales: 'Sales',
  operations: 'Operations',
  other: 'Other',
};

export function BotTemplateGallery({
  open,
  onOpenChange,
  onUseTemplate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUseTemplate: (template: BotTemplate) => void;
}) {
  const [templates, setTemplates] = useState<BotTemplate[] | null>(null);

  useEffect(() => {
    if (!open || templates !== null) return;
    (async () => {
      try {
        const res = await fetch('/api/ai/bots/templates');
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data.error ?? 'Failed to load templates');
          return;
        }
        setTemplates(data.templates ?? []);
      } catch {
        toast.error('Failed to load templates');
      }
    })();
  }, [open, templates]);

  // Group by category, preserving the API's sort order.
  const groups: [string, BotTemplate[]][] = [];
  for (const t of templates ?? []) {
    const key = t.category || 'other';
    const group = groups.find(([k]) => k === key);
    if (group) group[1].push(t);
    else groups.push([key, [t]]);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bot templates</DialogTitle>
          <DialogDescription>
            Start from a proven persona and adjust it to your business. You can
            edit everything before the bot is created.
          </DialogDescription>
        </DialogHeader>

        {templates === null ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading templates…
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map(([category, items]) => (
              <section key={category} aria-label={CATEGORY_LABEL[category] ?? category}>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {CATEGORY_LABEL[category] ?? category}
                </h3>
                <div className="flex flex-col gap-2">
                  {items.map((t) => (
                    <TemplateCard key={t.key} template={t} onUse={onUseTemplate} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TemplateCard({
  template,
  onUse,
}: {
  template: BotTemplate;
  onUse: (t: BotTemplate) => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-lg"
            aria-hidden="true"
          >
            {template.emoji}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-sm font-medium text-foreground">{template.name}</p>
              <Badge variant="outline" className="text-[10px]">
                {TONE_LABEL[template.tone]}
              </Badge>
              {template.source === 'catalog' && (
                <Badge variant="secondary" className="text-[10px]">
                  Curated
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {template.description}
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => onUse(template)} className="shrink-0">
          Use template
        </Button>
      </div>

      <Collapsible open={previewOpen} onOpenChange={setPreviewOpen}>
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 h-auto p-1 text-xs text-muted-foreground"
            />
          }
        >
          Preview prompt
          <ChevronDown
            className={`ml-1 h-3 w-3 transition-transform ${previewOpen ? 'rotate-180' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="mt-1 max-h-48 overflow-y-auto rounded-md bg-muted p-2.5 text-xs whitespace-pre-wrap text-muted-foreground">
            {template.systemPrompt}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
