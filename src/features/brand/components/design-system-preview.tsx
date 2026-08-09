import {
  Filter,
  ListFilter,
  Plus,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================
// Static UI system specification.
//
// Every specimen below is hand-built from raw tokens rather than from the
// app's real components. That is intentional: this sheet has to be able
// to show a WRONG pattern (the serif title, the stacked subtitle) next to
// the right one, which is impossible if it renders the same shared
// component the app does. It is a proposal surface, not production UI.
// ============================================================

/** Section wrapper — numbered so review comments can cite "03". */
function Section({
  index,
  title,
  summary,
  children,
}: {
  index: string;
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border border-t py-10 md:py-14">
      <div className="mb-6 flex items-baseline gap-3">
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {index}
        </span>
        <div>
          <h2 className="text-foreground text-base font-semibold tracking-tight">
            {title}
          </h2>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-relaxed">
            {summary}
          </p>
        </div>
      </div>
      {children}
    </section>
  );
}

/** A framed specimen with a caption and a verdict chip. */
function Specimen({
  label,
  verdict,
  children,
}: {
  label: string;
  verdict?: 'keep' | 'drop';
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs font-medium">
          {label}
        </span>
        {verdict ? (
          <span
            className={cn(
              'rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide',
              verdict === 'keep'
                ? 'bg-primary-soft text-primary'
                : 'bg-destructive/10 text-destructive'
            )}
          >
            {verdict === 'keep' ? 'adopt' : 'retire'}
          </span>
        ) : null}
      </div>
      <div className="border-border bg-card overflow-hidden rounded-lg border">
        {children}
      </div>
    </div>
  );
}

/** Ghost body so a header specimen reads as a page, not a floating bar. */
function GhostBody({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="bg-muted size-7 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div
              className="bg-muted h-2 rounded"
              style={{ width: `${58 - i * 11}%` }}
            />
            <div
              className="bg-muted/60 h-2 rounded"
              style={{ width: `${34 - i * 6}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- THE PROPOSED CANONICAL HEADER ----------

/**
 * The single page header pattern proposed for every workspace.
 *
 * One row. Title is the nav noun, verbatim. Count sits inline as a pill
 * because on a CRM the volume IS the context a subtitle was trying to
 * give. Actions right-align. No subtitle, no eyebrow, no serif.
 */
function CanonicalHeader({
  title,
  count,
  actions,
}: {
  title: string;
  count?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="border-border flex h-13 items-center gap-3 border-b px-4 md:px-6">
      <h1 className="text-foreground font-sans text-[15px] font-semibold tracking-tight">
        {title}
      </h1>
      {count ? (
        <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs tabular-nums">
          {count}
        </span>
      ) : null}
      {actions ? (
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

function GhostButton({
  children,
  primary,
}: {
  children: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium',
        primary
          ? 'bg-primary text-primary-foreground'
          : 'border-border text-muted-foreground border'
      )}
    >
      {children}
    </span>
  );
}

// ---------- DATA ----------

const DRIFT = [
  {
    page: 'Agents',
    size: 'text-3xl',
    font: 'serif',
    subtitle: 'none',
    border: 'none',
  },
  {
    page: 'Catalog',
    size: 'text-2xl → 3xl',
    font: 'sans',
    subtitle: 'yes + eyebrow',
    border: 'none',
  },
  {
    page: 'Appointments',
    size: 'text-xl',
    font: 'sans',
    subtitle: 'yes',
    border: 'border-b',
  },
  {
    page: 'Pipelines',
    size: 'sr-only',
    font: '—',
    subtitle: 'none',
    border: 'border-b',
  },
  {
    page: 'Inbox',
    size: 'sr-only',
    font: '—',
    subtitle: 'none',
    border: 'none',
  },
];

const TYPE_SCALE = [
  { role: 'Page title', cls: 'text-[15px] font-semibold tracking-tight' },
  { role: 'Section title', cls: 'text-sm font-semibold' },
  { role: 'Body', cls: 'text-sm leading-relaxed' },
  { role: 'Meta / hint', cls: 'text-xs text-muted-foreground' },
  { role: 'Numeric', cls: 'text-sm tabular-nums' },
];

const TOKENS = [
  { name: 'background', cls: 'bg-background', note: 'App canvas' },
  { name: 'card', cls: 'bg-card', note: 'Raised surface' },
  { name: 'muted', cls: 'bg-muted', note: 'Pills, ghosts, rails' },
  { name: 'primary', cls: 'bg-primary', note: 'One accent only' },
  { name: 'primary-soft', cls: 'bg-primary-soft', note: 'Selected row' },
  { name: 'destructive', cls: 'bg-destructive', note: 'Failure only' },
];

const COPY_RULES = [
  {
    before: 'Manage the products and services your team schedules and sells.',
    after: 'Deleted — the count carries it',
    where: 'Catalog',
  },
  {
    before: 'Coordinate sessions and keep the team on schedule.',
    after: 'Deleted',
    where: 'Appointments',
  },
  {
    before: 'Posts to the #Alerts channel in this workspace. Available without setup.',
    after: 'Posts to #Alerts.',
    where: 'Notifications',
  },
  {
    before: 'Activates with the first alert',
    after: 'On first alert',
    where: 'Notifications',
  },
];

// ---------- PAGE ----------

export function DesignSystemPreview() {
  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="mx-auto max-w-5xl px-5 py-12 md:px-8 md:py-16">
        <div className="mb-2 flex items-center gap-2">
          <span className="bg-primary-soft text-primary rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide">
            static spec
          </span>
          <span className="text-muted-foreground font-mono text-xs">
            /brand/design-system
          </span>
        </div>
        <h1 className="text-foreground text-2xl font-semibold tracking-tight md:text-3xl">
          UI system
        </h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
          {
            'One header, one type scale, one accent. Built from raw tokens so a wrong pattern can sit next to a right one — nothing here is wired to the app.'
          }
        </p>

        {/* 01 — the audit */}
        <Section
          index="01"
          title="What is broken today"
          summary="No shared header component exists, so eleven workspaces hand-rolled five incompatible patterns. Title size spans text-xl to text-3xl between sibling pages, so heading weight signals nothing about hierarchy."
        >
          <div className="border-border overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border bg-muted/50 border-b text-left">
                  {['Page', 'Size', 'Font', 'Subtitle', 'Divider'].map((h) => (
                    <th
                      key={h}
                      className="text-muted-foreground px-3 py-2 text-xs font-medium"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DRIFT.map((r) => (
                  <tr key={r.page} className="border-border border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{r.page}</td>
                    <td className="text-muted-foreground px-3 py-2 font-mono text-xs">
                      {r.size}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 font-mono text-xs',
                        r.font === 'serif'
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                      )}
                    >
                      {r.font}
                    </td>
                    <td className="text-muted-foreground px-3 py-2 font-mono text-xs">
                      {r.subtitle}
                    </td>
                    <td className="text-muted-foreground px-3 py-2 font-mono text-xs">
                      {r.border}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <Specimen label="Agents today — serif, oversized" verdict="drop">
              <div className="px-4 pt-4">
                <h3 className="font-serif text-3xl">Agents</h3>
              </div>
              <GhostBody rows={2} />
            </Specimen>
            <Specimen label="Catalog today — eyebrow + subtitle" verdict="drop">
              <div className="px-4 pt-4">
                <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  Operations
                </p>
                <h3 className="mt-1 text-2xl font-semibold tracking-tight">
                  Catalog
                </h3>
                <p className="text-muted-foreground mt-1 text-sm">
                  Manage the products and services your team schedules and
                  sells.
                </p>
              </div>
              <GhostBody rows={2} />
            </Specimen>
          </div>
          <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
            {
              'The serif is not a style choice — globals.css already defines --font-heading as sans. Agents contradicts the system it lives in, which is why that one page reads as a different product.'
            }
          </p>
        </Section>

        {/* 02 — the canonical header */}
        <Section
          index="02"
          title="The page header"
          summary="One row, 52px, sans, 15px semibold. The nav noun verbatim so the label the user clicked is the title they land on. A count pill replaces the subtitle: on a CRM, volume is the context prose was reaching for."
        >
          <div className="grid gap-5 md:grid-cols-2">
            <Specimen label="Contacts" verdict="keep">
              <CanonicalHeader
                title="Contacts"
                count="1,248"
                actions={
                  <>
                    <GhostButton>
                      <Search className="size-3.5" />
                      Search
                    </GhostButton>
                    <GhostButton primary>
                      <Plus className="size-3.5" />
                      New
                    </GhostButton>
                  </>
                }
              />
              <GhostBody />
            </Specimen>

            <Specimen label="Pipelines — dense workspace" verdict="keep">
              <CanonicalHeader
                title="Pipelines"
                count="6 stages"
                actions={
                  <GhostButton>
                    <SlidersHorizontal className="size-3.5" />
                    Stages
                  </GhostButton>
                }
              />
              <GhostBody rows={3} />
            </Specimen>

            <Specimen label="Appointments" verdict="keep">
              <CanonicalHeader
                title="Appointments"
                count="12 today"
                actions={
                  <>
                    <GhostButton>
                      <ListFilter className="size-3.5" />
                      Today
                    </GhostButton>
                    <GhostButton primary>
                      <Plus className="size-3.5" />
                      Book
                    </GhostButton>
                  </>
                }
              />
              <GhostBody rows={2} />
            </Specimen>

            <Specimen label="Agents — same header, sans" verdict="keep">
              <CanonicalHeader
                title="Agents"
                count="4 online"
                actions={
                  <GhostButton>
                    <Filter className="size-3.5" />
                    Role
                  </GhostButton>
                }
              />
              <GhostBody rows={2} />
            </Specimen>
          </div>

          <div className="border-border bg-card mt-6 rounded-lg border p-4">
            <p className="text-foreground mb-3 text-sm font-semibold">
              Rules
            </p>
            <ul className="text-muted-foreground flex flex-col gap-2 text-sm leading-relaxed">
              <li>
                <span className="text-foreground font-medium">Height</span> is
                fixed at 52px on every page, so the content top edge never
                shifts when navigating.
              </li>
              <li>
                <span className="text-foreground font-medium">Title</span> is
                the nav label, character for character. No restating, no
                pluralising differently.
              </li>
              <li>
                <span className="text-foreground font-medium">No subtitle.</span>{' '}
                If a page genuinely needs explaining, that belongs in an empty
                state, not above working data.
              </li>
              <li>
                <span className="text-foreground font-medium">One primary</span>{' '}
                action maximum. Everything else is secondary or lives in a menu.
              </li>
              <li>
                <span className="text-foreground font-medium">
                  Full-bleed pages keep the bar.
                </span>{' '}
                Inbox and Pipelines currently hide their title with sr-only;
                52px is cheap and buys a consistent home for filters.
              </li>
            </ul>
          </div>
        </Section>

        {/* 03 — typography */}
        <Section
          index="03"
          title="Type scale"
          summary="Five roles, two families. Inter for everything structural; the serif display face is reserved for marketing and the auth panel and never appears inside the product."
        >
          <div className="border-border divide-border divide-y overflow-hidden rounded-lg border">
            {TYPE_SCALE.map((t) => (
              <div
                key={t.role}
                className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className={t.cls}>{t.role}</span>
                <code className="text-muted-foreground font-mono text-xs">
                  {t.cls}
                </code>
              </div>
            ))}
          </div>
        </Section>

        {/* 04 — color */}
        <Section
          index="04"
          title="Surfaces and accent"
          summary="One accent. Indigo carries selection, primary actions and focus; destructive is reserved strictly for failure and irreversible intent. Status colors are data, never decoration."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {TOKENS.map((c) => (
              <div key={c.name} className="flex flex-col gap-2">
                <div
                  className={cn(
                    'border-border h-16 rounded-lg border',
                    c.cls
                  )}
                />
                <div>
                  <p className="font-mono text-xs">{c.name}</p>
                  <p className="text-muted-foreground text-xs">{c.note}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* 05 — copy */}
        <Section
          index="05"
          title="Copy: fewer words, more signal"
          summary="A hint should state a consequence, never re-describe the control the label already names. Anything that explains the nav item back to the user who just clicked it gets deleted."
        >
          <div className="border-border overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border bg-muted/50 border-b text-left">
                  {['Where', 'Was', 'Now'].map((h) => (
                    <th
                      key={h}
                      className="text-muted-foreground px-3 py-2 text-xs font-medium"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COPY_RULES.map((r) => (
                  <tr
                    key={r.before}
                    className="border-border border-b align-top last:border-0"
                  >
                    <td className="text-muted-foreground px-3 py-2 text-xs">
                      {r.where}
                    </td>
                    <td className="text-muted-foreground px-3 py-2 line-through decoration-destructive/50">
                      {r.before}
                    </td>
                    <td className="px-3 py-2 font-medium">{r.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* 06 — migration */}
        <Section
          index="06"
          title="If this is approved"
          summary="Migration is mechanical and reversible. One component lands first, then pages adopt it one at a time — nothing has to move in a single commit."
        >
          <ol className="text-muted-foreground flex flex-col gap-3 text-sm leading-relaxed">
            {[
              'Add components/layout/page-header.tsx with the props shown in 02 — title, count, actions. No page changes yet.',
              'Adopt it on Agents first: it is the loudest inconsistency and the lowest risk, since it drops the serif and gains nothing else.',
              'Adopt on Catalog and Appointments, deleting both subtitles and the Operations eyebrow.',
              'Give Inbox and Pipelines a real visible title, replacing the sr-only headings.',
              'Delete the hand-rolled header markup from each workspace as it converts.',
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="text-muted-foreground font-mono text-xs tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </Section>
      </div>
    </main>
  );
}
