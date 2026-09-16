// The registry's filter builders — pure, and worth pinning because both are regex-based.
//
// A user's search term reaches `new RegExp` directly, so escaping is not a nicety: an unescaped
// `.*` in the code box would list the entire fleet, and an unbalanced `(` would throw a 500 out of
// a text input. Both are asserted here rather than only through the integration suite, because
// this is where the rule lives and it must fail loudly if the escape is ever dropped.
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  vehicleIdentifierFilter,
  vehicleListFilter,
  vehicleSearchFilter,
} from './vehicle.repository';

const rx = (filter: Record<string, unknown>, field: string): RegExp => filter[field] as RegExp;

describe('vehicleSearchFilter — one term across the four identifiers', () => {
  it('asks all four fields at once', () => {
    const filter = vehicleSearchFilter('150') as { $or: Record<string, unknown>[] };
    expect(filter.$or.map((clause) => Object.keys(clause)[0])).toEqual([
      'code',
      'plateNumber',
      'chassisNumber',
      'motorNumber',
    ]);
  });

  it('matches a substring, case-insensitively', () => {
    const filter = vehicleSearchFilter('ch-1') as { $or: Record<string, unknown>[] };
    const codeRx = rx(filter.$or[0] as Record<string, unknown>, 'code');
    expect(codeRx.flags).toContain('i');
    expect(codeRx.test('XCH-150X')).toBe(true);
  });

  it('escapes regex metacharacters — a term is TEXT', () => {
    const filter = vehicleSearchFilter('.*') as { $or: Record<string, unknown>[] };
    const codeRx = rx(filter.$or[0] as Record<string, unknown>, 'code');
    expect(codeRx.test('anything')).toBe(false);
    expect(codeRx.test('a.*b')).toBe(true);
  });

  it('does not throw on an unbalanced bracket typed into the box', () => {
    expect(() => vehicleSearchFilter('CH-(150')).not.toThrow();
    const filter = vehicleSearchFilter('CH-(150') as { $or: Record<string, unknown>[] };
    expect(rx(filter.$or[0] as Record<string, unknown>, 'code').test('CH-(150')).toBe(true);
  });
});

describe('vehicleIdentifierFilter — ONE identifier, so filters can be ANDed', () => {
  it('narrows exactly one field, which is what makes "plate AND chassis" expressible', () => {
    const filter = vehicleIdentifierFilter('plateNumber', '150') as Record<string, unknown>;
    expect(Object.keys(filter)).toEqual(['plateNumber']);
    expect(rx(filter, 'plateNumber').test('س ص 150')).toBe(true);
  });

  it('escapes the term here too', () => {
    const filter = vehicleIdentifierFilter('code', '.*') as Record<string, unknown>;
    expect(rx(filter, 'code').test('V100')).toBe(false);
  });

  it('is case-insensitive, matching the combined search box', () => {
    const filter = vehicleIdentifierFilter('chassisNumber', 'ch-1') as Record<string, unknown>;
    expect(rx(filter, 'chassisNumber').test('CH-150')).toBe(true);
  });

  /**
   * `code` is what every VEHICLE-CODE selector in the web app sends (`vehicleCodeSearchQuery`),
   * and the reason it sends that instead of `search` is this asymmetry: one field is asked, so a
   * plate, chassis or motor number typed into a box labelled with the code finds nothing rather
   * than offering some other car under a code the reader never typed.
   */
  it('asks the CODE and nothing else — the guarantee the code pickers rest on', () => {
    const filter = vehicleIdentifierFilter('code', 'س ص 150') as Record<string, unknown>;
    expect(Object.keys(filter)).toEqual(['code']);
    // The plate of car 150. The four-identifier search finds the car; this deliberately does not.
    expect(rx(filter, 'code').test('150')).toBe(false);
    expect((vehicleSearchFilter('س ص 150') as { $or: Record<string, unknown>[] }).$or).toHaveLength(
      4,
    );
  });
});

// ── the whole bar, as one filter ────────────────────────────────────────────
//
// «اى فلتر ف الحركه زياده عن اتنين اختار ما بينهم اعملى multi selection». Five of the registry's
// controls take several answers now, and the two rules that make that correct are both easy to
// lose: several values ORed INSIDE one filter, and the filters ANDed with EACH OTHER. Get the
// first wrong and «ملاكي أو نقل» returns nothing; get the second wrong and adding a second
// filter widens the page instead of narrowing it.

const ID1 = new Types.ObjectId();
const ID2 = new Types.ObjectId();
/**
 * The `$and` clauses, by the field each one narrows.
 *
 * Typed loosely on purpose: a filter is a Mongo query object, and asserting on its INSIDES is the
 * whole point here — a precise type would only be a second copy of the shape under test.
 */
type Clause = Record<string, { $in?: unknown[] } & Record<string, unknown>>;
const clauses = (filter: Record<string, unknown>): Clause[] =>
  (filter['$and'] as Clause[] | undefined) ?? [];
const on = (filter: Record<string, unknown>, field: string): Clause | undefined =>
  clauses(filter).find((clause) => Object.keys(clause)[0] === field);
const inOf = (filter: Record<string, unknown>, field: string): unknown[] =>
  (on(filter, field)?.[field]?.$in ?? []) as unknown[];

describe('vehicleListFilter — several answers per filter, ANDed with each other', () => {
  it('asks for EVERY make ticked, in one `$in`', () => {
    const filter = vehicleListFilter({ typeId: [String(ID1), String(ID2)] } as never);
    expect(inOf(filter, 'typeId')).toHaveLength(2);
    expect(String(inOf(filter, 'typeId')[0])).toBe(String(ID1));
  });

  it('turns the ids into ObjectIds — a string would match no document at all', () => {
    const filter = vehicleListFilter({ branchId: [String(ID1)] } as never);
    expect(inOf(filter, 'branchId')[0]).toBeInstanceOf(Types.ObjectId);
  });

  it('reads ONE ticked value as the equality it used to be', () => {
    const filter = vehicleListFilter({ licenseClassId: [String(ID1)] } as never);
    expect(inOf(filter, 'licenseClassId')).toHaveLength(1);
  });

  it('ANDs the five reference filters rather than replacing one with the next', () => {
    const filter = vehicleListFilter({
      status: ['active', 'outOfService'],
      typeId: [String(ID1)],
      licenseClassId: [String(ID2)],
      operationId: [String(ID1)],
      insuranceCompanyId: [String(ID2)],
    } as never);
    expect(clauses(filter)).toHaveLength(5);
    expect(inOf(filter, 'status')).toEqual(['active', 'outOfService']);
  });

  it('builds NO clause for a filter nobody ticked — an empty `$in` matches no car', () => {
    // The contract's `listQuery` turns «nothing ticked» into an absent parameter, and this is the
    // other half of that rule: an absent parameter narrows nothing.
    expect(vehicleListFilter({} as never)).toEqual({});
    expect(clauses(vehicleListFilter({ typeId: undefined } as never))).toHaveLength(0);
  });

  it('still ANDs the identifier boxes and the search with the reference filters', () => {
    const filter = vehicleListFilter({
      typeId: [String(ID1)],
      plateNumber: '150',
      search: 'CH',
    } as never);
    expect(clauses(filter)).toHaveLength(3);
    expect(on(filter, 'plateNumber')?.['plateNumber']).toBeInstanceOf(RegExp);
  });
});
