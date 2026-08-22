// TEMPORARY — DELETE AFTER FOUNDER SELECTION (see docs/brand/assets/concepts/DECISION.md)
// Inline React versions of the three concept SVGs so each mark can be
// rendered at any size / color variant on any surface. The canonical
// static assets live in docs/brand/assets/concepts/.

export type MarkColors = {
  /** primary shape color */
  primary: string
  /** the Signal accent (pass same as primary for monochrome) */
  accent: string
}

type MarkProps = MarkColors & {
  size: number
  title: string
}

export function ApexMark({ size, primary, accent, title }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" role="img" aria-label={title}>
      <path
        fill={primary}
        fillRule="evenodd"
        d="M256 76 L452 436 L364 436 L327 364 L185 364 L148 436 L60 436 Z M256 186 L305 316 L207 316 Z"
      />
      <path d="M150 460 L338 52" stroke={accent} strokeWidth={34} strokeLinecap="butt" fill="none" />
    </svg>
  )
}

export function AugmentMark({ size, primary, accent, title }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" role="img" aria-label={title}>
      <path fill={primary} d="M96 344 L272 272 L384 344 L208 416 Z" />
      <path fill={accent} d="M160 200 L336 128 L448 200 L272 272 Z" />
    </svg>
  )
}

export function AxisMark({ size, primary, accent, title }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" role="img" aria-label={title}>
      <g fill="none" strokeWidth={40} strokeLinecap="butt" strokeLinejoin="miter">
        <path stroke={primary} d="M116 412 L256 100 L396 412" />
        <path stroke={accent} d="M396 412 L116 184" />
      </g>
    </svg>
  )
}

export const CONCEPTS = [
  {
    id: "apex",
    name: "Concept 1 — Apex",
    idea: "Solid geometric A; one Signal diagonal cuts through to form the X. Technical, premium, immediately recognizable.",
    Mark: ApexMark,
  },
  {
    id: "augment",
    name: "Concept 2 — Augment",
    idea: "A base plane and an offset rising plane sharing one vertex — one becomes two. Abstract, enterprise, mysterious.",
    Mark: AugmentMark,
  },
  {
    id: "axis",
    name: "Concept 3 — Axis",
    idea: "One unbroken stroke draws A and X as a ligature — the original continuous-stroke idea, actually delivered.",
    Mark: AxisMark,
  },
] as const
