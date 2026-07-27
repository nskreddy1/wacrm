/**
 * Halftone particle layout for the welcome overlay.
 *
 * Ported from Twenty (twentyhq/twenty, AGPL-3.0) —
 * packages/twenty-front/src/modules/onboarding/components/WelcomeOverlay.
 *
 * Each entry in WELCOME_HALFTONE_DASHES is a capsule in the source
 * SVG viewBox: [startX, endX, y, strokeWidth]. This module maps those
 * viewBox coordinates onto the live canvas and precomputes the
 * per-particle animation constants (scatter origin, burst direction,
 * stagger delay, drift phase) so the render loop stays allocation-free.
 */

const TAU = Math.PI * 2;
const VIEWBOX_WIDTH = 297.037;
const VIEWBOX_CENTER_X = 148.5;
const VIEWBOX_CENTER_Y = 119.5;
const ASSEMBLE_STAGGER_SECONDS = 0.18;
const ASSEMBLE_JITTER_SECONDS = 0.12;
const MINIMUM_STROKE_WIDTH = 0.6;

export type WelcomeHalftoneParticle = {
  targetX: number;
  targetY: number;
  scatterStartX: number;
  scatterStartY: number;
  dashLength: number;
  strokeWidth: number;
  burstDirectionX: number;
  burstDirectionY: number;
  distanceToCenter: number;
  assembleDelaySeconds: number;
  driftPhase: number;
  positionAtLeaveStartX: number;
  positionAtLeaveStartY: number;
  opacityAtLeaveStart: number;
};

export type WelcomeHalftoneDash = readonly [number, number, number, number];

export type WelcomeHalftoneParticleLayout = {
  particles: WelcomeHalftoneParticle[];
  halftoneSize: number;
  maxDistanceToCenter: number;
};

/** Deterministic hash-noise — same layout every run, no RNG state. */
const pseudoRandomFromSeed = (seed: number) => {
  const noise = Math.sin(seed) * 43758.5453;
  return noise - Math.floor(noise);
};

export const buildWelcomeHalftoneParticles = (
  dashes: readonly WelcomeHalftoneDash[],
  canvasWidth: number,
  canvasHeight: number
): WelcomeHalftoneParticleLayout => {
  // Overscale the artwork past the viewport so the dense dot clusters
  // bleed off both edges and leave the centre clear for the title.
  const halftoneSize = Math.max(canvasWidth * 1.05, canvasHeight * 1.3);
  const viewboxToCanvasScale = halftoneSize / VIEWBOX_WIDTH;
  const canvasCenterX = canvasWidth / 2;
  const canvasCenterY = canvasHeight / 2;
  const maxDistanceToCenter =
    Math.hypot(VIEWBOX_CENTER_X, VIEWBOX_CENTER_Y) * viewboxToCanvasScale || 1;

  const particles = dashes.map(
    ([dashStartX, dashEndX, dashY, dashStrokeWidth], dashIndex) => {
      const targetX =
        canvasCenterX +
        ((dashStartX + dashEndX) / 2 - VIEWBOX_CENTER_X) * viewboxToCanvasScale;
      const targetY =
        canvasCenterY + (dashY - VIEWBOX_CENTER_Y) * viewboxToCanvasScale;
      const distanceToCenter = Math.hypot(
        targetX - canvasCenterX,
        targetY - canvasCenterY
      );
      const scatterAngle = pseudoRandomFromSeed(dashIndex * 1.3) * TAU;
      const scatterRadius =
        halftoneSize * (0.35 + 0.5 * pseudoRandomFromSeed(dashIndex * 2.1));

      return {
        targetX,
        targetY,
        scatterStartX: canvasCenterX + Math.cos(scatterAngle) * scatterRadius,
        scatterStartY: canvasCenterY + Math.sin(scatterAngle) * scatterRadius,
        dashLength: Math.max(dashEndX - dashStartX, 0) * viewboxToCanvasScale,
        strokeWidth: Math.max(
          dashStrokeWidth * viewboxToCanvasScale,
          MINIMUM_STROKE_WIDTH
        ),
        // Unit vector pointing away from centre — reused for the
        // outward burst when the overlay leaves.
        burstDirectionX:
          distanceToCenter > 0 ? (targetX - canvasCenterX) / distanceToCenter : 0,
        burstDirectionY:
          distanceToCenter > 0
            ? (targetY - canvasCenterY) / distanceToCenter
            : -1,
        distanceToCenter,
        // Outer dots land last, so the pattern reads as growing outward.
        assembleDelaySeconds:
          ASSEMBLE_STAGGER_SECONDS * (distanceToCenter / maxDistanceToCenter) +
          ASSEMBLE_JITTER_SECONDS * pseudoRandomFromSeed(dashIndex * 3.7),
        driftPhase: pseudoRandomFromSeed(dashIndex * 5.1) * TAU,
        positionAtLeaveStartX: 0,
        positionAtLeaveStartY: 0,
        opacityAtLeaveStart: 0,
      };
    }
  );

  return { particles, halftoneSize, maxDistanceToCenter };
};
