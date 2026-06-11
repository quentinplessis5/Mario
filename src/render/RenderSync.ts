import * as THREE from 'three';
import type { KartState } from '../types/kart';
import type { ProjectileState, PickupState } from '../types/items';
import { ItemType } from '../types/items';
import { lerpAngle, damp, clamp, mod } from '../core/MathUtils';
import { TUNING } from '../config/tuning';
import { createKartVisual } from './KartVisualFactory';
import {
  createItemBoxVisual,
  createCoinVisual,
  createShellVisual,
  createBananaVisual,
} from './ItemVisualFactory';

/** Interpolated transform handed to the camera / effects each frame. */
export interface VisualTransform {
  position: THREE.Vector3;
  heading: number;
}

/** Tintable toon/lambert material (has both color and emissive). */
type TintableMaterial = THREE.Material & {
  color: THREE.Color;
  emissive: THREE.Color;
};

interface KartEntry {
  group: THREE.Group;
  body: THREE.Object3D;
  wheels: THREE.Object3D[];
  steeringWheels: THREE.Object3D[];
  /** Body materials with their original colors saved for star restore. */
  tintMats: { mat: TintableMaterial; color: THREE.Color; emissive: THREE.Color }[];
  starActive: boolean;
  /** Reused VisualTransform — see getKartVisualTransform. */
  transform: VisualTransform;
}

interface PickupEntry {
  group: THREE.Group;
  kind: PickupState['kind'];
  baseY: number;
  /** Child to rotate (item box cube), defaults to the group itself. */
  spin: THREE.Object3D;
}

const WHEEL_RADIUS = 0.3;
const HOP_HEIGHT = 0.5;
const DRIFT_ROLL = 0.12;
const MAX_FRONT_STEER = 0.45;

function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    }
  });
}

/**
 * Mirrors the simulation state into the Three.js scene every render frame,
 * interpolating prev -> current transforms with the accumulator alpha.
 */
export class RenderSync {
  private readonly scene: THREE.Scene;
  private readonly karts = new Map<number, KartEntry>();
  private readonly pickups = new Map<number, PickupEntry>();
  private readonly projectiles = new Map<number, THREE.Group>();
  /** Scratch set reused to detect despawned projectiles. */
  private readonly seenProjectiles = new Set<number>();
  private lastTime = -1;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Creates one visual per kart and registers it for sync. */
  initKarts(karts: KartState[]): void {
    for (const kart of karts) {
      const group = createKartVisual(kart.color, kart.name);
      group.position.copy(kart.position);
      group.rotation.y = kart.heading;
      this.scene.add(group);

      const body = group.userData.body as THREE.Object3D;
      const tintMats: KartEntry['tintMats'] = [];
      const seen = new Set<THREE.Material>();
      body.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (seen.has(m)) continue;
          seen.add(m);
          const tm = m as TintableMaterial;
          if (tm.color !== undefined && tm.emissive !== undefined) {
            tintMats.push({
              mat: tm,
              color: tm.color.clone(),
              emissive: tm.emissive.clone(),
            });
          }
        }
      });

      this.karts.set(kart.id, {
        group,
        body,
        wheels: group.userData.wheels as THREE.Object3D[],
        steeringWheels: group.userData.steeringWheels as THREE.Object3D[],
        tintMats,
        starActive: false,
        transform: { position: kart.position.clone(), heading: kart.heading },
      });
    }
  }

  /** Creates item box / coin visuals at their fixed positions. */
  initPickups(pickups: PickupState[]): void {
    for (const p of pickups) {
      const group = p.kind === 'ITEM_BOX' ? createItemBoxVisual() : createCoinVisual();
      group.position.copy(p.position);
      this.scene.add(group);
      this.pickups.set(p.id, {
        group,
        kind: p.kind,
        baseY: p.position.y,
        spin: (group.userData.spin as THREE.Object3D | undefined) ?? group,
      });
    }
  }

  /**
   * Updates every visual from the simulation state.
   * @param alpha accumulator interpolation factor in [0, 1]
   * @param time  absolute render time in seconds (drives idle animations)
   */
  sync(
    karts: KartState[],
    projectiles: ProjectileState[],
    pickups: PickupState[],
    alpha: number,
    time: number,
  ): void {
    // Frame delta derived from the absolute time (clamped for tab switches).
    const dt = this.lastTime < 0 ? 0 : clamp(time - this.lastTime, 0, 0.1);
    this.lastTime = time;

    for (const kart of karts) this.syncKart(kart, dt, alpha, time);
    this.syncProjectiles(projectiles, alpha, time);
    this.syncPickups(pickups, time);
  }

  /**
   * Returns the current interpolated transform of a kart (as computed by the
   * last sync() call). NOTE: the returned object is owned and mutated by
   * RenderSync every frame — copy position if you need to keep it.
   */
  getKartVisualTransform(id: number): VisualTransform {
    const entry = this.karts.get(id);
    if (!entry) {
      throw new Error(`RenderSync: unknown kart id ${id}`);
    }
    return entry.transform;
  }

  // ------------------------------------------------------------------ karts

  private syncKart(kart: KartState, dt: number, alpha: number, time: number): void {
    const entry = this.karts.get(kart.id);
    if (!entry) return;
    const { group, body } = entry;

    // Interpolated position + drift hop offset (sine arch, 0.5 m apex).
    group.position.lerpVectors(kart.prevPosition, kart.position, alpha);
    if (kart.drift.hopTimer > 0) {
      const phase = 1 - kart.drift.hopTimer / TUNING.drift.hopDuration;
      group.position.y += Math.sin(clamp(phase, 0, 1) * Math.PI) * HOP_HEIGHT;
    }

    // Interpolated heading + visual slip; damage spin adds a full 2-turn yaw.
    let yaw = lerpAngle(kart.prevHeading, kart.heading, alpha) + kart.visualSlip;
    if (kart.spinTimer > 0) {
      yaw += (1 - kart.spinTimer / TUNING.hit.spinDuration) * Math.PI * 4;
    }
    group.rotation.y = yaw;

    // Slight body roll towards the inside of the drift (body only, so the
    // fake shadow disc stays flat on the ground).
    const rollTarget = kart.drift.active ? -kart.drift.direction * DRIFT_ROLL : 0;
    body.rotation.z = damp(body.rotation.z, rollTarget, 8, dt);

    // Wheel spin proportional to forward speed.
    const spin = (kart.speed / WHEEL_RADIUS) * dt;
    for (const wheel of entry.wheels) wheel.rotation.x += spin;

    // Front wheels yaw with the visual slip (cheap steering feedback).
    const steerTarget = clamp(kart.visualSlip * 1.4, -MAX_FRONT_STEER, MAX_FRONT_STEER);
    for (const pivot of entry.steeringWheels) {
      pivot.rotation.y = damp(pivot.rotation.y, steerTarget, 12, dt);
    }

    this.syncStarTint(kart, entry, time);

    // Publish the interpolated transform for the camera / effects.
    entry.transform.position.copy(group.position);
    entry.transform.heading = lerpAngle(kart.prevHeading, kart.heading, alpha);
  }

  /** Rainbow pulse on body materials while the star is active. */
  private syncStarTint(kart: KartState, entry: KartEntry, time: number): void {
    if (kart.starTimer > 0) {
      entry.starActive = true;
      // Final 1.5 s: faster flashing to telegraph the end of the star.
      const cycleSpeed = kart.starTimer < 1.5 ? 2.4 : 0.9;
      const hue = mod(time * cycleSpeed, 1);
      const pulse = 0.3 + 0.15 * Math.sin(time * 18);
      for (const t of entry.tintMats) {
        t.mat.color.setHSL(hue, 0.85, 0.65);
        t.mat.emissive.setHSL(hue, 0.9, pulse);
      }
    } else if (entry.starActive) {
      // Star just ended: restore the original palette once.
      entry.starActive = false;
      for (const t of entry.tintMats) {
        t.mat.color.copy(t.color);
        t.mat.emissive.copy(t.emissive);
      }
    }
  }

  // ------------------------------------------------------------ projectiles

  private syncProjectiles(projectiles: ProjectileState[], alpha: number, time: number): void {
    this.seenProjectiles.clear();

    for (const proj of projectiles) {
      if (!proj.alive) continue;
      this.seenProjectiles.add(proj.id);

      let mesh = this.projectiles.get(proj.id);
      if (!mesh) {
        mesh = this.createProjectileVisual(proj.type);
        this.scene.add(mesh);
        this.projectiles.set(proj.id, mesh);
      }

      mesh.position.lerpVectors(proj.prevPosition, proj.position, alpha);
      if (proj.type !== ItemType.BANANA) {
        // Shells spin on Y while travelling; dropped bananas stay still.
        mesh.rotation.y = time * 8;
      }
    }

    // Destroy visuals of despawned projectiles.
    for (const [id, mesh] of this.projectiles) {
      if (!this.seenProjectiles.has(id)) {
        this.scene.remove(mesh);
        disposeObject(mesh);
        this.projectiles.delete(id);
      }
    }
  }

  private createProjectileVisual(type: ProjectileState['type']): THREE.Group {
    switch (type) {
      case ItemType.GREEN_SHELL:
        return createShellVisual('GREEN');
      case ItemType.RED_SHELL:
        return createShellVisual('RED');
      case ItemType.BANANA:
        return createBananaVisual();
    }
  }

  // ---------------------------------------------------------------- pickups

  private syncPickups(pickups: PickupState[], time: number): void {
    for (const p of pickups) {
      const entry = this.pickups.get(p.id);
      if (!entry) continue;

      entry.group.visible = p.active;
      if (!p.active) continue;

      if (entry.kind === 'ITEM_BOX') {
        // Slow tumble + gentle bob (phase offset by id so boxes desync).
        entry.spin.rotation.y = time * 1.2 + p.id;
        entry.spin.rotation.x = time * 0.7;
        entry.group.position.y = entry.baseY + Math.sin(time * 2 + p.id) * 0.15;
      } else {
        entry.group.rotation.y = time * 3 + p.id;
      }
    }
  }
}
