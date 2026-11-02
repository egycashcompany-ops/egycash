// The go-live spellings of the fuel companies' car codes, pinned to the go-live sheet itself: the
// 43 cards whose printed code is not their registry car (another spelling, or a card on no car)
// are answered by the table, each spelling once, and the table holds nothing else. Insert-only
// against a real mongo is pinned in `tests/integration/fleet-fuel-reconcile-links.spec.ts`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { foldSheetCode } from './compare-fuel-sheet';
import { FUEL_SHEET_CODE_SEED } from './fuel-sheet-codes';

interface AssetCard {
  sheetCode: string | null;
  vehicleCode: string | null;
  label: string | null;
}

const ASSET = join(__dirname, '../../../../../assets/fleet-go-live/fuel-cards-2026-10-04.json');
const cards = (JSON.parse(readFileSync(ASSET, 'utf8')) as { cards: AssetCard[] }).cards;

describe('the go-live table', () => {
  const differing = cards.filter(
    (c) => c.sheetCode !== null && (c.vehicleCode === null || c.sheetCode !== c.vehicleCode),
  );
  const table = new Map(FUEL_SHEET_CODE_SEED.map((seed) => [foldSheetCode(seed.sheetCode), seed]));

  it('the asset has 43 such cards — the table answers every one with its car or its label', () => {
    expect(differing).toHaveLength(43);
    for (const c of differing) {
      const seed = table.get(foldSheetCode(c.sheetCode as string));
      expect(seed, c.sheetCode ?? '').toBeDefined();
      if (c.vehicleCode !== null) expect(seed?.vehicleCode, c.sheetCode ?? '').toBe(c.vehicleCode);
      else expect(seed?.label, c.sheetCode ?? '').toBe((c.label ?? '').trim());
    }
  });

  it('each spelling once, folded — and nothing the asset does not say', () => {
    expect(table.size).toBe(FUEL_SHEET_CODE_SEED.length);
    const spoken = new Set(differing.map((c) => foldSheetCode(c.sheetCode as string)));
    expect([...table.keys()].sort()).toEqual([...spoken].sort());
    expect(FUEL_SHEET_CODE_SEED).toHaveLength(25);
    for (const seed of FUEL_SHEET_CODE_SEED) {
      expect((seed.vehicleCode === null) !== (seed.label === null), seed.sheetCode).toBe(true);
    }
  });

  it('carries no PIN or number — only spellings and what they name', () => {
    expect(JSON.stringify(FUEL_SHEET_CODE_SEED)).not.toMatch(/\d{12,}/u);
  });
});
