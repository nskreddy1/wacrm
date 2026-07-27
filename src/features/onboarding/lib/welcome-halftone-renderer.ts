/**
 * Canvas render loop for the welcome halftone animation.
 *
 * Ported from Twenty (twentyhq/twenty, AGPL-3.0) —
 * packages/twenty-front/src/modules/onboarding/components/WelcomeOverlay.
 * Runs on the main thread via requestAnimationFrame (Twenty also has an
 * OffscreenCanvas worker path; the dash count here is small enough that
 * the extra machinery isn't worth it).
 *
 * Three phases:
 *  1. assemble — dots fly in from a scattered ring, staggered outward
 *  2. settle   — a slow sine/cosine drift keeps the pattern alive
 *  3. burst    — on leave(), dots shoot outward and fade
 * A diagonal shimmer band sweeps across during phase 1-2.
 */

import {
  buildWelcomeHalftoneParticles,
  type WelcomeHalftoneDash,
  type WelcomeHalftoneParticle,
} from './welcome-halftone-particles';

const DASH_ASSEMBLE_DURATION_SECONDS = 0.62;
const BURST_DURATION_SECONDS = 0.75;
const SETTLE_DRIFT_DURATION_SECONDS = 0.6;
const SHIMMER_BAND_HALF_WIDTH = 0.028;
const MINIMUM_VISIBLE_OPACITY = 0.01;

const clampToUnitRange = (value: number) => Math.max(0, Math.min(1, value));
const interpolate = (from: number, to: number, ratio: number) =>
  from + (to - from) * ratio;
const easeOutCubic = (ratio: number) => 1 - Math.pow(1 - ratio, 3);
const easeOutExpo = (ratio: number) =>
  ratio >= 1 ? 1 : 1 - Math.pow(2, -10 * ratio);
const smootherStep = (ratio: number) => ratio * ratio * (3 - 2 * ratio);

type WelcomeHalftoneRendererOptions = {
  context: CanvasRenderingContext2D;
  dashes: readonly WelcomeHalftoneDash[];
  width: number;
  height: number;
  devicePixelRatio: number;
  color: string;
  highlightColor: string;
  reducedMotion: boolean;
};

export const createWelcomeHalftoneRenderer = (
  options: WelcomeHalftoneRendererOptions
) => {
  const { context, dashes, reducedMotion } = options;
  const baseColor = options.color;
  const highlightColor = options.highlightColor;

  let canvasWidth = options.width;
  let canvasHeight = options.height;
  let devicePixelRatio = options.devicePixelRatio;

  let particles: WelcomeHalftoneParticle[] = [];
  let halftoneSize = 0;
  let maxDistanceToCenter = 1;

  let firstFrameTimeMs: number | null = null;
  let leaveStartSeconds: number | null = null;
  let hasLeaveBeenRequested = false;
  let pendingFrameId: number | null = null;

  const rebuildParticlesForCurrentSize = () => {
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.lineCap = 'round';
    const layout = buildWelcomeHalftoneParticles(
      dashes,
      canvasWidth,
      canvasHeight
    );
    particles = layout.particles;
    halftoneSize = layout.halftoneSize;
    maxDistanceToCenter = layout.maxDistanceToCenter;
  };

  const computeAssembleState = (
    particle: WelcomeHalftoneParticle,
    elapsedSeconds: number
  ) => {
    const assembleProgress = easeOutExpo(
      clampToUnitRange(
        (elapsedSeconds - particle.assembleDelaySeconds) /
          DASH_ASSEMBLE_DURATION_SECONDS
      )
    );
    let particleX = interpolate(
      particle.scatterStartX,
      particle.targetX,
      assembleProgress
    );
    let particleY = interpolate(
      particle.scatterStartY,
      particle.targetY,
      assembleProgress
    );
    // Drift ramps in only after the dot has landed, so the assemble
    // motion stays crisp and the settled field never looks frozen.
    const settleDriftProgress = clampToUnitRange(
      (elapsedSeconds -
        (particle.assembleDelaySeconds + DASH_ASSEMBLE_DURATION_SECONDS)) /
        SETTLE_DRIFT_DURATION_SECONDS
    );
    particleX +=
      Math.sin(elapsedSeconds * 1.6 + particle.driftPhase) *
      settleDriftProgress *
      1.2;
    particleY +=
      Math.cos(elapsedSeconds * 1.4 + particle.driftPhase) *
      settleDriftProgress *
      0.8;
    return { particleX, particleY, opacity: assembleProgress };
  };

  const drawFrame = (timeMs: number) => {
    if (firstFrameTimeMs === null) {
      firstFrameTimeMs = timeMs;
    }
    const elapsedSeconds = (timeMs - firstFrameTimeMs) / 1000;

    // Freeze each dot's live position the instant leave() lands, so the
    // burst continues from where the assemble/drift left off.
    if (hasLeaveBeenRequested && leaveStartSeconds === null) {
      leaveStartSeconds = elapsedSeconds;
      for (const particle of particles) {
        if (reducedMotion) {
          particle.positionAtLeaveStartX = particle.targetX;
          particle.positionAtLeaveStartY = particle.targetY;
          particle.opacityAtLeaveStart = 1;
        } else {
          const assembleState = computeAssembleState(particle, elapsedSeconds);
          particle.positionAtLeaveStartX = assembleState.particleX;
          particle.positionAtLeaveStartY = assembleState.particleY;
          particle.opacityAtLeaveStart = assembleState.opacity;
        }
      }
    }

    const isLeaving = leaveStartSeconds !== null;
    const burstProgress =
      leaveStartSeconds !== null
        ? clampToUnitRange(
            (elapsedSeconds - leaveStartSeconds) / BURST_DURATION_SECONDS
          )
        : 0;

    context.clearRect(0, 0, canvasWidth, canvasHeight);

    const shimmerSweepPosition = ((elapsedSeconds * 0.5) % 1.3) / 1.3;
    const isShimmerActive = !reducedMotion && !isLeaving;
    const inverseViewportSpan = 1 / (canvasWidth + canvasHeight);
    let currentStrokeColor = '';

    for (const particle of particles) {
      let particleX: number;
      let particleY: number;
      let particleOpacity: number;
      let capsuleLength = particle.dashLength;
      let capsuleDirectionX = 1;
      let capsuleDirectionY = 0;

      if (reducedMotion) {
        particleX = particle.targetX;
        particleY = particle.targetY;
        particleOpacity = isLeaving ? 1 - burstProgress : 1;
      } else if (!isLeaving) {
        const assembleState = computeAssembleState(particle, elapsedSeconds);
        particleX = assembleState.particleX;
        particleY = assembleState.particleY;
        particleOpacity = assembleState.opacity;
      } else {
        // Outer dots travel further, which reads as an explosion rather
        // than a uniform slide.
        const easedBurstProgress = smootherStep(burstProgress);
        const outwardPushDistance =
          easedBurstProgress *
          halftoneSize *
          1.1 *
          (0.6 + 0.8 * (particle.distanceToCenter / maxDistanceToCenter));
        particleX =
          particle.positionAtLeaveStartX +
          particle.burstDirectionX * outwardPushDistance;
        particleY =
          particle.positionAtLeaveStartY +
          particle.burstDirectionY * outwardPushDistance;
        particleOpacity =
          particle.opacityAtLeaveStart *
          (1 - easeOutCubic(clampToUnitRange(burstProgress / 0.85)));
        // Stretch each dot along its flight path — a motion-blur cue.
        capsuleLength =
          particle.dashLength + outwardPushDistance * 0.12 * burstProgress;
        capsuleDirectionX = particle.burstDirectionX;
        capsuleDirectionY = particle.burstDirectionY;
      }

      if (particleOpacity <= MINIMUM_VISIBLE_OPACITY) {
        continue;
      }

      // Diagonal shimmer band: dots whose (x+y) falls inside the sweep
      // window pick up the lighter tint.
      const isParticleInShimmerBand =
        isShimmerActive &&
        Math.abs(
          (particleX + particleY) * inverseViewportSpan - shimmerSweepPosition
        ) < SHIMMER_BAND_HALF_WIDTH;
      const strokeColor = isParticleInShimmerBand ? highlightColor : baseColor;
      // strokeStyle assignment is surprisingly costly — only touch it
      // when the colour actually changes.
      if (strokeColor !== currentStrokeColor) {
        context.strokeStyle = strokeColor;
        currentStrokeColor = strokeColor;
      }

      context.globalAlpha = particleOpacity;
      context.lineWidth = particle.strokeWidth;
      context.beginPath();
      const halfCapsuleX = (capsuleDirectionX * capsuleLength) / 2;
      const halfCapsuleY = (capsuleDirectionY * capsuleLength) / 2;
      context.moveTo(particleX - halfCapsuleX, particleY - halfCapsuleY);
      context.lineTo(particleX + halfCapsuleX, particleY + halfCapsuleY);
      context.stroke();
    }

    context.globalAlpha = 1;
    pendingFrameId = requestAnimationFrame(drawFrame);
  };

  rebuildParticlesForCurrentSize();
  pendingFrameId = requestAnimationFrame(drawFrame);

  return {
    leave: () => {
      hasLeaveBeenRequested = true;
    },
    resize: (
      nextCanvasWidth: number,
      nextCanvasHeight: number,
      nextDevicePixelRatio: number
    ) => {
      canvasWidth = nextCanvasWidth;
      canvasHeight = nextCanvasHeight;
      devicePixelRatio = nextDevicePixelRatio;
      rebuildParticlesForCurrentSize();
    },
    destroy: () => {
      if (pendingFrameId !== null) {
        cancelAnimationFrame(pendingFrameId);
        pendingFrameId = null;
      }
    },
  };
};
