// «سجل الخزينة» — «تقرير الخزينة»'s band folds, and this browser remembers how its viewer left it.
import { describe, expect, it } from 'vitest';
import {
  HELD_BAND_KEY,
  heldBandShown,
  loadHeldBandOpen,
  saveHeldBandOpen,
  type PrefStorage,
} from './vault-history-band';

const memory = (seed: Record<string, string> = {}): PrefStorage & { kept: Map<string, string> } => {
  const kept = new Map(Object.entries(seed));
  return {
    kept,
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => void kept.set(key, value),
  };
};

/** Private mode, a full quota, storage switched off: every access throws. */
const broken: PrefStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('remembered per viewer, open by default', () => {
  it('opens on a first visit — nothing kept yet', () => {
    expect(loadHeldBandOpen(memory())).toBe(true);
  });

  it('keeps it folded once folded, and open once opened again', () => {
    const storage = memory();
    saveHeldBandOpen(false, storage);
    expect(storage.kept.get(HELD_BAND_KEY)).toBe('0');
    expect(loadHeldBandOpen(storage)).toBe(false);
    saveHeldBandOpen(true, storage);
    expect(loadHeldBandOpen(storage)).toBe(true);
  });

  it('reads anything but «folded» as the default — open', () => {
    expect(loadHeldBandOpen(memory({ [HELD_BAND_KEY]: 'yes' }))).toBe(true);
    expect(loadHeldBandOpen(memory({ [HELD_BAND_KEY]: '' }))).toBe(true);
  });

  it('works with no storage at all, and with storage that refuses — open, and no error', () => {
    expect(loadHeldBandOpen(null)).toBe(true);
    expect(loadHeldBandOpen(broken)).toBe(true);
    expect(() => saveHeldBandOpen(false, broken)).not.toThrow();
    expect(() => saveHeldBandOpen(false, null)).not.toThrow();
  });

  it('lives under its own key in the house’s `ecms.` space, not the remembered filters’', () => {
    expect(HELD_BAND_KEY.startsWith('ecms.')).toBe(true);
    expect(HELD_BAND_KEY.startsWith('ecms.filters.')).toBe(false);
  });
});

describe('who may fold it', () => {
  it('a reader of the history: as he left it', () => {
    expect(heldBandShown(true, true)).toBe(true);
    expect(heldBandShown(false, true)).toBe(false);
  });

  it('a vault-only reader: always open — the report is his whole screen', () => {
    expect(heldBandShown(false, false)).toBe(true);
    expect(heldBandShown(true, false)).toBe(true);
  });
});
