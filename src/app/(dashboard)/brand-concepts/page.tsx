// TEMPORARY — DELETE AFTER FOUNDER SELECTION
// Not linked from navigation, sidebar, or sitemap. Founder-review surface
// for the three Auxelon logo concepts (docs/brand/assets/concepts/).
// Selection is recorded in docs/brand/assets/concepts/DECISION.md.

import { CONCEPTS, type MarkColors } from "./concept-marks"

const INK = "#0A0A0B"
const BONE = "#F5F4F2"
const SIGNAL = "#3E6FF4"

// A mark that only works large is a poster, not a product mark — judge at 16px.
const SIZES = [160, 48, 32, 24, 16] as const

type Variant = { label: string; colors: MarkColors; surface: "dark" | "light" }

const VARIANTS: Variant[] = [
  { label: "Two-tone on Ink", colors: { primary: BONE, accent: SIGNAL }, surface: "dark" },
  { label: "Two-tone on light", colors: { primary: INK, accent: SIGNAL }, surface: "light" },
  { label: "Monochrome on Ink", colors: { primary: BONE, accent: BONE }, surface: "dark" },
  { label: "Signal-only", colors: { primary: SIGNAL, accent: SIGNAL }, surface: "light" },
  { label: "Black-only", colors: { primary: INK, accent: INK }, surface: "light" },
  { label: "White-only", colors: { primary: BONE, accent: BONE }, surface: "dark" },
]

export const metadata = {
  title: "Brand concepts (temporary)",
  robots: { index: false, follow: false },
}

export default function BrandConceptsPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-6 py-10">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Temporary — delete after founder selection
        </p>
        <h1 className="text-2xl font-semibold text-balance">Auxelon logo concepts</h1>
        <p className="max-w-2xl leading-relaxed text-muted-foreground">
          Three hand-crafted candidate marks. Judge each at 16px first, then across the color and
          surface variants. Record the pick in{" "}
          <code className="font-mono text-sm">docs/brand/assets/concepts/DECISION.md</code>.
        </p>
      </header>

      {CONCEPTS.map(({ id, name, idea, Mark }) => (
        <section key={id} className="flex flex-col gap-6 border-t border-border pt-8">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">{name}</h2>
            <p className="max-w-2xl leading-relaxed text-muted-foreground">{idea}</p>
          </div>

          {/* size ramp: large → favicon */}
          <div className="flex flex-wrap items-end gap-6 rounded-md p-6" style={{ backgroundColor: INK }}>
            {SIZES.map((size) => (
              <div key={size} className="flex flex-col items-center gap-2">
                <Mark size={size} primary={BONE} accent={SIGNAL} title={`${name} at ${size}px`} />
                <span className="font-mono text-xs" style={{ color: BONE }}>
                  {size}px
                </span>
              </div>
            ))}
          </div>

          {/* color / surface variants at product sizes */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {VARIANTS.map((v) => (
              <div
                key={v.label}
                className="flex flex-col items-center gap-3 rounded-md border border-border p-5"
                style={{ backgroundColor: v.surface === "dark" ? INK : BONE }}
              >
                <div className="flex items-end gap-4">
                  <Mark size={48} {...v.colors} title={`${name} — ${v.label} 48px`} />
                  <Mark size={24} {...v.colors} title={`${name} — ${v.label} 24px`} />
                  <Mark size={16} {...v.colors} title={`${name} — ${v.label} 16px`} />
                </div>
                <span
                  className="font-mono text-xs"
                  style={{ color: v.surface === "dark" ? BONE : INK }}
                >
                  {v.label}
                </span>
              </div>
            ))}
          </div>

          {/* horizontal lockup — wordmark in real Geist via CSS, never SVG <text> */}
          <div
            className="flex items-center gap-5 rounded-md px-8 py-7"
            style={{ backgroundColor: INK }}
          >
            <Mark size={44} primary={BONE} accent={SIGNAL} title={`${name} lockup mark`} />
            <span
              className="font-sans text-2xl font-medium uppercase"
              style={{ color: BONE, letterSpacing: "0.08em" }}
            >
              Auxelon
            </span>
          </div>
        </section>
      ))}

      <footer className="border-t border-border pt-6 text-sm leading-relaxed text-muted-foreground">
        <p>
          After selection: winner becomes{" "}
          <code className="font-mono">docs/brand/assets/auxelon-logo-mark.svg</code> +{" "}
          <code className="font-mono">auxelon-logo-lockup.svg</code>, brand-strategy.md §8 is
          updated, and this page plus the concepts folder are deleted.
        </p>
      </footer>
    </main>
  )
}
