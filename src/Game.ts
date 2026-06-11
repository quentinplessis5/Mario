import { GameLoop } from './core/GameLoop';
import { Input } from './core/Input';
import { EventBus } from './core/EventBus';
import { TUNING } from './config/tuning';
import { createRaceState, type RaceState } from './types/race';
import { createKartState, type KartState } from './types/kart';
import type { TrackData } from './types/track';
import { buildTrack } from './track/TrackBuilder';
import { KartPhysics } from './physics/KartPhysics';
import { Collisions } from './physics/Collisions';
import { ItemSystem } from './items/ItemSystem';
import { AIDriver } from './ai/AIDriver';
import { ProgressTracker } from './race/ProgressTracker';
import { RaceManager } from './race/RaceManager';
import { SceneSetup } from './render/SceneSetup';
import { RenderSync } from './render/RenderSync';
import { FollowCamera } from './render/FollowCamera';
import { Effects } from './render/Effects';
import { Hud } from './hud/Hud';
import { ItemSlotUI } from './hud/ItemSlotUI';
import { Minimap } from './hud/Minimap';
import { Screens } from './hud/Screens';
import { AudioSystem } from './audio/AudioSystem';

/** Original roster: 8 colored pilots, index 0 is the player. */
const ROSTER: { name: string; color: number }[] = [
  { name: 'Rouge', color: 0xe53935 },
  { name: 'Bleu', color: 0x1e88e5 },
  { name: 'Vert', color: 0x43a047 },
  { name: 'Jaune', color: 0xfdd835 },
  { name: 'Violet', color: 0x8e24aa },
  { name: 'Cyan', color: 0x00acc1 },
  { name: 'Orange', color: 0xfb8c00 },
  { name: 'Rose', color: 0xec407a },
];

/**
 * Orchestrator. Per-tick update order (contract):
 *   inputs (AI + player) -> items -> physics -> kart collisions ->
 *   progress -> race phases.
 */
export class Game {
  private bus = new EventBus();
  private input = new Input();
  private raceState: RaceState;
  private karts: KartState[] = [];
  private track: TrackData;

  private physics: KartPhysics;
  private collisions: Collisions;
  private items: ItemSystem;
  private ai: AIDriver;
  private progress: ProgressTracker;
  private raceManager: RaceManager;

  private sceneSetup: SceneSetup;
  private renderSync: RenderSync;
  private followCam: FollowCamera;
  private effects: Effects;
  private hud: Hud;
  private itemSlot: ItemSlotUI;
  private minimap: Minimap;
  private screens: Screens;
  private audio: AudioSystem;

  private loop: GameLoop;
  private hudContainer: HTMLElement;
  private renderTime = 0;
  private camSnapped = false;

  constructor(canvas: HTMLCanvasElement) {
    this.raceState = createRaceState(TUNING.race.totalLaps, TUNING.race.kartCount);

    // --- World ---
    this.sceneSetup = new SceneSetup(canvas);
    this.track = buildTrack();
    this.sceneSetup.scene.add(this.track.visualRoot);

    for (let i = 0; i < TUNING.race.kartCount; i++) {
      const kart = createKartState(i, i === 0, ROSTER[i].name, ROSTER[i].color);
      this.karts.push(kart);
    }
    this.placeKartsOnGrid();

    // --- Simulation systems ---
    this.physics = new KartPhysics(this.track.query, this.bus);
    this.collisions = new Collisions(this.bus);
    this.items = new ItemSystem(this.bus, this.track.query);
    this.items.init(this.track.itemBoxPositions, this.track.coinPositions);
    this.ai = new AIDriver(this.track.query);
    this.progress = new ProgressTracker(this.track, this.bus);
    this.progress.reset(this.karts);
    this.raceManager = new RaceManager(this.bus);

    // --- Rendering ---
    this.renderSync = new RenderSync(this.sceneSetup.scene);
    this.renderSync.initKarts(this.karts);
    this.renderSync.initPickups(this.items.pickups);
    this.followCam = new FollowCamera(this.sceneSetup.camera);
    this.effects = new Effects(this.sceneSetup.scene, this.bus);

    // --- UI / audio ---
    this.hudContainer = document.getElementById('hud') as HTMLElement;
    const screensContainer = document.getElementById('screens') as HTMLElement;
    this.hud = new Hud(this.hudContainer, this.bus);
    this.itemSlot = new ItemSlotUI(this.hudContainer, this.bus);
    this.minimap = new Minimap(this.hudContainer, this.track);
    this.screens = new Screens(screensContainer, this.bus);
    this.audio = new AudioSystem(this.bus);

    this.hudContainer.style.display = 'none';
    this.screens.showTitle();
    this.screens.onStart(() => {
      this.audio.resume();
      this.hudContainer.style.display = 'block';
      this.raceManager.startCountdown(this.raceState);
    });
    this.screens.onRestart(() => this.restartRace());

    this.loop = new GameLoop(
      (dt) => this.simulate(dt),
      (alpha, frameDt) => this.render(alpha, frameDt),
    );
  }

  start(): void {
    this.loop.start();
  }

  // --- Simulation (fixed 60 Hz) ---------------------------------------------

  private simulate(dt: number): void {
    const phase = this.raceState.phase;

    // 1. Inputs: AI for everyone (also refreshes rubber-band multipliers),
    //    then the real player input when controls are unlocked.
    const inputs = this.ai.computeInputs(
      this.karts,
      this.items.projectiles,
      this.raceState,
      dt,
    );
    if (!this.raceManager.isControlLocked(this.raceState)) {
      inputs[0] = this.input.poll();
    }

    // 2. Items (roulette, usage, projectiles, pickups + their collisions).
    if (phase === 'RACING' || phase === 'FINISHED') {
      this.items.update(this.karts, inputs, dt);
    }

    // 3-4. Kart physics (drift included) then kart-kart collisions.
    this.physics.stepAll(this.karts, inputs, dt, this.ai.speedMultipliers);
    this.collisions.resolveKarts(this.karts);

    // 5-6. Lap/rank tracking and race phases.
    this.progress.update(this.karts, this.raceState);
    this.raceManager.update(this.raceState, this.karts, dt);
  }

  // --- Rendering (interpolated) ----------------------------------------------

  private render(alpha: number, frameDt: number): void {
    this.renderTime += frameDt;
    this.renderSync.sync(
      this.karts,
      this.items.projectiles,
      this.items.pickups,
      alpha,
      this.renderTime,
    );

    const playerVisual = this.renderSync.getKartVisualTransform(0);
    if (!this.camSnapped) {
      this.followCam.snapBehind(playerVisual);
      this.camSnapped = true;
    }
    this.followCam.update(this.karts[0], playerVisual, frameDt);
    this.effects.update(
      this.karts,
      (id) => this.renderSync.getKartVisualTransform(id),
      frameDt,
    );

    this.hud.update(this.raceState, this.karts[0]);
    this.itemSlot.update(this.karts[0]);
    this.minimap.update(this.karts);
    this.screens.update(this.raceState, this.karts);
    this.audio.update(this.karts[0], this.raceState, frameDt);

    this.sceneSetup.render();
  }

  // --- Race lifecycle ---------------------------------------------------------

  private placeKartsOnGrid(): void {
    const query = this.track.query;
    for (let i = 0; i < this.karts.length; i++) {
      const kart = this.karts[i];
      const spawn = this.track.spawnPoints[i];
      kart.position.copy(spawn.position);
      kart.prevPosition.copy(spawn.position);
      kart.heading = spawn.heading;
      kart.prevHeading = spawn.heading;
      kart.velocity.set(0, 0, 0);
      kart.speed = 0;
      kart.visualSlip = 0;
      kart.grounded = true;
      kart.surface = 'ROAD';
      // The grid sits just before the finish line (wrapping distances).
      kart.splineHint = query.closestPoint(
        kart.position,
        query.totalLength - 15,
      ).distance;
      kart.drift.active = false;
      kart.drift.direction = 0;
      kart.drift.chargeTime = 0;
      kart.drift.miniTurboLevel = 0;
      kart.drift.hopTimer = 0;
      kart.boostTimer = 0;
      kart.spinTimer = 0;
      kart.starTimer = 0;
      kart.coins = 0;
      kart.heldItem = null;
      kart.rouletteTimer = 0;
    }
  }

  private restartRace(): void {
    this.placeKartsOnGrid();
    this.items.reset();
    this.ai.reset();
    this.progress.reset(this.karts);
    this.raceManager.resetRace(this.raceState);
    this.camSnapped = false;
    this.hudContainer.style.display = 'block';
    this.raceManager.startCountdown(this.raceState);
  }
}
