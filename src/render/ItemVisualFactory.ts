import * as THREE from 'three';

/**
 * Item visual factories. Every function returns a THREE.Group whose origin
 * sits at the logical ground point of the object (so callers can simply copy
 * the simulation position into group.position).
 *
 * Convention: when a child must spin independently of the group (item box),
 * it is exposed through group.userData.spin (THREE.Object3D).
 */

function toon(color: number): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color });
}

/**
 * Floating translucent iridescent cube. MeshNormalMaterial gives a cheap
 * rainbow sheen that shifts as the cube rotates. The rotating child is
 * exposed via userData.spin; the group origin stays at the ground.
 */
export function createItemBoxVisual(): THREE.Group {
  const group = new THREE.Group();

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 1.1, 1.1),
    new THREE.MeshNormalMaterial({
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    }),
  );
  cube.position.y = 1.0;
  group.add(cube);

  // Bright inner core standing in for the "?" mark.
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.4, 0.4),
    new THREE.MeshBasicMaterial({ color: 0xfff6c8 }),
  );
  cube.add(core);

  group.userData.spin = cube;
  return group;
}

/** Flat golden metallic coin, standing upright, origin at the ground. */
export function createCoinVisual(): THREE.Group {
  const group = new THREE.Group();

  const coin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 0.08, 16),
    new THREE.MeshStandardMaterial({
      color: 0xffd24a,
      metalness: 0.85,
      roughness: 0.3,
    }),
  );
  coin.rotation.x = Math.PI / 2; // face the player, spin via group yaw
  coin.position.y = 0.6;
  group.add(coin);

  return group;
}

/** Squashed sphere dome (green or red) over a white rim, origin at ground. */
export function createShellVisual(type: 'GREEN' | 'RED'): THREE.Group {
  const group = new THREE.Group();
  const shellColor = type === 'GREEN' ? 0x2fae46 : 0xe23d3d;

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    toon(shellColor),
  );
  dome.scale.y = 0.75;
  dome.position.y = 0.14;
  group.add(dome);

  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.56, 0.6, 0.16, 14),
    toon(0xf5f0e6),
  );
  rim.position.y = 0.1;
  group.add(rim);

  return group;
}

/** Curved yellow banana made of a few overlapping spheres, origin at ground. */
export function createBananaVisual(): THREE.Group {
  const group = new THREE.Group();
  const peelMat = toon(0xf5cf3a);

  // Three overlapping squashed spheres laid along an arc form the curve.
  const segGeo = new THREE.SphereGeometry(0.2, 8, 6);
  const segments: { pos: [number, number, number]; scale: [number, number, number] }[] = [
    { pos: [0, 0.16, -0.26], scale: [0.8, 0.9, 1.1] },
    { pos: [0, 0.28, 0], scale: [0.85, 1.0, 1.3] },
    { pos: [0, 0.16, 0.26], scale: [0.8, 0.9, 1.1] },
  ];
  for (const s of segments) {
    const seg = new THREE.Mesh(segGeo, peelMat);
    seg.position.set(s.pos[0], s.pos[1], s.pos[2]);
    seg.scale.set(s.scale[0], s.scale[1], s.scale[2]);
    group.add(seg);
  }

  // Small dark tips at both ends.
  const tipGeo = new THREE.SphereGeometry(0.06, 6, 4);
  const tipMat = toon(0x6b4a26);
  for (const z of [-0.38, 0.38]) {
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.set(0, 0.12, z);
    group.add(tip);
  }

  return group;
}

/** Red mushroom with white dots (roulette/HUD usage), origin at ground. */
export function createMushroomVisual(): THREE.Group {
  const group = new THREE.Group();

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.26, 0.32, 10),
    toon(0xf3e6cf),
  );
  stem.position.y = 0.16;
  group.add(stem);

  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    toon(0xe23636),
  );
  cap.scale.y = 0.8;
  cap.position.y = 0.3;
  group.add(cap);

  // White dots on the cap.
  const dotGeo = new THREE.SphereGeometry(0.09, 6, 4);
  const dotMat = toon(0xffffff);
  const dots: [number, number, number][] = [
    [0, 0.62, 0.12],
    [0.28, 0.46, 0.22],
    [-0.28, 0.46, 0.22],
    [0, 0.46, -0.34],
  ];
  for (const [x, y, z] of dots) {
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.set(x, y, z);
    group.add(dot);
  }

  return group;
}

/** Extruded golden five-point star, centered origin (used as a glow/aura). */
export function createStarGlowVisual(): THREE.Group {
  const group = new THREE.Group();

  const shape = new THREE.Shape();
  const outer = 0.5;
  const inner = 0.21;
  const points = 5;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
  geo.translate(0, 0, -0.06); // center on origin

  const star = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: 0xffd84a,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
  );
  group.add(star);

  return group;
}
