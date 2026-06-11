import { Game } from './Game';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const game = new Game(canvas);
game.start();

// Debug handle (used by automated verification and console tinkering).
(window as unknown as { game: Game }).game = game;
