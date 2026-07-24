import type { Metadata } from 'next';
import {
  AxonLogo,
  AxonMark,
  type AxonVariant,
} from '@/features/brand/components/axon-logo';

export const metadata: Metadata = {
  title: 'Axon — Brand Preview',
  description: 'Logo variants for the Axon omnichannel CRM brand.',
};

const VARIANTS: {
  id: AxonVariant;
  name: string;
  note: string;
  bg: string;
  fg: string;
}[] = [
  {
    id: 'primary',
    name: 'Variant 1 — Primary (theme accent)',
    note: "Mark colored by the active theme's --primary token. Follows the global accent (indigo by default) automatically.",
    bg: '#ffffff',
    fg: '#0f172a',
  },
  {
    id: 'mono',
    name: 'Variant 2 — Monochrome',
    note: 'Single-ink, inherits surrounding text color. Timeless, premium, works anywhere.',
    bg: '#ffffff',
    fg: '#0f172a',
  },
  {
    id: 'inverse',
    name: 'Variant 3 — Inverse (dark)',
    note: 'Solid white mark for dark surfaces, the auth brand panel, and dark mode.',
    bg: '#0b1220',
    fg: '#ffffff',
  },
];

export default function BrandPage() {
  return (
    <main
      style={{ background: '#f6f7f9', color: '#0f172a' }}
      className="min-h-screen px-6 py-12 font-sans"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-10">
        <header className="flex flex-col gap-2">
          <p className="text-primary text-xs font-semibold tracking-widest uppercase">
            Brand preview
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-balance">
            Axon — logo variants
          </h1>
          <p className="max-w-xl text-sm leading-relaxed text-slate-600">
            The mark is an abstract &ldquo;A&rdquo; drawn as a rising signal
            path with a synapse node at the apex &mdash; the axon carrying every
            customer message across WhatsApp, SMS, and email.
          </p>
        </header>

        <section
          className="grid gap-6 md:grid-cols-2"
          aria-label="Logo variants"
        >
          {VARIANTS.map((v) => (
            <div
              key={v.id}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
            >
              <div
                className="flex flex-col items-center justify-center gap-6 px-8 py-12"
                style={{ background: v.bg }}
              >
                <AxonMark size={72} variant={v.id} />
                <AxonLogo size={30} variant={v.id} />
              </div>
              <div className="flex flex-col gap-2 border-t border-slate-100 px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold">{v.name}</h2>
                  <div
                    className="flex items-end gap-3 rounded-lg px-2 py-1"
                    style={{
                      background: v.bg === '#ffffff' ? '#f8fafc' : v.bg,
                    }}
                    aria-label="Small size legibility check"
                  >
                    <AxonMark size={32} variant={v.id} />
                    <AxonMark size={20} variant={v.id} />
                    <AxonMark size={16} variant={v.id} />
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  {v.note}
                </p>
              </div>
            </div>
          ))}
        </section>

        <section
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          aria-label="Name rationale"
        >
          <h2 className="text-sm font-semibold">Why &ldquo;Axon&rdquo;</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            An axon is the nerve fiber that transmits signals through the
            nervous system. Axon is the communication nervous system of your
            business &mdash; one platform transmitting every conversation,
            across every channel, to the right person. Short, scientific, two
            syllables, globally pronounceable, and enterprise-grade.
          </p>
        </section>

        <p className="text-xs text-slate-400">
          Pick a variant and I&apos;ll apply it across the app (sidebar, login,
          favicon) and export the assets.
        </p>
      </div>
    </main>
  );
}
