import * as THREE from 'three';
import type { ITrackQuery } from '../types/track';
import { angleDiff, clamp, randRange } from '../core/MathUtils';
import { TUNING } from '../config/tuning';

/**
 * Internal racing-line helpers for the AI module. Not part of the public
 * facade: only AIDriver / AIItemUser should import from this file.
 */

/** Aggregated curvature of the road ahead of a given spline distance. */
export interface CurvatureSample {
  /** Sum of |heading delta| between successive forwards (always >= 0). */
  totalTurn: number;
  /** Signed sum of heading deltas. Sign gives the dominant turn direction. */
  signedTurn: number;
}

export function createCurvatureSample(): CurvatureSample {
  return { totalTurn: 0, signedTurn: 0 };
}

/** Curvature probe offsets (meters ahead of the reference distance). */
const CURVATURE_STEPS: readonly number[] = [0, 10, 20, 30];

/** How far ahead we look to decide which side is the inside of the next turn. */
const CORNER_PROBE_DISTANCE = 25;

/** Margin kept between the picked offset and the road edge. */
export const ROAD_EDGE_MARGIN = 1.5;

/**
 * Estimates the upcoming turn by sampling the spline forwards at +0/+10/+20/+30 m
 * and accumulating the heading deltas. Writes into `out` (no allocation).
 */
export function measureCurvature(
  track: ITrackQuery,
  fromDistance: number,
  out: CurvatureSample,
): CurvatureSample {
  let total = 0;
  let signed = 0;
  let prevHeading = 0;
  for (let k = 0; k < CURVATURE_STEPS.length; k++) {
    const s = track.sampleAtDistance(fromDistance + CURVATURE_STEPS[k]);
    // Heading of a forward vector f is atan2(f.x, f.z) (project convention).
    const h = Math.atan2(s.forward.x, s.forward.z);
    if (k > 0) {
      const d = angleDiff(h, prevHeading);
      total += Math.abs(d);
      signed += d;
    }
    prevHeading = h;
  }
  out.totalTurn = total;
  out.signedTurn = signed;
  return out;
}

/** Largest usable |lateral offset| at this point of the road. */
export function offsetLimit(roadHalfWidth: number): number {
  return Math.max(0, Math.min(TUNING.ai.maxLateralOffset, roadHalfWidth - ROAD_EDGE_MARGIN));
}

/** Max comfortable lateral acceleration of the arcade kart (empirical). */
const MAX_LATERAL_ACCEL = 14;
/** Planning deceleration: braking + drag, slightly conservative. */
const PLANNING_DECEL = 16;
/** Slowest the AI will ever plan to go through a corner. */
const MIN_CORNER_SPEED = 9;
/** Length of each curvature window examined ahead (meters). */
const WINDOW_LENGTH = 12;
const WINDOW_COUNT = 5;

function headingAt(track: ITrackQuery, d: number): number {
  const s = track.sampleAtDistance(d);
  return Math.atan2(s.forward.x, s.forward.z);
}

/**
 * Speed the kart may carry RIGHT NOW so that every upcoming corner (next
 * ~60 m) stays within MAX_LATERAL_ACCEL, given it can shed speed at
 * PLANNING_DECEL on the way there. This is what makes the AI brake *before*
 * the hairpin instead of sailing into the grass.
 */
export function cornerSpeedLimit(track: ITrackQuery, fromDistance: number): number {
  let allowed = Infinity;
  let prevHeading = headingAt(track, fromDistance);
  for (let i = 1; i <= WINDOW_COUNT; i++) {
    const ahead = i * WINDOW_LENGTH;
    const h = headingAt(track, fromDistance + ahead);
    const turn = Math.abs(angleDiff(h, prevHeading));
    prevHeading = h;
    const kappa = turn / WINDOW_LENGTH;
    if (kappa < 1e-4) continue;
    const vCorner = Math.max(MIN_CORNER_SPEED, Math.sqrt(MAX_LATERAL_ACCEL / kappa));
    // Brake-distance relaxation: the corner starts one window away at least.
    const runway = Math.max(0, ahead - WINDOW_LENGTH);
    const vNow = Math.sqrt(vCorner * vCorner + 2 * PLANNING_DECEL * runway);
    allowed = Math.min(allowed, vNow);
  }
  return allowed;
}

// Scratch vectors (module-level, reused every call: no per-tick allocation).
const scratchPos = new THREE.Vector3();
const scratchRight = new THREE.Vector3();
const scratchDelta = new THREE.Vector3();

/**
 * Picks a new random lateral offset, biased toward the inside of the next
 * corner so the AI slightly "cuts" turns instead of hugging the centerline.
 *
 * The inside side is detected geometrically: the lateral deviation of the
 * centerline 25 m ahead, expressed in the local (right) frame. A positive
 * deviation means the road bends toward +right, so the inside is +right.
 */
export function pickLateralOffset(track: ITrackQuery, fromDistance: number): number {
  const here = track.sampleAtDistance(fromDistance);
  const limit = offsetLimit(here.roadHalfWidth);
  if (limit <= 0) return 0;

  // Copy the local frame before resampling (samples may reuse internal storage).
  scratchPos.copy(here.position);
  scratchRight.copy(here.right);

  const ahead = track.sampleAtDistance(fromDistance + CORNER_PROBE_DISTANCE);
  const lateralDev = scratchDelta.copy(ahead.position).sub(scratchPos).dot(scratchRight);

  // Bias toward the inside of the corner, capped so straights stay random.
  const insideBias = clamp(lateralDev * 0.08, -limit * 0.6, limit * 0.6);
  return clamp(insideBias + randRange(-1, 1) * limit * 0.7, -limit, limit);
}
