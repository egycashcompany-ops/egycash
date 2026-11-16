// Round 24b — «ألوان الأنواع»: the one palette of «لوحة التشغيلة», pinned as pure rules.
//
// «عاوز pallett الالوان يكون على عدد الالوان يكون نفس عدد النوع» — as many swatches as live types;
// «تلقائي ويتغيّر يدوي» — a row wears its type's colour unless one is picked on it; «ينفع نوعين ياخدوا
// نفس اللون؟» → «أيوه عادي».
import { describe, expect, it } from 'vitest';
import {
  OPERATIONS_LEGACY_CREW_ROW_COLOURS,
  OPERATIONS_SHIFT_TYPE_COLOURS,
  canonicalCrewRowColour,
  type OperationsShiftTypeDto,
} from '@ecms/contracts';
import {
  PALETTE,
  colourWearers,
  freeColourFor,
  gridStep,
  inPalette,
  liveTypes,
  paletteFor,
  paletteOverflow,
  resolveRowColour,
  rowColourChoices,
  shownPalette,
  typeColourOf,
} from './type-colours';

const type = (
  id: string,
  colour: OperationsShiftTypeDto['colour'],
  isActive = true,
): OperationsShiftTypeDto => ({
  id,
  name: id,
  nameEn: null,
  colour,
  sortOrder: null,
  isActive,
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

/** The nine the boot seeds, in their seeded colours, «مسائي» archived. */
const SEEDED = [
  type('daily', 'rose'),
  type('reserve', 'teal'),
  type('reserveTravel', 'fuchsia'),
  type('aswan', 'indigo'),
  type('ebag', 'emerald'),
  type('travel', 'orange'),
  type('shalateen', 'amber'),
  type('secured', 'slate'),
  type('evening', 'violet', false),
];

describe('the palette shown — as many swatches as live types', () => {
  it('is the palette’s first N, in its order', () => {
    expect(PALETTE).toBe(OPERATIONS_SHIFT_TYPE_COLOURS);
    expect(shownPalette(0)).toEqual([]);
    expect(shownPalette(1)).toEqual(['rose']);
    expect(shownPalette(3)).toEqual(['rose', 'emerald', 'indigo']);
    expect(shownPalette(9)).toEqual(OPERATIONS_SHIFT_TYPE_COLOURS.slice(0, 9));
  });

  it('never more than the palette holds, never less than none', () => {
    expect(shownPalette(20)).toHaveLength(20);
    expect(shownPalette(27)).toEqual([...OPERATIONS_SHIFT_TYPE_COLOURS]);
    expect(shownPalette(-2)).toEqual([]);
    expect(shownPalette(2.7)).toEqual(['rose', 'emerald']);
  });

  it('counts the LIVE types only — an archived one is no swatch', () => {
    expect(liveTypes(SEEDED)).toHaveLength(8);
    expect(paletteFor(SEEDED)).toEqual(OPERATIONS_SHIFT_TYPE_COLOURS.slice(0, 8));
    expect(paletteFor([])).toEqual([]);
  });

  it('a fresh catalog of the nine seeded types finds every colour among the nine swatches', () => {
    const fresh = SEEDED.map((seeded) => ({ ...seeded, isActive: true }));
    const palette = paletteFor(fresh);
    expect(palette).toHaveLength(9);
    for (const seeded of fresh) expect(inPalette(palette, seeded.colour), seeded.id).toBe(true);
  });

  it('says when there are more live types than colours — the whole palette is shown then', () => {
    const many = Array.from({ length: 21 }, (_, i) => type(`t${i}`, 'rose'));
    expect(paletteOverflow(many)).toBe(true);
    expect(paletteFor(many)).toHaveLength(20);
    expect(paletteOverflow(many.slice(0, 20))).toBe(false);
    expect(paletteOverflow([...many.slice(0, 20), type('gone', 'rose', false)])).toBe(false);
  });
});

describe('a row’s colour — «تلقائي ويتغيّر يدوي»', () => {
  it('is the colour picked on the row, else its type’s, else none', () => {
    expect(resolveRowColour('navy', 'rose')).toEqual({ colour: 'navy', source: 'row' });
    expect(resolveRowColour(null, 'rose')).toEqual({ colour: 'rose', source: 'type' });
    expect(resolveRowColour('navy', null)).toEqual({ colour: 'navy', source: 'row' });
    expect(resolveRowColour(null, null)).toEqual({ colour: null, source: null });
  });

  it('reads the type’s colour by id — an archived type’s too, which a row may still hold', () => {
    expect(typeColourOf(SEEDED, 'travel')).toBe('orange');
    expect(typeColourOf(SEEDED, 'evening')).toBe('violet');
    expect(typeColourOf(SEEDED, null)).toBeNull();
    // The catalog not read yet, or a type it does not have: none, never a guess.
    expect(typeColourOf([], 'travel')).toBeNull();
    expect(typeColourOf(SEEDED, 'unknown')).toBeNull();
  });

  it('offers exactly the palette shown — and the row’s own colour after it when outside it', () => {
    const palette = shownPalette(3);
    expect(rowColourChoices(palette, null)).toEqual([
      { colour: 'rose', outside: false },
      { colour: 'emerald', outside: false },
      { colour: 'indigo', outside: false },
    ]);
    expect(rowColourChoices(palette, 'emerald')).toHaveLength(3);
    // Picked when the palette was larger: still offered (and so shown as current), once, at the end.
    expect(rowColourChoices(palette, 'plum')).toEqual([
      { colour: 'rose', outside: false },
      { colour: 'emerald', outside: false },
      { colour: 'indigo', outside: false },
      { colour: 'plum', outside: true },
    ]);
    expect(rowColourChoices([], 'plum')).toEqual([{ colour: 'plum', outside: true }]);
  });
});

describe('two types, one colour — «أيوه عادي»', () => {
  it('names every live type wearing a colour, in the catalog’s order', () => {
    const shared = [type('a', 'navy'), type('b', 'rose'), type('c', 'navy'), type('d', 'navy', false)];
    expect(colourWearers(shared, 'navy').map((t) => t.id)).toEqual(['a', 'c']);
    expect(colourWearers(shared, 'gold')).toEqual([]);
  });

  it('a new type starts on the first shown colour nobody live wears, else the first', () => {
    // Eight live wear the first eight but violet (fifth) — archived «مسائي» wore it: free.
    expect(freeColourFor(SEEDED)).toBe('violet');
    expect(freeColourFor([])).toBe('rose');
    // Everyone on one colour: the second swatch the new type would see.
    expect(freeColourFor([type('a', 'rose'), type('b', 'rose')])).toBe('emerald');
    const all = OPERATIONS_SHIFT_TYPE_COLOURS.map((colour, i) => type(`t${i}`, colour));
    expect(freeColourFor(all)).toBe('rose');
  });
});

describe('Round 20’s six row colours, read as the palette’s', () => {
  it('maps each onto its nearest palette colour, and reads anything unknown as none', () => {
    for (const [legacy, palette] of Object.entries(OPERATIONS_LEGACY_CREW_ROW_COLOURS)) {
      expect(canonicalCrewRowColour(legacy), legacy).toBe(palette);
      expect(PALETTE, legacy).toContain(palette);
    }
    expect(canonicalCrewRowColour('crimson')).toBe('crimson');
    expect(canonicalCrewRowColour('magenta')).toBeNull();
    expect(canonicalCrewRowColour(null)).toBeNull();
  });
});

describe('the arrows in a grid of swatches', () => {
  it('runs along a line in the reading direction — ← is the next swatch in Arabic', () => {
    expect(gridStep('ArrowLeft', 0, 9, 6, true)).toBe(1);
    expect(gridStep('ArrowRight', 0, 9, 6, true)).toBe(8);
    expect(gridStep('ArrowRight', 0, 9, 6, false)).toBe(1);
    expect(gridStep('ArrowLeft', 0, 9, 6, false)).toBe(8);
  });

  it('jumps a line by ↑/↓, wraps, and Home / End go to the ends', () => {
    expect(gridStep('ArrowDown', 2, 9, 6, true)).toBe(8);
    expect(gridStep('ArrowDown', 4, 9, 6, true)).toBe(1);
    expect(gridStep('ArrowUp', 1, 9, 6, true)).toBe(4);
    expect(gridStep('Home', 5, 9, 6, true)).toBe(0);
    expect(gridStep('End', 0, 9, 6, true)).toBe(8);
    expect(gridStep('Enter', 0, 9, 6, true)).toBeNull();
    expect(gridStep('ArrowLeft', 0, 0, 6, true)).toBeNull();
  });
});
