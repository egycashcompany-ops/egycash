// «ضمان ينتهي خلال ٣٠ يومًا» — the one window the dashboard's row and the asset list's
// `warrantyEndsWithinDays` share. Pinned against the expiry sweep's own reading of it: ENDED once
// the end is at or before now, ending soon while it falls after now and no later than N days on,
// and never a disposed asset's.
import { describe, expect, it } from 'vitest';
import { warrantyEndingWithin } from './warranty-window';

const NOW = new Date('2026-11-03T08:00:00.000Z');
const DAY = 86_400_000;

/** Whether one asset falls inside the window — the condition read the way Mongo reads it. */
const inside = (days: number, asset: { status: string; end: Date | null }): boolean => {
  const filter = warrantyEndingWithin(days, NOW) as {
    status: { $ne: string };
    'warranty.end': { $gt: Date; $lte: Date };
  };
  if (asset.status === filter.status.$ne || asset.end === null) return false;
  const { $gt, $lte } = filter['warranty.end'];
  return asset.end > $gt && asset.end <= $lte;
};

describe('a warranty that ends soon', () => {
  it('is one ending after now and no later than N days on', () => {
    expect(warrantyEndingWithin(30, NOW)).toEqual({
      status: { $ne: 'disposed' },
      'warranty.end': { $gt: NOW, $lte: new Date(NOW.getTime() + 30 * DAY) },
    });
  });

  it('counts the last day of the window, and not the day after it', () => {
    const at = (ms: number) => ({ status: 'inStock', end: new Date(NOW.getTime() + ms) });
    expect(inside(30, at(DAY))).toBe(true);
    expect(inside(30, at(30 * DAY))).toBe(true);
    expect(inside(30, at(30 * DAY + 1))).toBe(false);
    expect(inside(90, at(30 * DAY + 1))).toBe(true);
  });

  it('leaves out a warranty that has already ended — at now, as the sweep calls it expired', () => {
    expect(inside(30, { status: 'assigned', end: NOW })).toBe(false);
    expect(inside(30, { status: 'assigned', end: new Date(NOW.getTime() - DAY) })).toBe(false);
  });

  it('leaves out a disposed asset — the machine is gone — and an asset with no warranty', () => {
    const soon = new Date(NOW.getTime() + 5 * DAY);
    expect(inside(30, { status: 'disposed', end: soon })).toBe(false);
    expect(inside(30, { status: 'underMaintenance', end: soon })).toBe(true);
    expect(inside(30, { status: 'inStock', end: null })).toBe(false);
  });
});
