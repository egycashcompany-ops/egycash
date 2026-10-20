// The mobile lines reach the company by DEPLOYING, and what they write is the reviewed file — the
// file is held to the review here, with the deploy's caller and the rules a row keeps. The writing
// itself is proved against a real mongo in `tests/integration/it-go-live-mobile-lines.spec.ts`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MobileLinesFileSchema,
  parseMobileLines,
  type MobileLineRow,
  type MobileLinesFile,
} from './mobile-lines-import';
import { IT_MOBILE_LINES_MARK, MOBILE_LINES_FILE, resolveMobileLinesFile } from './mobile-lines';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(HERE, '..', '..', '..', '..');

/** Source with comments removed: a call commented out must not keep the guard green. */
const code = (path: string): string =>
  readFileSync(join(API_ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const raw = (): string => {
  const file = resolveMobileLinesFile();
  if (file === null) throw new Error(`${MOBILE_LINES_FILE} is not where the go-live looks`);
  return readFileSync(file, 'utf8');
};

const committed = (): MobileLinesFile => parseMobileLines(JSON.parse(raw()));

describe('the mobile lines are imported by the deploy', () => {
  it.each(['src/server.ts', 'src/worker.ts'])('%s starts it', (file) => {
    expect(code(file)).toContain('startItMobileLinesGoLive();');
  });

  it('runs once per version of the file', () => {
    expect(IT_MOBILE_LINES_MARK).toMatch(/:v\d+$/u);
  });
});

describe('the committed file is the reviewed one', () => {
  const { lines } = committed();
  const count = (pick: (row: MobileLineRow) => boolean) => lines.filter(pick).length;
  const tally = (pick: (row: MobileLineRow) => string) =>
    Object.fromEntries(
      [...new Set(lines.map(pick))].map((value) => [value, count((row) => pick(row) === value)]),
    );

  it('holds every line of the three networks’ files', () => {
    expect(lines).toHaveLength(392);
    expect(tally((row) => row.network)).toEqual({ vodafone: 50, etisalat: 270, orange: 72 });
  });

  it('keeps every line in its branch', () => {
    expect(tally((row) => row.branch)).toEqual({
      المهندسين: 220,
      أسيوط: 49,
      طنطا: 38,
      أكتوبر: 25,
      بورسعيد: 24,
      الإسكندرية: 20,
      الشروق: 16,
    });
  });

  it('hands over 319 lines: 301 to 285 employees, 18 tracker SIMs to their cars', () => {
    const handed = lines.filter((row) => row.status === 'assigned');
    expect(handed).toHaveLength(319);
    const toEmployees = handed.filter((row) => row.holderCode !== null);
    expect(toEmployees).toHaveLength(301);
    expect(new Set(toEmployees.map((row) => row.holderCode)).size).toBe(285);
    const toCars = handed.filter((row) => row.vehicleCode !== null || row.vehiclePlate !== null);
    expect(toCars).toHaveLength(18);
    expect(toCars.every((row) => row.holderCode === null)).toBe(true);
  });

  it('keeps 68 in stock and 5 suspended, none of them naming a holder', () => {
    expect(tally((row) => row.status)).toEqual({ assigned: 319, inStock: 68, suspended: 5 });
    const unheld = lines.filter((row) => row.status !== 'assigned');
    expect(
      unheld.every(
        (row) => row.holderCode === null && row.vehicleCode === null && row.vehiclePlate === null,
      ),
    ).toBe(true);
  });

  it('has one eSIM, with no card serial', () => {
    const esims = lines.filter((row) => row.simKind === 'esim');
    expect(esims).toHaveLength(1);
    expect(esims[0]?.simSerial).toBeNull();
  });

  it('carries codes from HR and nothing else — no national ID is in the file', () => {
    expect(raw()).not.toMatch(/\b[23]\d{13}\b/u);
  });

  // The repository is public: the file names nobody. A line the network has registered to
  // somebody HR knows carries their CODE, and the import writes the name from HR.
  it('names nobody — a person is a code, and every note is one of the review’s few', () => {
    const registered = lines.filter((row) => row.registeredToCode !== null);
    // 20 leavers, 7 likely matches the review left unsettled, 5 suspended lines.
    expect(registered).toHaveLength(32);
    expect(registered.every((row) => row.status !== 'assigned')).toBe(true);
    // The seven matched by name alone say so — never presented as the network's own record.
    const likely = lines.filter((row) => row.registeredToLikely);
    expect(likely).toHaveLength(7);
    expect(likely.every((row) => row.status === 'inStock' && row.registeredToCode !== null)).toBe(
      true,
    );
    const notes = new Set(lines.flatMap((row) => row.note ?? []));
    for (const note of notes) {
      expect(note).toMatch(
        /^(خط موقوف|شريحة جهاز تتبع — [A-Za-z0-9 ]+|مسجّل في الشبكة باسم شخص غير موجود في الموارد البشرية|مسجّل في الشبكة باسم: جمال النيل لنقل الأموال)$/u,
      );
    }
    // No tracker's IMEI either: a 15-digit number is not a line's, a card's or an account's.
    expect(raw()).not.toMatch(/\b\d{15}\b/u);
  });
});

describe('a row keeps the register’s rules', () => {
  const row = (over: Partial<MobileLineRow>): MobileLineRow => ({
    key: 'Vodafone صف 1',
    network: 'vodafone',
    accountNumber: '8.29280625.1',
    phoneNumber: '01000000001',
    simKind: 'physical',
    simSerial: '8920022022700000001',
    ratePlan: '2025 Business Flex 80',
    branch: 'المهندسين',
    status: 'inStock',
    holderCode: null,
    registeredToCode: null,
    registeredToLikely: false,
    vehicleCode: null,
    vehiclePlate: null,
    note: null,
    ...over,
  });
  const accepts = (lines: MobileLineRow[]) =>
    MobileLinesFileSchema.safeParse({ source: 'test', lines }).success;

  it('takes a line to an employee, a line to a car and a line in stock', () => {
    expect(
      accepts([
        row({ status: 'assigned', holderCode: '0100001' }),
        row({
          key: 'b',
          phoneNumber: '01000000002',
          simSerial: '8920022022700000002',
          status: 'assigned',
          vehicleCode: '64',
          vehiclePlate: 'ج ك ق 4718',
        }),
        row({ key: 'c', phoneNumber: '01000000003', simSerial: null }),
      ]),
    ).toBe(true);
  });

  it('refuses a repeated key, number or card', () => {
    expect(accepts([row({}), row({ phoneNumber: '01000000002', simSerial: null })])).toBe(false);
    expect(accepts([row({}), row({ key: 'b', simSerial: null })])).toBe(false);
    expect(accepts([row({}), row({ key: 'b', phoneNumber: '01000000002' })])).toBe(false);
  });

  it('refuses a number not in the register’s form, and an eSIM with a serial', () => {
    expect(accepts([row({ phoneNumber: '1000000001' })])).toBe(false);
    expect(accepts([row({ phoneNumber: '+201000000001' })])).toBe(false);
    expect(accepts([row({ simKind: 'esim' })])).toBe(false);
  });

  it('hands a line to exactly one holder, and a line in stock or suspended to none', () => {
    expect(accepts([row({ status: 'assigned' })])).toBe(false);
    expect(accepts([row({ status: 'assigned', holderCode: '0100001', vehicleCode: '64' })])).toBe(
      false,
    );
    expect(accepts([row({ holderCode: '0100001' })])).toBe(false);
    expect(accepts([row({ status: 'suspended', vehiclePlate: 'ج ك ق 4718' })])).toBe(false);
  });

  it('says whom a line nobody holds is registered to — never a line somebody holds', () => {
    expect(accepts([row({ registeredToCode: '0100001' })])).toBe(true);
    expect(accepts([row({ status: 'suspended', registeredToCode: '0100001' })])).toBe(true);
    expect(
      accepts([row({ status: 'assigned', holderCode: '0100002', registeredToCode: '0100001' })]),
    ).toBe(false);
    expect(accepts([row({ registeredToCode: '100001' })])).toBe(false);
    expect(accepts([row({ registeredToCode: '0100001', registeredToLikely: true })])).toBe(true);
    expect(accepts([row({ registeredToLikely: true })])).toBe(false);
  });
});
