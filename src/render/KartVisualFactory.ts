import * as THREE from 'three';

/**
 * Data exposed by the kart visual through group.userData, consumed by
 * RenderSync for wheel spin, front-wheel steering, drift roll and star tint.
 */
export interface KartVisualUserData {
  /** Spinning wheel objects, order: FL, FR, RL, RR. */
  wheels: THREE.Object3D[];
  /** Front wheel steering pivots (yaw), order: FL, FR. */
  steeringWheels: THREE.Object3D[];
  /** Chassis + driver + spoiler subtree (tilted/rolled/tinted as a whole). */
  body: THREE.Object3D;
}

function toon(color: number): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color });
}

function darken(color: number, factor: number): number {
  return new THREE.Color(color).multiplyScalar(factor).getHex();
}

/** Builds one spinning wheel (tire + grey rim). Spin axis is local X. */
function makeWheel(
  tireMat: THREE.Material,
  rimMat: THREE.Material,
  tireGeo: THREE.BufferGeometry,
  rimGeo: THREE.BufferGeometry,
): THREE.Group {
  const wheel = new THREE.Group();
  wheel.add(new THREE.Mesh(tireGeo, tireMat));
  wheel.add(new THREE.Mesh(rimGeo, rimMat));
  return wheel;
}

/**
 * Procedural low-poly kart (~600 tris): rounded colored chassis, four wheels,
 * a small original stylized driver (helmet + torso + arms + steering wheel)
 * and a rear spoiler. A fake blob shadow (dark translucent disc) sits at
 * y = 0.02 inside the group. Forward is +Z, up is +Y, units in meters.
 *
 * The accent/helmet colors are derived from `color` (8 palettes expected,
 * the hex comes straight from KartState.color).
 */
export function createKartVisual(color: number, name: string): THREE.Group {
  const group = new THREE.Group();
  group.name = `kart:${name}`;

  // --- Materials (per-kart instances so star tinting never leaks) ---
  const bodyMat = toon(color);
  const accentMat = toon(darken(color, 0.55));
  const greyMat = toon(0x767c84);
  const blackMat = toon(0x1c1c22);
  const suitMat = toon(0xf2f2f2);
  const skinMat = toon(0xeec39a);

  // --- Body subtree (everything that rolls/tilts/tints) ---
  const body = new THREE.Group();
  body.name = 'body';
  group.add(body);

  // Main chassis: a low box softened by a nose and side pods.
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.32, 1.9), bodyMat);
  chassis.position.set(0, 0.42, 0);
  body.add(chassis);

  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.22, 0.55), bodyMat);
  nose.position.set(0, 0.4, 1.1);
  nose.rotation.x = -0.12; // slightly raked nose
  body.add(nose);

  const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.18), accentMat);
  bumper.position.set(0, 0.36, 1.38);
  body.add(bumper);

  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.26, 1.1), accentMat);
    pod.position.set(side * 0.68, 0.4, -0.1);
    body.add(pod);
  }

  // Seat back behind the driver.
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.16), accentMat);
  seat.position.set(0, 0.78, -0.62);
  body.add(seat);

  // Rear spoiler: two posts + a plate.
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.08), greyMat);
    post.position.set(side * 0.4, 0.7, -0.95);
    body.add(post);
  }
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.07, 0.34), bodyMat);
  wing.position.set(0, 0.88, -0.97);
  wing.rotation.x = 0.1;
  body.add(wing);

  // --- Original stylized driver (generic round helmet, no likeness) ---
  const driver = new THREE.Group();
  driver.position.set(0, 0, -0.18);
  body.add(driver);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.42, 0.32), suitMat);
  torso.position.set(0, 0.92, 0);
  driver.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), skinMat);
  head.position.set(0, 1.26, 0);
  driver.add(head);

  // Helmet: colored shell + dark visor strip.
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.65),
    bodyMat,
  );
  helmet.position.set(0, 1.28, 0);
  driver.add(helmet);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.08), blackMat);
  visor.position.set(0, 1.28, 0.21);
  driver.add(visor);

  // Arms reaching forward to a small steering wheel (driver prop, NOT the
  // road wheels referenced in userData.steeringWheels).
  const armGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.42, 6);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, suitMat);
    arm.position.set(side * 0.2, 0.95, 0.24);
    arm.rotation.x = Math.PI / 2 - 0.5;
    arm.rotation.z = side * 0.25;
    driver.add(arm);
  }
  const drivingWheel = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 6, 12), blackMat);
  drivingWheel.position.set(0, 0.92, 0.46);
  drivingWheel.rotation.x = -0.9;
  drivingWheel.name = 'drivingWheel';
  driver.add(drivingWheel);

  // --- Wheels: tires + rims, spin axis along local X ---
  const tireGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.24, 10);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.26, 8);
  rimGeo.rotateZ(Math.PI / 2);

  const wheels: THREE.Object3D[] = [];
  const steeringWheels: THREE.Object3D[] = [];

  // Front wheels: a yaw pivot wraps the spinning wheel.
  for (const side of [1, -1]) {
    // side +1 = left (FL first), -1 = right (FR)
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.64, 0.3, 0.72);
    const wheel = makeWheel(blackMat, greyMat, tireGeo, rimGeo);
    pivot.add(wheel);
    group.add(pivot);
    wheels.push(wheel);
    steeringWheels.push(pivot);
  }
  // Rear wheels: spin only.
  for (const side of [1, -1]) {
    const wheel = makeWheel(blackMat, greyMat, tireGeo, rimGeo);
    wheel.position.set(side * 0.64, 0.3, -0.72);
    group.add(wheel);
    wheels.push(wheel);
  }

  // --- Fake shadow: dark translucent disc lying flat just above ground ---
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.05, 20),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  shadow.name = 'fakeShadow';
  group.add(shadow);

  const userData: KartVisualUserData = { wheels, steeringWheels, body };
  group.userData.wheels = userData.wheels;
  group.userData.steeringWheels = userData.steeringWheels;
  group.userData.body = userData.body;

  return group;
}
