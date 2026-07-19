import { KeyRound, LockKeyhole, MessageCircleMore } from "lucide-react";

type AuthBrandPanelProps = {
  title?: string;
  description?: string;
};

const METRICS = [
  {
    value: "2.4x",
    label: "Faster first response across shared team inboxes",
  },
  {
    value: "12k+",
    label: "Conversations organized per workspace each month",
  },
  {
    value: "99.9%",
    label: "Uptime target for message sync and delivery",
  },
] as const;

const TRUST_ITEMS = [
  { icon: LockKeyhole, label: "Encrypted in transit & at rest" },
  { icon: KeyRound, label: "Role-based access control" },
  { icon: MessageCircleMore, label: "Audit-ready conversation history" },
] as const;

export function AuthBrandPanel({
  title = "Every conversation, deal, and follow-up in one system of record",
  description = "Axon gives your team a shared inbox across WhatsApp, SMS, and email — with pipelines and automations so nothing falls through the cracks.",
}: AuthBrandPanelProps) {
  return (
    <aside
      aria-label="About Axon"
      className="relative hidden overflow-hidden rounded-2xl border border-border bg-card lg:flex lg:flex-col"
    >
      {/* Subtle blueprint grid — depth without noise */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          maskImage: "linear-gradient(to bottom, black 40%, transparent 90%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-primary-soft blur-3xl"
      />

      <div className="relative flex flex-1 flex-col justify-between gap-8 p-8 xl:p-12">
        <div className="flex flex-col gap-4">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Axon — Customer Workspace
          </p>
          <h2 className="max-w-md text-balance text-2xl font-semibold leading-tight tracking-tight text-foreground xl:text-3xl">
            {title}
          </h2>
          <p className="max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>

        <dl className="flex flex-col gap-5 border-l border-border pl-6">
          {METRICS.map((metric) => (
            <div key={metric.value} className="flex flex-col gap-0.5">
              <dt className="sr-only">{metric.label}</dt>
              <dd className="text-2xl font-semibold tracking-tight text-foreground tabular-nums xl:text-3xl">
                {metric.value}
              </dd>
              <p
                aria-hidden="true"
                className="max-w-sm text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                {metric.label}
              </p>
            </div>
          ))}
        </dl>

        <ul className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border pt-5">
          {TRUST_ITEMS.map((item) => (
            <li
              key={item.label}
              className="flex items-center gap-2 text-xs font-medium text-muted-foreground"
            >
              <item.icon className="size-3.5 text-primary" aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
