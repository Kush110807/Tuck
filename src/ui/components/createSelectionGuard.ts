import type { ItemType } from '../../contracts';

/**
 * Synchronous one-shot gate for a single create-sheet presentation.
 * Reset only when the sheet is presented again; this prevents rapid taps
 * from issuing duplicate create navigation while allowing later creations.
 */
export function createSelectionGuard() {
  let locked = false;

  return {
    reset(): void {
      locked = false;
    },
    choose(type: ItemType, onChoose: (type: ItemType) => void): boolean {
      if (locked) return false;
      locked = true;
      onChoose(type);
      return true;
    },
  };
}
