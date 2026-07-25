'use client';

import type { LeadSourcePoint } from '@/lib/data/dashboard/types';

/** Human labels for raw source keys. */
const SOURCE_LABELS: Record<string, string> = {
  manual: 'Added manually',
  import: 'CSV import',
  api: 'API',
  api_outbound: 'Outbound (API)',
  whatsapp_inbound: 'WhatsApp inbound',
  sms_inbound: 'SMS inbound',
  web_form: 'Web form',
  referral: 'Referral',
  campaign: 'Campaign',
  other: 'Other',
  unknown: 'Unknown',
};

function labelFor(source: string): string {
  return SOURCE_LABELS[source] ?? source.replace(/_/g, ' ');
}

/**
 * Horizontal bar breakdown of where new leads came from (last 30
 * days). Uses semantic tokens only; the widest bar is the top source.
 */
export function LeadSources({ data }: { data: LeadSourcePoint[] }) {
  if (data.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-xs">
        No new leads in the last 30 days.
      </p>
    );
  }

  const max = Math.max(...data.map((d) => d.count), 1);
  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="flex flex-col gap-3">
      {data.slice(0, 8).map((point) => {
        const pct = Math.round((point.count / total) * 100);
        return (
          <div key={point.source} className="flex items-center gap-3">
            <span className="text-foreground w-36 shrink-0 truncate text-xs font-medium">
              {labelFor(point.source)}
            </span>
            <div
              className="bg-muted h-2 flex-1 overflow-hidden rounded-full"
              role="img"
              aria-label={`${labelFor(point.source)}: ${point.count} leads (${pct}%)`}
            >
              <div
                className="bg-primary h-full rounded-full"
                style={{ width: `${Math.max((point.count / max) * 100, 4)}%` }}
              />
            </div>
            <span className="text-muted-foreground w-16 shrink-0 text-right text-xs tabular-nums">
              {point.count} · {pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
