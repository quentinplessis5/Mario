import type { GameEvents, GameEventName } from '../types/events';

type Handler<E extends GameEventName> = (payload: GameEvents[E]) => void;

/** Pub/sub typé sur GameEvents. */
export class EventBus {
  private handlers = new Map<GameEventName, Set<Handler<GameEventName>>>();

  on<E extends GameEventName>(event: E, handler: Handler<E>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<GameEventName>);
    return () => set!.delete(handler as Handler<GameEventName>);
  }

  emit<E extends GameEventName>(event: E, payload: GameEvents[E]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      (handler as Handler<E>)(payload);
    }
  }
}
