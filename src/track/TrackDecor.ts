import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import type { TrackSpline } from './TrackSpline';

/** Deterministic pseudo-random (decor must not change between runs). */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/**
 * Pure-visual decor placed OUTSIDE the drivable area: trees, background
 * hills, a start arch and a few clouds. No collision.
 */
export function buildDecor(spline: TrackSpline): THREE.Group {
  const g = new THREE.Group();
  g.name = 'decor';
  g.add(buildTrees(spline));
  g.add(buildHills());
  g.add(buildStartArch(spline));
  g.add(buildClouds());
  return g;
}

function buildTrees(spline: TrackSpline): THREE.Group {
  const rng = makeRng(1234567);
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 2.2, 6);
  const crownGeo = new THREE.ConeGeometry(2.2, 4.5, 7);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a4f2a });
  const crownMat = new THREE.MeshLambertMaterial({ color: 0x2e8b2e });
  const crownMatAlt = new THREE.MeshLambertMaterial({ color: 0x3da23d });

  const count = 90;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, count);
  const crownsAlt = new THREE.InstancedMesh(crownGeo, crownMatAlt, count);
  const m = new THREE.Matrix4();
  let nTrunk = 0;
  let nA = 0;
  let nB = 0;

  for (let i = 0; i < count; i++) {
    // Pick a spot near the track but safely outside the wall limit.
    const d = rng() * spline.totalLength;
    const s = spline.sampleAtDistance(d);
    const side = rng() < 0.5 ? -1 : 1;
    const limit = s.roadHalfWidth + TUNING.walls.offroadWidth;
    const off = side * (limit + 6 + rng() * 22);
    const p = s.position.clone().addScaledVector(s.right, off);
    // Reject spots that are actually close to ANOTHER part of the track
    // (e.g. inside the hairpin) by re-checking the true closest point.
    const cp = spline.closestPoint(p, d);
    if (Math.abs(cp.lateralOffset) < spline.wallLimitAt(cp) + 4) continue;
    const scale = 0.8 + rng() * 0.7;
    const groundY = cp.position.y;

    m.makeScale(scale, scale, scale);
    m.setPosition(p.x, groundY + 1.1 * scale, p.z);
    trunks.setMatrixAt(nTrunk++, m);
    m.makeScale(scale, scale, scale);
    m.setPosition(p.x, groundY + (2.2 + 2.0) * scale, p.z);
    if (rng() < 0.5) crowns.setMatrixAt(nA++, m);
    else crownsAlt.setMatrixAt(nB++, m);
  }
  trunks.count = nTrunk;
  crowns.count = nA;
  crownsAlt.count = nB;
  const g = new THREE.Group();
  g.add(trunks, crowns, crownsAlt);
  g.name = 'trees';
  return g;
}

/** Big soft hills far away, for the horizon. */
function buildHills(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x67c258 });
  const matFar = new THREE.MeshLambertMaterial({ color: 0x8fd07f });
  const rng = makeRng(424242);
  for (let i = 0; i < 14; i++) {
    const angle = (i / 14) * Math.PI * 2 + rng() * 0.3;
    const radius = 280 + rng() * 180;
    const w = 90 + rng() * 120;
    const h = 25 + rng() * 35;
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 7), i % 2 ? mat : matFar);
    hill.scale.set(w, h, w * 0.8);
    hill.position.set(Math.cos(angle) * radius, -h * 0.35, Math.sin(angle) * radius);
    g.add(hill);
  }
  g.name = 'hills';
  return g;
}

/** Arch over the start line. */
function buildStartArch(spline: TrackSpline): THREE.Group {
  const s = spline.sampleAtDistance(0);
  const hw = s.roadHalfWidth + 1.5;
  const g = new THREE.Group();
  const postGeo = new THREE.CylinderGeometry(0.5, 0.6, 7, 8);
  const postMat = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, postMat);
    const p = s.position.clone().addScaledVector(s.right, side * hw);
    post.position.set(p.x, p.y + 3.5, p.z);
    g.add(post);
  }
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(hw * 2 + 1.2, 1.6, 0.6),
    new THREE.MeshLambertMaterial({ color: 0xd8302f }),
  );
  banner.position.set(s.position.x, s.position.y + 7.3, s.position.z);
  banner.rotation.y = Math.atan2(s.forward.x, s.forward.z);
  g.add(banner);
  g.name = 'startArch';
  return g;
}

function buildClouds(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const rng = makeRng(777);
  for (let i = 0; i < 10; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + Math.floor(rng() * 3);
    for (let j = 0; j < puffs; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(6 + rng() * 5, 7, 5), mat);
      puff.position.set(j * 8 - puffs * 4, rng() * 3, rng() * 4);
      puff.scale.y = 0.55;
      cloud.add(puff);
    }
    const angle = rng() * Math.PI * 2;
    const radius = 220 + rng() * 200;
    cloud.position.set(Math.cos(angle) * radius, 55 + rng() * 30, Math.sin(angle) * radius);
    g.add(cloud);
  }
  g.name = 'clouds';
  return g;
}
