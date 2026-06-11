import type { EventBus } from '../core/EventBus';
import type { KartState } from '../types/kart';
import { ItemType } from '../types/items';

const ICONS: Record<ItemType, string> = {
  [ItemType.MUSHROOM]: '🍄',
  [ItemType.GREEN_SHELL]: '🐢',
  [ItemType.RED_SHELL]: '🔴',
  [ItemType.BANANA]: '🍌',
  [ItemType.STAR]: '⭐',
  [ItemType.COIN]: '🪙',
};
const SPIN_ICONS: string[] = Object.values(ICONS);
/** Icon swap period while the roulette spins (ms). */
const SPIN_PERIOD_MS = 70;

const STYLE_ID = 'item-slot-style';
const CSS = `
.item-slot {
  position: absolute;
  left: 18px;
  top: 18px;
  width: 90px;
  height: 90px;
  border-radius: 18px;
  background: rgba(20, 20, 40, 0.55);
  border: 4px solid rgba(255, 255, 255, 0.75);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.item-slot-icon {
  font-size: 52px;
  line-height: 1;
  filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.5));
}
.item-slot-icon.pop {
  animation: item-pop 0.35s ease-out;
}
@keyframes item-pop {
  0% { transform: scale(0.4); }
  60% { transform: scale(1.35); }
  100% { transform: scale(1); }
}
`;

/**
 * Item slot (top left): cycles icons while the roulette runs, pops the final
 * icon on 'item:awarded' for the player, empties after the item is used.
 */
export class ItemSlotUI {
  private readonly root: HTMLDivElement;
  private readonly iconEl: HTMLSpanElement;
  private lastIcon = '';
  private popPending = false;

  constructor(container: HTMLElement, bus: EventBus) {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    this.root = document.createElement('div');
    this.root.className = 'item-slot';
    this.iconEl = document.createElement('span');
    this.iconEl.className = 'item-slot-icon';
    this.root.appendChild(this.iconEl);
    container.appendChild(this.root);

    // Kart 0 is the player by contract.
    bus.on('item:awarded', ({ kartId }) => {
      if (kartId === 0) this.popPending = true;
    });
  }

  update(player: KartState): void {
    let icon = '';
    if (player.rouletteTimer > 0) {
      const step = Math.floor(performance.now() / SPIN_PERIOD_MS);
      icon = SPIN_ICONS[step % SPIN_ICONS.length];
    } else if (player.heldItem !== null) {
      icon = ICONS[player.heldItem];
    }

    if (icon !== this.lastIcon) {
      this.lastIcon = icon;
      this.iconEl.textContent = icon;
    }

    // Pop animation once the final icon is shown (roulette done).
    if (this.popPending && player.rouletteTimer <= 0 && player.heldItem !== null) {
      this.popPending = false;
      this.iconEl.classList.remove('pop');
      void this.iconEl.offsetWidth; // restart the CSS animation
      this.iconEl.classList.add('pop');
    }
  }
}
