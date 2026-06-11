/**
 * Circuit v1 data: a closed loop (~750 m) inspired by classic kart circuits.
 * Layout: long start straight -> wide right sweeper -> east leg with an
 * S-section climbing a gentle hill -> tight hairpin at the summit ->
 * descending return leg -> final left/right combo back onto the straight.
 *
 * Control points are sampled by a closed Catmull-Rom spline.
 * Units: meters. Race direction follows point order (start heading +Z).
 */

export interface ControlPoint {
  x: number;
  /** Elevation. Keep variations gentle (analytic ground height). */
  y: number;
  z: number;
  /** Road half-width at this point. */
  halfWidth: number;
}

export const CONTROL_POINTS: ControlPoint[] = [
  // Start line lives at distance 0 (first point), in the middle of the main
  // straight so the starting grid behind it is dead straight.
  { x: 0, y: 0, z: 40, halfWidth: 7 },
  { x: 10, y: 0, z: 72, halfWidth: 7 },
  { x: 38, y: 0, z: 95, halfWidth: 7 },
  { x: 72, y: 0.5, z: 100, halfWidth: 7 },
  { x: 102, y: 1.5, z: 84, halfWidth: 6.5 },
  { x: 116, y: 2.5, z: 54, halfWidth: 6.5 },
  { x: 110, y: 3.5, z: 24, halfWidth: 6.5 },
  { x: 117, y: 4.5, z: -6, halfWidth: 6.5 }, // S-section, climbing
  { x: 107, y: 5.5, z: -36, halfWidth: 6.5 },
  { x: 114, y: 6, z: -66, halfWidth: 6.5 }, // hilltop
  { x: 106, y: 5.5, z: -90, halfWidth: 6 },
  { x: 88, y: 5, z: -104, halfWidth: 6.5 }, // hairpin apex
  { x: 72, y: 4.5, z: -96, halfWidth: 6.5 },
  { x: 66, y: 4, z: -76, halfWidth: 6.5 },
  { x: 48, y: 3, z: -64, halfWidth: 6.5 },
  { x: 24, y: 2, z: -74, halfWidth: 7 }, // descending return leg
  { x: 2, y: 1, z: -92, halfWidth: 7 },
  { x: -24, y: 0.5, z: -96, halfWidth: 7 },
  { x: -34, y: 0, z: -76, halfWidth: 7 }, // final corner
  { x: -22, y: 0, z: -52, halfWidth: 7 },
  { x: 0, y: 0, z: -15, halfWidth: 7 }, // onto the main straight
];

export const CHECKPOINT_COUNT = 14;

/** Placement along the spline: fraction of total length + lateral offsets. */
export interface RowPlacement {
  /** Fraction of total spline length (0..1). */
  at: number;
  /** Lateral offsets (negative = left). */
  offsets: number[];
}

/** Rows of item boxes across the road. */
export const ITEM_BOX_ROWS: RowPlacement[] = [
  { at: 0.16, offsets: [-4.5, -1.5, 1.5, 4.5] },
  { at: 0.47, offsets: [-4.5, -1.5, 1.5, 4.5] },
  { at: 0.78, offsets: [-3.5, 0, 3.5] },
];

/** Coin groups: a short trail of coins spaced along the spline. */
export interface CoinTrail {
  /** Start fraction of total length. */
  at: number;
  /** Number of coins. */
  count: number;
  /** Spacing in meters between coins. */
  spacing: number;
  /** Lateral offset of the first coin. */
  offsetStart: number;
  /** Lateral offset of the last coin (lerped). */
  offsetEnd: number;
}

export const COIN_TRAILS: CoinTrail[] = [
  { at: 0.05, count: 6, spacing: 5, offsetStart: -2.5, offsetEnd: 2.5 },
  { at: 0.36, count: 5, spacing: 5, offsetStart: 3, offsetEnd: 3 },
  { at: 0.6, count: 4, spacing: 4, offsetStart: -2, offsetEnd: -2 },
  { at: 0.88, count: 5, spacing: 5, offsetStart: 0, offsetEnd: 0 },
];
