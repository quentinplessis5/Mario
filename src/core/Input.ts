import type { KartInput } from '../types/kart';

/**
 * Clavier -> KartInput du joueur.
 * Flèches ou ZQSD/WASD pour conduire, Shift pour drifter, Espace pour l'objet.
 */
export class Input {
  private pressed = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      this.pressed.add(e.code);
      if (
        e.code === 'Space' ||
        e.code.startsWith('Arrow') ||
        e.code === 'ShiftLeft' ||
        e.code === 'ShiftRight'
      ) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.pressed.delete(e.code));
    window.addEventListener('blur', () => this.pressed.clear());
  }

  isDown(code: string): boolean {
    return this.pressed.has(code);
  }

  poll(): KartInput {
    const up = this.isDown('ArrowUp') || this.isDown('KeyW') || this.isDown('KeyZ');
    const down = this.isDown('ArrowDown') || this.isDown('KeyS');
    const left = this.isDown('ArrowLeft') || this.isDown('KeyA') || this.isDown('KeyQ');
    const right = this.isDown('ArrowRight') || this.isDown('KeyD');
    return {
      throttle: (up ? 1 : 0) - (down ? 1 : 0),
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      drift: this.isDown('ShiftLeft') || this.isDown('ShiftRight'),
      useItem: this.isDown('Space'),
    };
  }
}
