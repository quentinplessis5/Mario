import * as THREE from 'three';
import type {
  Checkpoint,
  SpawnPoint,
  TrackData,
} from '../types/track';
import { TUNING } from '../config/tuning';
import { TrackSpline } from './TrackSpline';
import {
  CHECKPOINT_COUNT,
  COIN_TRAILS,
  CONTROL_POINTS,
  ITEM_BOX_ROWS,
} from './circuitData';
import { buildDecor } from './TrackDecor';

/** Cross-sections used to build the ribbons (one every ~1.5 m). */
const RIBBON_STEPS = 512;

export function buildTrack(): TrackData {
  const spline = new TrackSpline(CONTROL_POINTS);
  const root = new THREE.Group();
  root.name = 'track';

  root.add(buildGroundPlane());
  root.add(buildGrassRibbon(spline));
  root.add(buildRoad(spline));
  root.add(buildCurbs(spline));
  root.add(buildStartLine(spline));
  root.add(buildBarriers(spline));
  root.add(buildDecor(spline));

  const checkpoints = buildCheckpoints(spline);
  const spawnPoints = buildSpawnPoints(spline);
  const itemBoxPositions = ITEM_BOX_ROWS.flatMap((row) =>
    row.offsets.map((off) => {
      const s = spline.sampleAtDistance(row.at * spline.totalLength);
      return s.position.clone().addScaledVector(s.right, off).setY(s.position.y + 1.2);
    }),
  );
  const coinPositions = COIN_TRAILS.flatMap((trail) =>
    Array.from({ length: trail.count }, (_, i) => {
      const t = trail.count > 1 ? i / (trail.count - 1) : 0;
      const d = trail.at * spline.totalLength + i * trail.spacing;
      const off = trail.offsetStart + (trail.offsetEnd - trail.offsetStart) * t;
      const s = spline.sampleAtDistance(d);
      return s.position.clone().addScaledVector(s.right, off).setY(s.position.y + 1.0);
    }),
  );

  const minimapOutline: { x: number; z: number }[] = [];
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < 128; i++) {
    const s = spline.sampleAtDistance((i / 128) * spline.totalLength);
    minimapOutline.push({ x: s.position.x, z: s.position.z });
    bounds.minX = Math.min(bounds.minX, s.position.x);
    bounds.maxX = Math.max(bounds.maxX, s.position.x);
    bounds.minZ = Math.min(bounds.minZ, s.position.z);
    bounds.maxZ = Math.max(bounds.maxZ, s.position.z);
  }

  return {
    query: spline,
    checkpoints,
    spawnPoints,
    itemBoxPositions,
    coinPositions,
    visualRoot: root,
    minimapOutline,
    minimapBounds: bounds,
  };
}

/**
 * Generic ribbon builder: triangulated strip following the spline between
 * two lateral offsets (fractions of road half-width or absolute meters).
 */
function buildRibbon(
  spline: TrackSpline,
  leftOf: (hw: number) => number,
  rightOf: (hw: number) => number,
  yOffset: number,
  colorOf: (step: number) => THREE.Color,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= RIBBON_STEPS; i++) {
    const s = spline.sampleAtDistance(
      ((i % RIBBON_STEPS) / RIBBON_STEPS) * spline.totalLength,
    );
    const hw = s.roadHalfWidth;
    const c = colorOf(i);
    const l = s.position.clone().addScaledVector(s.right, leftOf(hw));
    const r = s.position.clone().addScaledVector(s.right, rightOf(hw));
    positions.push(l.x, l.y + yOffset, l.z, r.x, r.y + yOffset, r.z);
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    if (i < RIBBON_STEPS) {
      // Winding chosen so faces point up (+Y).
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildRoad(spline: TrackSpline): THREE.Mesh {
  const asphalt = new THREE.Color(0x3d4148);
  const asphaltAlt = new THREE.Color(0x44484f);
  const geo = buildRibbon(
    spline,
    (hw) => -hw,
    (hw) => hw,
    0,
    (i) => (Math.floor(i / 8) % 2 === 0 ? asphalt : asphaltAlt),
  );
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'road';
  return mesh;
}

function buildCurbs(spline: TrackSpline): THREE.Group {
  const red = new THREE.Color(0xd8302f);
  const white = new THREE.Color(0xf2f2f2);
  const colorOf = (i: number) => (Math.floor(i / 4) % 2 === 0 ? red : white);
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  g.add(
    new THREE.Mesh(
      buildRibbon(spline, (hw) => -hw - 0.9, (hw) => -hw, 0.02, colorOf),
      mat,
    ),
  );
  g.add(
    new THREE.Mesh(
      buildRibbon(spline, (hw) => hw, (hw) => hw + 0.9, 0.02, colorOf),
      mat,
    ),
  );
  g.name = 'curbs';
  return g;
}

function buildGrassRibbon(spline: TrackSpline): THREE.Mesh {
  const grass = new THREE.Color(0x4caf3e);
  const grassAlt = new THREE.Color(0x55b946);
  const margin = TUNING.walls.offroadWidth + 4;
  const geo = buildRibbon(
    spline,
    (hw) => -hw - margin,
    (hw) => hw + margin,
    -0.06,
    (i) => (Math.floor(i / 16) % 2 === 0 ? grass : grassAlt),
  );
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'grass';
  return mesh;
}

/** Large flat base plane far below decorative hills, hides the void. */
function buildGroundPlane(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 1400),
    new THREE.MeshLambertMaterial({ color: 0x3f9a37 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.3;
  mesh.name = 'ground';
  return mesh;
}

/** Checkered start/finish strip across the road at distance 0. */
function buildStartLine(spline: TrackSpline): THREE.Mesh {
  const s = spline.sampleAtDistance(0);
  const hw = s.roadHalfWidth;
  const cols = 8;
  const rows = 2;
  const cellW = (hw * 2) / cols;
  const cellL = 1.4;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const black = new THREE.Color(0x1a1a1a);
  const white = new THREE.Color(0xfafafa);
  let v = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const col = (r + c) % 2 === 0 ? white : black;
      for (const [dc, dr] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const lat = -hw + (c + dc) * cellW;
        const fwd = (r + dr) * cellL;
        const p = s.position
          .clone()
          .addScaledVector(s.right, lat)
          .addScaledVector(s.forward, fwd);
        positions.push(p.x, p.y + 0.03, p.z);
        colors.push(col.r, col.g, col.b);
      }
      indices.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      v += 4;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
  mesh.name = 'startLine';
  return mesh;
}

/** Instanced posts marking the invisible wall limit on both sides. */
function buildBarriers(spline: TrackSpline): THREE.InstancedMesh {
  const spacing = 8;
  const count = Math.floor(spline.totalLength / spacing) * 2;
  const geo = new THREE.CylinderGeometry(0.25, 0.3, 1.1, 6);
  const mat = new THREE.MeshLambertMaterial({ color: 0xe8e4d8 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  let idx = 0;
  for (let d = 0; d < spline.totalLength - spacing / 2; d += spacing) {
    const s = spline.sampleAtDistance(d);
    const limit = s.roadHalfWidth + TUNING.walls.offroadWidth;
    for (const side of [-1, 1]) {
      const p = s.position.clone().addScaledVector(s.right, side * limit);
      m.setPosition(p.x, p.y + 0.5, p.z);
      if (idx < count) mesh.setMatrixAt(idx++, m);
    }
  }
  mesh.count = idx;
  mesh.name = 'barriers';
  return mesh;
}

function buildCheckpoints(spline: TrackSpline): Checkpoint[] {
  const cps: Checkpoint[] = [];
  for (let i = 0; i < CHECKPOINT_COUNT; i++) {
    const d = (i / CHECKPOINT_COUNT) * spline.totalLength;
    const s = spline.sampleAtDistance(d);
    cps.push({
      index: i,
      position: s.position.clone(),
      forward: s.forward.clone(),
      // Generous margin: off-road cutting still validates, it just loses time.
      halfWidth: s.roadHalfWidth + TUNING.walls.offroadWidth + 4,
      splineDistance: d,
    });
  }
  return cps;
}

/** 8 karts, 2 staggered columns behind the start line. */
function buildSpawnPoints(spline: TrackSpline): SpawnPoint[] {
  const spawns: SpawnPoint[] = [];
  for (let i = 0; i < TUNING.race.kartCount; i++) {
    const row = Math.floor(i / 2);
    const col = i % 2;
    const d = -8 - row * 4.5 - col * 2;
    const lateral = col === 0 ? -2.2 : 2.2;
    const s = spline.sampleAtDistance(d);
    spawns.push({
      position: s.position.clone().addScaledVector(s.right, lateral),
      heading: Math.atan2(s.forward.x, s.forward.z),
    });
  }
  return spawns;
}
