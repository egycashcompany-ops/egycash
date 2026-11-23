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
  it('is every colour a live type wears, then the first unworn ones up to N, in the palette’s order', () => {
    expect(PALETTE).toBe(OPERATIONS_SHIFT_TYPE_COLOURS);
    expect(paletteFor([])).toEqual([]);
    expect(paletteFor([type('a', 'rose')])).toEqual(['rose']);
    // Worn late in the list: shown, in the palette's order — never «the first N».
    expect(paletteFor([type('a', 'olive'), type('b', 'navy')])).toEqual(['navy', 'olive']);
    // Two share rose: room for one unworn swatch, the palette's first (emerald).
    expect(paletteFor([type('a', 'rose'), type('b', 'slate'), type('c', 'rose')])).toEqual([
      'rose',
      'emerald',
      'slate',
    ]);
  });

  it('counts the LIVE types only — an archived one is no swatch, and its colour no wearer', () => {
    expect(liveTypes(SEEDED)).toHaveLength(8);
    // «مسائي» (violet) archived: the eight colours the eight live types wear — violet gone.
    expect(paletteFor(SEEDED)).toEqual([
      'rose',
      'emerald',
      'indigo',
      'amber',
      'teal',
      'orange',
      'fuchsia',
      'slate',
    ]);
    expect(paletteFor([type('gone', 'navy', false)])).toEqual([]);
  });

  it('a fresh catalog of the nine seeded types finds every colour among the nine swatches', () => {
    const fresh = SEEDED.map((seeded) => ({ ...seeded, isActive: true }));
    const palette = paletteFor(fresh);
    expect(palette).toEqual(OPERATIONS_SHIFT_TYPE_COLOURS.slice(0, 9));
    for (const seeded of fresh) expect(inPalette(palette, seeded.colour), seeded.id).toBe(true);
  });

  it('archiving ANY seeded type never pushes a live type off the palette, nor shows the archived one’s colour', () => {
    const fresh = SEEDED.map((seeded) => ({ ...seeded, isActive: true }));
    for (const archived of fresh) {
      const catalog = fresh.map((t) => (t.id === archived.id ? { ...t, isActive: false } : t));
      const palette = paletteFor(catalog);
      expect(palette, archived.id).toHaveLength(8);
      for (const live of liveTypes(catalog)) {
        expect(inPalette(palette, live.colour), `${archived.id} → ${live.id}`).toBe(true);
      }
      expect(inPalette(palette, archived.colour), archived.id).toBe(false);
    }
  });

  it('a form adding a type counts it: N + 1, the extra one the first colour nobody wears', () => {
    expect(paletteFor(SEEDED, 1)).toEqual([
      'rose',
      'emerald',
      'indigo',
      'amber',
      'violet',
      'teal',
      'orange',
      'fuchsia',
      'slate',
    ]);
    expect(paletteFor([], 1)).toEqual(['rose']);
    expect(paletteFor([type('a', 'olive')], 2.7)).toEqual(['rose', 'emerald', 'olive']);
    expect(paletteFor([type('a', 'olive')], -3)).toEqual(['olive']);
  });

  it('says when there are more live types than colours — the whole palette is shown then', () => {
    const many = Array.from({ length: 21 }, (_, i) => type(`t${i}`, 'rose'));
    expect(paletteOverflow(many)).toBe(true);
    expect(paletteFor(many)).toEqual([...OPERATIONS_SHIFT_TYPE_COLOURS]);
    expect(paletteFor(many, 1)).toHaveLength(20);
    expect(paletteOverflow(many.slice(0, 20))).toBe(false);
    expect(paletteOverflow([...many.slice(0, 20), type('gone', 'rose', false)])).toBe(false);
    const all = OPERATIONS_SHIFT_TYPE_COLOURS.map((colour, i) => type(`t${i}`, colour));
    expect(paletteFor(all)).toEqual([...OPERATIONS_SHIFT_TYPE_COLOURS]);
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
    const palette = paletteFor([type('a', 'rose'), type('b', 'emerald'), type('c', 'indigo')]);
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
    const shared = [
      type('a', 'navy'),
      type('b', 'rose'),
      type('c', 'navy'),
      type('d', 'navy', false),
    ];
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
  it('maps each onto the palette colour Round 20 drew it in, and reads anything unknown as none', () => {
    // Round 20 drew yellow bg-yellow-400 — the palette's gold, not amber (amber-600, orange-brown).
    expect(canonicalCrewRowColour('yellow')).toBe('gold');
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
