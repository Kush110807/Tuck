import type { MutationMailbox, MutationNotice } from '../contracts';

/** Master-owned one-shot handoff. Publish after a confirmed write, before navigation. */
export function createMutationMailbox(): MutationMailbox {
  let sequence = 0;
  let pending: MutationNotice[] = [];
  return {
    publish(notice) {
      const event = { ...notice, sequence: ++sequence };
      pending.push(event);
      // Bound even if a destination is never visited; the latest events matter.
      if (pending.length > 10) pending = pending.slice(-10);
      return event;
    },
    consume(destination, itemId) {
      const matching = pending.filter(event => event.destination === destination &&
        (destination !== 'Detail' || (itemId !== undefined && event.itemId === itemId)));
      const consumed = new Set(matching.map(event => event.sequence));
      pending = pending.filter(event => !consumed.has(event.sequence));
      return matching;
    },
  };
}
