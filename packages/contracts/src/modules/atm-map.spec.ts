// The map's input contract, pinned (docs/12-planning/atm-map-zones.md §9.1): the zone save's
// refusals and caps (DM-37), the placement's discriminated union, the strict batch bodies, and the
// palette's casing flags. Every id and point below is synthetic.
import { describe, expect, it } from 'vitest';
import {
  ATM_MAP_SAVE_POINTS_MAX,
  ATM_MAP_ZONE_PALETTE,
  ATM_MAP_ZONES_PER_BRANCH_MAX,
  PlaceAtmMachineLocationSchema,
  ResolveAtmMapLinksSchema,
  SaveAtmMapZoneSetSchema,
  type SaveAtmMapZoneSetInput,
} from './atm-map.js';

const BRANCH = 'a'.repeat(24);
const id = (n: number): string => n.toString(16).padStart(24, '0');

const points = (count: number): { lat: number; lng: number }[] =>
  Array.from({ length: count }, (_, i) => ({ lat: 30 + i * 1e-5, lng: 31 + (i % 7) * 1e-5 }));

const save = (over: Partial<SaveAtmMapZoneSetInput> = {}): SaveAtmMapZoneSetInput => ({
  branchId: BRANCH,
  revision: 0,
  creates: [],
  updates: [],
  deletes: [],
  order: [],
  ...over,
});

const create = (tempId: string, n = 3) => ({
  tempId,
  name: 'قطاع تجريبي',
  color: '#483bba',
  points: points(n),
});

/** The refinement codes a refused save carries (they ride `message`, see ATM_MAP_SAVE_ISSUES). */
const issueCodes = (input: unknown): string[] => {
  const result = SaveAtmMapZoneSetSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe('SaveAtmMapZoneSetSchema', () => {
  it('accepts an empty save and a plain create', () => {
    expect(SaveAtmMapZoneSetSchema.safeParse(save()).success).toBe(true);
    expect(
      SaveAtmMapZoneSetSchema.safeParse(save({ creates: [create('new-1')], order: ['new-1'] }))
        .success,
    ).toBe(true);
  });

  it('refuses a duplicate tempId', () => {
    expect(issueCodes(save({ creates: [create('new-1'), create('new-1')] }))).toContain(
      'DUPLICATE_TEMP_ID',
    );
  });

  it('refuses an id that is both updated and deleted', () => {
    expect(issueCodes(save({ updates: [{ id: id(1), name: 'x' }], deletes: [id(1)] }))).toContain(
      'UPDATED_AND_DELETED',
    );
  });

  it('refuses duplicates in updates, deletes and order', () => {
    expect(
      issueCodes(
        save({
          updates: [
            { id: id(1), name: 'x' },
            { id: id(1), color: '#000000' },
          ],
        }),
      ),
    ).toContain('DUPLICATE_ID');
    expect(issueCodes(save({ deletes: [id(2), id(2)] }))).toContain('DUPLICATE_ID');
    expect(issueCodes(save({ order: [id(3), id(3)] }))).toContain('DUPLICATE_ID');
  });

  it('refuses an update that names no field', () => {
    expect(issueCodes(save({ updates: [{ id: id(1) }] }))).toContain('NO_FIELDS');
  });

  it('refuses a 61-character name and trims the name', () => {
    const long = save({ creates: [{ ...create('new-1'), name: 'ق'.repeat(61) }] });
    expect(SaveAtmMapZoneSetSchema.safeParse(long).success).toBe(false);
    const parsed = SaveAtmMapZoneSetSchema.parse(
      save({ creates: [{ ...create('new-1'), name: '  قطاع 1  ' }] }),
    );
    expect(parsed.creates[0]?.name).toBe('قطاع 1');
  });

  it('stores the colour lowercase and refuses a 3-digit colour', () => {
    const parsed = SaveAtmMapZoneSetSchema.parse(
      save({ creates: [{ ...create('new-1'), color: '#ABCDEF' }] }),
    );
    expect(parsed.creates[0]?.color).toBe('#abcdef');
    expect(
      SaveAtmMapZoneSetSchema.safeParse(save({ creates: [{ ...create('new-1'), color: '#abc' }] }))
        .success,
    ).toBe(false);
  });

  it('rounds every vertex to 6 decimals', () => {
    const parsed = SaveAtmMapZoneSetSchema.parse(
      save({
        creates: [{ ...create('new-1'), points: [...points(2), { lat: 30.12345678, lng: 31.9 }] }],
      }),
    );
    expect(parsed.creates[0]?.points[2]).toEqual({ lat: 30.123457, lng: 31.9 });
  });

  it('accepts a 200-entry order and refuses 201', () => {
    const order = Array.from({ length: ATM_MAP_ZONES_PER_BRANCH_MAX }, (_, i) => id(i + 1));
    expect(SaveAtmMapZoneSetSchema.safeParse(save({ order })).success).toBe(true);
    expect(SaveAtmMapZoneSetSchema.safeParse(save({ order: [...order, id(999)] })).success).toBe(
      false,
    );
  });

  it('refuses an order entry that is neither an ObjectId nor a tempId', () => {
    expect(SaveAtmMapZoneSetSchema.safeParse(save({ order: ['zone-1'] })).success).toBe(false);
    expect(SaveAtmMapZoneSetSchema.safeParse(save({ order: ['new-ABC'] })).success).toBe(false);
    expect(SaveAtmMapZoneSetSchema.safeParse(save({ order: ['new-abc', id(1)] })).success).toBe(
      true,
    );
  });

  it('refuses 20,001 points over creates + updates and accepts 20,000', () => {
    const forty = Array.from({ length: 40 }, (_, i) => create(`new-${String(i)}`, 500));
    expect(40 * 500).toBe(ATM_MAP_SAVE_POINTS_MAX);
    expect(SaveAtmMapZoneSetSchema.safeParse(save({ creates: forty })).success).toBe(true);

    const over = save({
      creates: [
        ...Array.from({ length: 39 }, (_, i) => create(`new-${String(i)}`, 500)),
        create('new-last', 498),
      ],
      updates: [{ id: id(1), points: points(3) }],
    });
    const result = SaveAtmMapZoneSetSchema.safeParse(over);
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((i) => i.message === 'TOO_MANY_POINTS_IN_SAVE');
    expect(issue).toMatchObject({ code: 'custom', params: { code: 'TOO_MANY_POINTS_IN_SAVE' } });
  });

  it('is strict', () => {
    expect(SaveAtmMapZoneSetSchema.safeParse({ ...save(), extra: 1 }).success).toBe(false);
  });
});

describe('PlaceAtmMachineLocationSchema', () => {
  it('discriminates on mode', () => {
    expect(
      PlaceAtmMachineLocationSchema.parse({ mode: 'pin', lat: 30.0444, lng: 31.2357, version: 2 }),
    ).toMatchObject({ mode: 'pin' });
    expect(
      PlaceAtmMachineLocationSchema.parse({
        mode: 'text',
        text: '30.0444, 31.2357',
        expected: { lat: 30.0444, lng: 31.2357 },
        version: 0,
      }),
    ).toMatchObject({ mode: 'text' });
    expect(PlaceAtmMachineLocationSchema.safeParse({ mode: 'drag', version: 0 }).success).toBe(
      false,
    );
  });

  it('refuses lat 91', () => {
    expect(
      PlaceAtmMachineLocationSchema.safeParse({ mode: 'pin', lat: 91, lng: 31, version: 0 })
        .success,
    ).toBe(false);
  });

  it('accepts version null — the machine has no location document yet', () => {
    expect(
      PlaceAtmMachineLocationSchema.safeParse({ mode: 'pin', lat: 30, lng: 31, version: null })
        .success,
    ).toBe(true);
  });

  it("refuses mode 'text' without the previewed point", () => {
    expect(
      PlaceAtmMachineLocationSchema.safeParse({ mode: 'text', text: '30, 31', version: null })
        .success,
    ).toBe(false);
  });
});

describe('ResolveAtmMapLinksSchema', () => {
  it('refuses retryFailed — one pass, no retry (DM-46)', () => {
    expect(ResolveAtmMapLinksSchema.safeParse({}).success).toBe(true);
    expect(ResolveAtmMapLinksSchema.safeParse({ retryFailed: true }).success).toBe(false);
  });
});

describe('ATM_MAP_ZONE_PALETTE', () => {
  /** WCAG 2 contrast against the map background the web casing rule uses (§8.5). */
  const luminance = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrastOnMap = (hex: string): number =>
    (luminance('#f2efe9') + 0.05) / (luminance(hex) + 0.05);

  it('has 12 unique lowercase hexes', () => {
    expect(ATM_MAP_ZONE_PALETTE).toHaveLength(12);
    expect(new Set(ATM_MAP_ZONE_PALETTE.map((c) => c.hex)).size).toBe(12);
    for (const colour of ATM_MAP_ZONE_PALETTE) expect(colour.hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('cases exactly the 5 light colours — those under 3:1 on the map', () => {
    const cased = ATM_MAP_ZONE_PALETTE.filter((c) => c.cased).map((c) => c.key);
    expect(cased).toEqual(['mustard', 'mint', 'sky', 'coral', 'orchid']);
    for (const colour of ATM_MAP_ZONE_PALETTE) {
      expect(contrastOnMap(colour.hex) < 3, colour.key).toBe(colour.cased);
    }
  });
});
