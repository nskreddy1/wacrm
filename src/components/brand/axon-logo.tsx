import type { CSSProperties } from "react";

/* ------------------------------------------------------------------
 * Axon brand mark — minimal geometric.
 *
 * Concept: an abstract "A" formed by a rising signal path with a
 * node (synapse) at the apex — the axon transmitting a message.
 * Built from 3 geometric elements so it stays legible at 16px.
 * ------------------------------------------------------------------ */

export type AxonVariant = "emerald" | "navy" | "mono" | "inverse";

const PALETTES: Record<
  AxonVariant,
  { mark: string; node: string; text: string }
> = {
  emerald: { mark: "#047857", node: "#34d399", text: "#0f172a" },
  navy: { mark: "#1e3a5f", node: "#2dd4bf", text: "#0f172a" },
  // `currentColor` lets the mono mark inherit its color from the
  // surrounding text — it adapts to light/dark themes for free.
  mono: { mark: "currentColor", node: "currentColor", text: "currentColor" },
  inverse: { mark: "#ffffff", node: "#34d399", text: "#ffffff" },
};

export function AxonMark({
  size = 32,
  variant = "emerald",
  className,
  style,
}: {
  size?: number;
  variant?: AxonVariant;
  className?: string;
  style?: CSSProperties;
}) {
  const p = PALETTES[variant];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      role="img"
      aria-label="Axon"
    >
      {/* Rising signal path forming an abstract "A" */}
      <path
        d="M6 40 L20 12 a4.5 4.5 0 0 1 8 0 L42 40"
        stroke={p.mark}
        strokeWidth={7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Synapse node at the apex */}
      <circle cx={24} cy={11} r={5} fill={p.node} />
    </svg>
  );
}

export function AxonLogo({
  size = 32,
  variant = "emerald",
  className,
}: {
  size?: number;
  variant?: AxonVariant;
  className?: string;
}) {
  const p = PALETTES[variant];
  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: size * 0.3 }}
    >
      <AxonMark size={size} variant={variant} />
      <span
        style={{
          color: p.text,
          fontSize: size * 0.78,
          fontWeight: 700,
          letterSpacing: "-0.03em",
          lineHeight: 1,
          fontFamily: "inherit",
        }}
      >
        axon
      </span>
    </span>
  );
}
