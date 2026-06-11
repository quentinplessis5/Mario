import * as THREE from 'three';
import type { KartState } from '../types/kart';
import { TUNING } from '../config/tuning';
import { damp } from '../core/MathUtils';

/** Interpolated kart transform produced by RenderSync. */
interface VisualTransform {
  position: THREE.Vector3;
  heading: number;
}

/**
 * Chase camera with exponential (framerate-independent) damping and a
 * speed-feel FOV kick during boosts / star. Never uses fixed-factor lerps.
 */
export class FollowCamera {
  private readonly camera: THREE.PerspectiveCamera;

  // Scratch vectors reused every frame (no per-frame allocations).
  private readonly forward = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  update(kart: KartState, visual: VisualTransform, frameDt: number): void {
    const cfg = TUNING.camera;

    // Reference yaw swings towards the outside of the drift for readability.
    let yaw = visual.heading;
    if (kart.drift.active) {
      yaw -= kart.drift.direction * cfg.driftYawOffset;
    }
    this.forward.set(Math.sin(yaw), 0, Math.cos(yaw));

    // Desired position: behind and above the kart along the reference yaw.
    this.desired
      .copy(visual.position)
      .addScaledVector(this.forward, -cfg.distance);
    this.desired.y += cfg.height;

    // Exponential damping — independent of the render framerate.
    const t = 1 - Math.exp(-cfg.positionDamp * frameDt);
    this.camera.position.lerp(this.desired, t);

    // Aim ahead of the kart, slightly above the ground.
    this.lookTarget
      .copy(visual.position)
      .addScaledVector(this.forward, cfg.lookAhead);
    this.lookTarget.y += cfg.lookHeight;
    this.camera.lookAt(this.lookTarget);

    // FOV kick while boosting or under a star, damped both ways.
    const fovTarget =
      kart.boostTimer > 0 || kart.starTimer > 0 ? cfg.fovBoost : cfg.fovNormal;
    const newFov = damp(this.camera.fov, fovTarget, cfg.fovDamp, frameDt);
    if (Math.abs(newFov - this.camera.fov) > 0.01) {
      this.camera.fov = newFov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Instantly snaps the camera behind the kart (spawn / respawn). */
  snapBehind(visual: VisualTransform): void {
    const cfg = TUNING.camera;
    this.forward.set(Math.sin(visual.heading), 0, Math.cos(visual.heading));

    this.camera.position
      .copy(visual.position)
      .addScaledVector(this.forward, -cfg.distance);
    this.camera.position.y += cfg.height;

    this.lookTarget
      .copy(visual.position)
      .addScaledVector(this.forward, cfg.lookAhead);
    this.lookTarget.y += cfg.lookHeight;
    this.camera.lookAt(this.lookTarget);
  }
}
