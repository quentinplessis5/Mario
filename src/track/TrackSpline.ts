import * as THREE from 'three';
import type {
  ClosestPointResult,
  ITrackQuery,
  SplineSample,
} from '../types/track';
import type { SurfaceType } from '../types/kart';
import { TUNING } from '../config/tuning';
import { mod } from '../core/MathUtils';
import type { ControlPoint } from './circuitData';

const TABLE_SIZE = 2048;
/** Local search window (in table samples) around the hint. */
const SEARCH_WINDOW = 40;

const UP = new THREE.Vector3(0, 1, 0);

interface TableEntry {
  position: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  distance: number;
  halfWidth: number;
}

/**
 * Closed Catmull-Rom centerline with a precomputed uniform arc-length table.
 * Single source of truth for ground height, surface, walls and progression.
 */
export class TrackSpline implements ITrackQuery {
  readonly totalLength: number;
  private table: TableEntry[] = [];

  constructor(points: ControlPoint[]) {
    // Dense parametric sampling first, to measure arc length.
    const dense = 4096;
    const raw: { p: THREE.Vector3; hw: number; d: number }[] = [];
    let length = 0;
    let prev: THREE.Vector3 | null = null;
    for (let i = 0; i < dense; i++) {
      const u = (i / dense) * points.length;
      const seg = Math.floor(u);
      const t = u - seg;
      const p = catmullRom(points, seg, t);
      const hw = lerpHalfWidth(points, seg, t);
      if (prev) length += p.distanceTo(prev);
      raw.push({ p, hw, d: length });
      prev = p;
    }
    // Close the loop.
    length += raw[raw.length - 1].p.distanceTo(raw[0].p);
    this.totalLength = length;

    // Resample to a uniform-distance table.
    let cursor = 0;
    for (let i = 0; i < TABLE_SIZE; i++) {
      const d = (i / TABLE_SIZE) * length;
      while (cursor < raw.length - 1 && raw[cursor + 1].d < d) cursor++;
      const a = raw[cursor];
      const b = raw[(cursor + 1) % raw.length];
      const span = (cursor + 1 < raw.length ? b.d : length) - a.d;
      const t = span > 1e-6 ? (d - a.d) / span : 0;
      const position = a.p.clone().lerp(b.p, t);
      this.table.push({
        position,
        forward: new THREE.Vector3(),
        right: new THREE.Vector3(),
        distance: d,
        halfWidth: a.hw + (b.hw - a.hw) * t,
      });
    }
    // Forward = central difference between neighbors; right = up x forward.
    for (let i = 0; i < TABLE_SIZE; i++) {
      const prev2 = this.table[(i - 1 + TABLE_SIZE) % TABLE_SIZE].position;
      const next = this.table[(i + 1) % TABLE_SIZE].position;
      const e = this.table[i];
      e.forward.subVectors(next, prev2).normalize();
      e.right.crossVectors(UP, e.forward).normalize();
    }
  }

  sampleAtDistance(d: number): SplineSample {
    const dd = mod(d, this.totalLength);
    const f = (dd / this.totalLength) * TABLE_SIZE;
    const i = Math.floor(f) % TABLE_SIZE;
    const t = f - Math.floor(f);
    const a = this.table[i];
    const b = this.table[(i + 1) % TABLE_SIZE];
    return {
      position: a.position.clone().lerp(b.position, t),
      forward: a.forward.clone().lerp(b.forward, t).normalize(),
      right: a.right.clone().lerp(b.right, t).normalize(),
      distance: dd,
      roadHalfWidth: a.halfWidth + (b.halfWidth - a.halfWidth) * t,
    };
  }

  closestPoint(p: THREE.Vector3, hint: number): ClosestPointResult {
    const hintIdx = Math.round(
      (mod(hint, this.totalLength) / this.totalLength) * TABLE_SIZE,
    );
    let best = this.searchWindow(p, hintIdx, SEARCH_WINDOW, 1);
    // Aberrant hint (teleport/respawn): fall back to a coarse global search.
    const maxD = TUNING.respawn.maxLateralDistance;
    if (best.distSq > maxD * maxD) {
      best = this.searchWindow(p, 0, TABLE_SIZE / 2, 4);
      best = this.searchWindow(p, best.index, 8, 1);
    }
    return this.refine(p, best.index);
  }

  groundHeightAt(result: ClosestPointResult): number {
    return result.position.y;
  }

  surfaceAt(result: ClosestPointResult): SurfaceType {
    return Math.abs(result.lateralOffset) <= result.roadHalfWidth
      ? 'ROAD'
      : 'OFFROAD';
  }

  wallLimitAt(result: ClosestPointResult): number {
    return result.roadHalfWidth + TUNING.walls.offroadWidth;
  }

  private searchWindow(
    p: THREE.Vector3,
    center: number,
    radius: number,
    stride: number,
  ): { index: number; distSq: number } {
    let bestIdx = mod(center, TABLE_SIZE);
    let bestSq = Infinity;
    for (let o = -radius; o <= radius; o += stride) {
      const i = mod(center + o, TABLE_SIZE);
      const dSq = this.table[i].position.distanceToSquared(p);
      if (dSq < bestSq) {
        bestSq = dSq;
        bestIdx = i;
      }
    }
    return { index: bestIdx, distSq: bestSq };
  }

  /** Project p on the two segments adjacent to the best table sample. */
  private refine(p: THREE.Vector3, index: number): ClosestPointResult {
    const prevI = mod(index - 1, TABLE_SIZE);
    const nextI = mod(index + 1, TABLE_SIZE);
    const a = this.projectOnSegment(p, prevI, index);
    const b = this.projectOnSegment(p, index, nextI);
    const win = a.distSq <= b.distSq ? a : b;

    const ea = this.table[win.i0];
    const eb = this.table[win.i1];
    const t = win.t;
    const position = ea.position.clone().lerp(eb.position, t);
    const forward = ea.forward.clone().lerp(eb.forward, t).normalize();
    const right = ea.right.clone().lerp(eb.right, t).normalize();
    // Segment distance accounting for table wrap.
    const segLen = this.totalLength / TABLE_SIZE;
    const distance = mod(ea.distance + segLen * t, this.totalLength);
    const roadHalfWidth = ea.halfWidth + (eb.halfWidth - ea.halfWidth) * t;
    const lateralOffset =
      (p.x - position.x) * right.x + (p.z - position.z) * right.z;
    return { position, forward, right, distance, roadHalfWidth, lateralOffset };
  }

  private projectOnSegment(
    p: THREE.Vector3,
    i0: number,
    i1: number,
  ): { i0: number; i1: number; t: number; distSq: number } {
    const a = this.table[i0].position;
    const b = this.table[i1].position;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const lenSq = abx * abx + aby * aby + abz * abz;
    let t = 0;
    if (lenSq > 1e-9) {
      t =
        ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / lenSq;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
    }
    const cx = a.x + abx * t - p.x;
    const cy = a.y + aby * t - p.y;
    const cz = a.z + abz * t - p.z;
    return { i0, i1, t, distSq: cx * cx + cy * cy + cz * cz };
  }
}

/** Closed Catmull-Rom (uniform) on the control point list. */
function catmullRom(
  points: ControlPoint[],
  seg: number,
  t: number,
): THREE.Vector3 {
  const n = points.length;
  const p0 = points[mod(seg - 1, n)];
  const p1 = points[mod(seg, n)];
  const p2 = points[mod(seg + 1, n)];
  const p3 = points[mod(seg + 2, n)];
  const t2 = t * t;
  const t3 = t2 * t;
  const out = new THREE.Vector3();
  out.x = crSpline(p0.x, p1.x, p2.x, p3.x, t, t2, t3);
  out.y = crSpline(p0.y, p1.y, p2.y, p3.y, t, t2, t3);
  out.z = crSpline(p0.z, p1.z, p2.z, p3.z, t, t2, t3);
  return out;
}

function crSpline(
  v0: number,
  v1: number,
  v2: number,
  v3: number,
  t: number,
  t2: number,
  t3: number,
): number {
  return (
    0.5 *
    (2 * v1 +
      (-v0 + v2) * t +
      (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 +
      (-v0 + 3 * v1 - 3 * v2 + v3) * t3)
  );
}

function lerpHalfWidth(points: ControlPoint[], seg: number, t: number): number {
  const n = points.length;
  const a = points[mod(seg, n)].halfWidth;
  const b = points[mod(seg + 1, n)].halfWidth;
  return a + (b - a) * t;
}
