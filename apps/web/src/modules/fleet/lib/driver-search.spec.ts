// Finding a driver by whatever the reader knows about them.
//
// The point of this search is that the dispatcher does not have to say WHICH kind of thing they
// typed: a name, the code from the card, the number from a list — all of them find the person.
// So the tests are organised by what the reader has in hand, not by what the code does with it.
import { describe, expect, it } from 'vitest';
import {
  driverHaystack,
  filterDrivers,
  matchesDriver,
  type DriverSearchRecord,
} from './driver-search';

const AHMED: DriverSearchRecord = {
  employeeId: '650000000000000000000011',
  nameAr: 'أحمد فوزي عثمان',
  nameEn: 'Ahmed Fawzy Osman',
  code: '001000125',
  employeeNumber: '000125',
};
const MOHAMED: DriverSearchRecord = {
  employeeId: '650000000000000000000012',
  nameAr: 'محمد عبد الله',
  nameEn: null,
  code: '004000126',
  employeeNumber: '000126',
};
const NAMELESS: DriverSearchRecord = { employeeId: '650000000000000000000013' };

const INDEX = new Map([
  [AHMED.employeeId, AHMED],
  [MOHAMED.employeeId, MOHAMED],
]);
const POOL = [
  { employeeId: AHMED.employeeId },
  { employeeId: MOHAMED.employeeId },
  { employeeId: NAMELESS.employeeId },
];
const found = (term: string): string[] => filterDrivers(POOL, INDEX, term).map((d) => d.employeeId);

describe('what a reader can search by', () => {
  it('the Arabic name, whole or part', () => {
    expect(matchesDriver(AHMED, 'أحمد')).toBe(true);
    expect(matchesDriver(AHMED, 'فوزي')).toBe(true);
    // The second name finds them too — a person is as often known by it as by the first.
    expect(matchesDriver(AHMED, 'عثمان')).toBe(true);
  });

  it('the English name, when the record carries one', () => {
    expect(matchesDriver(AHMED, 'Fawzy')).toBe(true);
    expect(matchesDriver(AHMED, 'fawzy'), 'case does not matter').toBe(true);
    // …and a missing English name is not an error, just one fewer way in.
    expect(matchesDriver(MOHAMED, 'Mohamed')).toBe(false);
    expect(matchesDriver(MOHAMED, 'محمد')).toBe(true);
  });

  it('the displayed employee code, including its tail', () => {
    expect(matchesDriver(AHMED, '001000125')).toBe(true);
    // Codes are quoted from the end as often as the start, so this is substring, not prefix.
    expect(matchesDriver(AHMED, '000125')).toBe(true);
  });

  it('the permanent employee number, which survives a branch transfer', () => {
    // The code's prefix changes on transfer; the number does not. Someone working from an old
    // list has the number, and it still has to find them.
    expect(matchesDriver({ ...AHMED, code: '009000125' }, '000125')).toBe(true);
  });

  it('the employee id — the only thing left when names cannot be read', () => {
    // Without `employee.view` no record loads, and the card shows the id. Searching by what is
    // on screen must still work, or the search would be lying about what it covers.
    expect(matchesDriver(NAMELESS, '650000000000000000000013')).toBe(true);
    expect(matchesDriver(NAMELESS, '0013')).toBe(true);
  });
});

describe('the haystack', () => {
  it('joins the fields with a space, so a term cannot match ACROSS two of them', () => {
    // Without the separator, "عثمان001" would find this driver — a match nobody meant, spanning
    // the end of the name and the start of the code.
    expect(matchesDriver(AHMED, 'عثمان001')).toBe(false);
    expect(driverHaystack(AHMED).split(' ')).toContain('001000125');
  });

  it('drops nullish and blank fields rather than searching the word "null"', () => {
    expect(driverHaystack(MOHAMED)).not.toContain('null');
    expect(driverHaystack({ employeeId: 'x', nameAr: '   ', code: null })).toBe('x');
  });

  it('is lowercased once, so every comparison below is case-insensitive', () => {
    expect(driverHaystack(AHMED)).toBe(driverHaystack(AHMED).toLowerCase());
  });

  it('matchesDriver treats an empty term as "everyone", on its own', () => {
    // `filterDrivers` short-circuits the empty term before it ever calls this, so the rule has
    // to be asserted HERE — otherwise `matchesDriver` could start answering false for "" and
    // every test above would still pass, until the first caller that does not short-circuit.
    expect(matchesDriver(AHMED, '')).toBe(true);
    expect(matchesDriver(NAMELESS, '   ')).toBe(true);
  });
});

describe('filtering the pool', () => {
  it('an empty term offers everyone — no filter and a filter that excludes nobody agree', () => {
    expect(found('')).toHaveLength(3);
    expect(found('   '), 'whitespace is not a search').toHaveLength(3);
  });

  it('narrows to the drivers that match, and keeps the server order', () => {
    expect(found('محمد')).toEqual([MOHAMED.employeeId]);
    // «أحمد» appears only in the first driver's name, so order is trivially preserved there;
    // a term matching both must come back in the order the pool gave them.
    expect(found('0000000000000000001')).toEqual(POOL.map((d) => d.employeeId));
  });

  it('answers with nothing when nobody matches', () => {
    expect(found('لا أحد بهذا الاسم')).toEqual([]);
  });

  it('restores the whole pool when the search is cleared', () => {
    expect(found('محمد')).toHaveLength(1);
    expect(found(''), 'clearing brings everyone back').toHaveLength(3);
  });

  it('trims the term, so a stray space does not empty the list', () => {
    expect(found('  محمد  ')).toEqual([MOHAMED.employeeId]);
  });

  it('keeps a driver searchable by id while their record is still loading', () => {
    // The index fills in as the employee queries land. A driver missing from it must not vanish
    // from the list mid-type — they degrade to "findable by id", not to "gone".
    const empty = new Map<string, DriverSearchRecord>();
    expect(filterDrivers(POOL, empty, '0011').map((d) => d.employeeId)).toEqual([AHMED.employeeId]);
    expect(filterDrivers(POOL, empty, '').length, 'and no term still shows everyone').toBe(3);
  });

  it('does not mutate the pool it was given', () => {
    const snapshot = JSON.stringify(POOL);
    filterDrivers(POOL, INDEX, 'محمد');
    expect(JSON.stringify(POOL)).toBe(snapshot);
    expect(filterDrivers(POOL, INDEX, ''), 'and returns a new array').not.toBe(POOL);
  });
});
