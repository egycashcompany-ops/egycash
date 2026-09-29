// The drivers' facts, read off the two old books — every rule of the join and the words, without a
// database, and the two REAL files pinned so a changed book is a failing test rather than a quiet
// difference on the registry.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DRIVER_DETAILS_FILE,
  LEGACY_DRIVERS_FILE,
  licenseTypeWord,
  matchLegacyRow,
  parseDriverDetails,
  parseLegacyDrivers,
  phoneKey,
  planDriverDetails,
  specializationWord,
  wordOf,
  type DetailsRow,
  type LegacyDriverRow,
} from './driver-details-import';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '..', '..', '..', '..', 'assets', 'fleet-go-live');

const reg = (o: Partial<DetailsRow> = {}): DetailsRow => ({
  code: '0100001',
  name: 'ابراهيم محمد محفوظ اسماعيل',
  title: 'سائق',
  licenseType: null,
  licenseDate: null,
  specialization: null,
  area: null,
  phones: [],
  deleted: false,
  ...o,
});
const book = (o: Partial<LegacyDriverRow> = {}): LegacyDriverRow => ({
  name: 'ابراهيم محمد محفوظ',
  licenseType: null,
  licenseDate: null,
  area: null,
  phone: null,
  label: 'ابراهيم محمد محفوظ',
  deleted: false,
  ...o,
});

describe('reading a book’s words', () => {
  it('reads the three ways the old books write «nothing» as nothing', () => {
    expect(wordOf(undefined)).toBeNull();
    expect(wordOf('')).toBeNull();
    expect(wordOf('   ')).toBeNull();
    expect(wordOf(0)).toBeNull();
    expect(wordOf('0')).toBeNull();
    expect(wordOf('  ثانية ')).toBe('ثانية');
    expect(wordOf('سائق  صراف   الى')).toBe('سائق صراف الى');
    // Any other number is what the book wrote, kept as its digits.
    expect(wordOf(44475)).toBe('44475');
  });

  it('reads one phone three ways by its last ten digits', () => {
    expect(phoneKey('01144357250')).toBe('1144357250');
    expect(phoneKey(1144357250)).toBe('1144357250');
    expect(phoneKey({ $numberLong: '11117119493' })).toBe('1117119493');
    expect(phoneKey('0114')).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });
});

describe('the catalog words', () => {
  it('reads the six spellings of the two licence classes as the catalog’s two words', () => {
    for (const word of ['أولى', 'اولى']) expect(licenseTypeWord(word)).toBe('اولى');
    for (const word of ['ثانية', 'ثانيه', 'تانية', 'تانيه', 'اتانية']) {
      expect(licenseTypeWord(word)).toBe('تانيه');
    }
  });

  it('reads «سوزوكى» as the catalog’s «سزوكى» — and keeps «Operation» as written', () => {
    expect(specializationWord('سوزوكى')).toBe('سزوكى');
    // «أضيف «Operation» (مقترح)» — added to the list under its own word, not folded into another.
    expect(specializationWord('Operation')).toBe('Operation');
    expect(specializationWord('ATM')).toBe('ATM');
  });

  it('keeps the bare «سائق» as its own «الوظيفة» — «أضيف «سائق» للقائمة», not grade A', () => {
    const plan = planDriverDetails([reg({ title: 'سائق' })], [], []);
    expect(plan.drivers[0]?.job).toBe('سائق');
  });
});

describe('matching a drivers-book row to a person', () => {
  const people = [
    { code: 'A', name: 'وليد عاطف عبد النبى سليم', phones: ['1090411159'] },
    { code: 'B', name: 'منير على محمود علام', phones: [] },
    { code: 'C', name: 'احمد محمد عبد ربه عبد الوهاب', phones: [] },
    { code: 'D', name: 'احمد محمد عبد ربه حسن', phones: [] },
    { code: 'E', name: 'محمد محمدين علي', phones: [] },
  ];

  it('by the phone first', () => {
    expect(matchLegacyRow(book({ name: 'اسم آخر تماما', phone: '1090411159' }), people)).toEqual({
      kind: 'matched',
      code: 'A',
      how: 'phone',
    });
  });

  it('then by the whole name, spaces and hamzas aside', () => {
    expect(matchLegacyRow(book({ name: 'منيرعلى محمود علام' }), people)).toEqual({
      kind: 'matched',
      code: 'B',
      how: 'name',
    });
  });

  it('then as the start of a longer name, at a word boundary', () => {
    expect(matchLegacyRow(book({ name: 'وليد عاطف عبدالنبى' }), people)).toEqual({
      kind: 'matched',
      code: 'A',
      how: 'prefix',
    });
  });

  it('never guesses between two people — ambiguous is reported, not picked', () => {
    expect(matchLegacyRow(book({ name: 'أحمد محمد عبد ربه' }), people)).toEqual({
      kind: 'ambiguous',
      codes: ['C', 'D'],
    });
  });

  it('does not read a two-word name, or half a word, as the start of somebody', () => {
    expect(matchLegacyRow(book({ name: 'وليد عاطف' }), people)).toEqual({ kind: 'unmatched' });
    // «محمد محمد» is a character prefix of «محمد محمدين» — but not at a word boundary.
    expect(matchLegacyRow(book({ name: 'محمد محمد علي' }), people)).toEqual({ kind: 'unmatched' });
  });
});

describe('joining the two books', () => {
  const late = new Date('2028-02-25T00:00:00.000Z');
  const early = new Date('2025-04-02T00:00:00.000Z');

  it('takes a fact from the newer register, and from the drivers book only where the register is empty', () => {
    const plan = planDriverDetails(
      [reg({ licenseType: 'ثانية', licenseDate: late, area: null })],
      [book({ licenseType: 'أولى', licenseDate: early, area: 'اوسيم' })],
      [],
    );
    expect(plan.drivers).toEqual([
      {
        code: '0100001',
        name: 'ابراهيم محمد محفوظ اسماعيل',
        job: 'سائق',
        specialization: null,
        licenseType: 'تانيه',
        licenseExpiresAt: late,
        area: 'اوسيم',
      },
    ]);
  });

  it('gives a driver the register does not list their drivers-book facts, when HR knows them', () => {
    const plan = planDriverDetails(
      [],
      [book({ name: 'سامح جمال الدين احمد', phone: '1099905859', licenseType: 'أولى' })],
      [{ code: '0100555', fullNameAr: 'سامح جمال الدين احمد فوزى', phone: '01099905859' }],
    );
    expect(plan.drivers).toMatchObject([{ code: '0100555', licenseType: 'اولى', job: null }]);
  });

  it('reads nothing off a row either book had deleted, and lists it', () => {
    const plan = planDriverDetails(
      [reg({ deleted: true, licenseType: 'أولى' })],
      [book({ deleted: true, label: 'محذوف — 01000000000' })],
      [],
    );
    expect(plan.drivers).toEqual([]);
    expect(plan.deletedRows).toEqual([
      '0100001 — ابراهيم محمد محفوظ اسماعيل',
      'محذوف — 01000000000',
    ]);
  });

  it('lists a drivers-book row it cannot place, by the name and phone the book wrote', () => {
    const plan = planDriverDetails([], [book({ label: 'مجهول — 01000000001' })], []);
    expect(plan.unmatchedLegacy).toEqual(['مجهول — 01000000001']);
  });
});

describe('the two real books', () => {
  const details = parseDriverDetails(
    JSON.parse(readFileSync(join(ASSETS, DRIVER_DETAILS_FILE), 'utf8')),
  );
  const legacy = parseLegacyDrivers(
    JSON.parse(readFileSync(join(ASSETS, LEGACY_DRIVERS_FILE), 'utf8')),
  );
  // No HR here: the register's own names and phones are the only people the drivers book can
  // land on. On the server HR's driving seats (leavers included) are a second place to look.
  const plan = planDriverDetails(details.rows, legacy.rows, []);
  const count = (pick: (d: (typeof plan.drivers)[number]) => unknown): number =>
    plan.drivers.filter((d) => pick(d) !== null).length;

  it('reads every row of both — 277 register rows, 152 drivers-book rows, none refused', () => {
    expect(details.rows).toHaveLength(277);
    expect(legacy.rows).toHaveLength(152);
    expect(details.rejected).toEqual([]);
    expect(legacy.rejected).toEqual([]);
  });

  it('plans facts for 277 drivers, field by field', () => {
    expect(plan.drivers).toHaveLength(277);
    expect(count((d) => d.job)).toBe(277);
    expect(count((d) => d.specialization)).toBe(161);
    expect(count((d) => d.licenseType)).toBe(157);
    expect(count((d) => d.licenseExpiresAt)).toBe(184);
    expect(count((d) => d.area)).toBe(158);
  });

  it('uses exactly the catalog words the owner agreed to', () => {
    expect(new Set(plan.drivers.map((d) => d.licenseType))).toEqual(
      new Set(['اولى', 'تانيه', null]),
    );
    expect(new Set(plan.drivers.map((d) => d.specialization))).toEqual(
      new Set(['نقل اموال', 'ملاكى', 'ATM', 'سزوكى', 'Operation', null]),
    );
    expect(new Set(plan.drivers.map((d) => d.job))).toEqual(
      new Set([
        'سائق',
        'سائق ب',
        'سائق ج',
        'سائق صراف الى',
        'اخصائى صراف الى ( موتوسيكل )',
        'منسق جراج',
      ]),
    );
  });

  it('places 111 of the 152 drivers-book rows on a register row, and names the other 41', () => {
    expect(plan.ambiguousLegacy).toEqual([]);
    expect(plan.unmatchedLegacy).toHaveLength(41);
    expect(plan.deletedRows).toEqual([]);
    expect(plan.duplicateCodes).toEqual([]);
  });
});

describe('a drivers-book row that fits two people', () => {
  // «محمد عبد الله محمد» fits a driver and somebody in another seat; the book is a book of drivers.
  const two = [
    { code: '0100028', fullNameAr: 'محمد عبد الله محمد عبد المحسن', phone: null },
    { code: '0100615', fullNameAr: 'محمد عبد الله محمد حسن', phone: null },
  ];
  const row = book({
    name: 'محمد عبد الله محمد',
    licenseType: 'أولى',
    label: 'محمد عبد الله محمد',
  });

  it('stays ambiguous when nothing tells them apart', () => {
    expect(planDriverDetails([], [row], two).ambiguousLegacy).toHaveLength(1);
  });

  it('goes to the one in a driving seat, when exactly one is', () => {
    const plan = planDriverDetails([], [row], two, new Set(['0100028']));
    expect(plan.ambiguousLegacy).toEqual([]);
    expect(plan.drivers).toMatchObject([{ code: '0100028', licenseType: 'اولى' }]);
  });
});
