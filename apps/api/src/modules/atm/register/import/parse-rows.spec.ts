// Row conversion and the file-level notes (spec §6.4, §10.2) — through a synthetic workbook and
// the real reader, so what is tested is what an upload produces. Every value is made up.
import { describe, expect, it } from 'vitest';
import {
  atmRow,
  buildRegisterWorkbook,
  cell,
  excelDate,
  excelTime,
  type SyntheticRow,
} from '../../../../../tests/integration/helpers/atm-register-workbook';
import { readRegisterWorkbook } from './read-register-workbook';
import { comparableColumns, parseRegisterRows, type ParsedRow } from './parse-rows';

const TODAY = '2026-10-13';
const FAKE_COMBO = '24 - 68 - 13';
const FAKE_KEY = 'FAKE-KEY-7781';

const parse = async (
  rows: (SyntheticRow | null)[],
  extra: { headerFills?: Record<string, string> } = {},
) =>
  parseRegisterRows(await readRegisterWorkbook(await buildRegisterWorkbook({ rows, ...extra })), {
    today: TODAY,
  });

const open = (fields: Parameters<typeof atmRow>[0], extra: SyntheticRow = {}): SyntheticRow =>
  atmRow(
    {
      branchCode: 'EGYCASH-4',
      area: 'Smouha',
      bankCode: 'NBE',
      name: 'Synthetic ATM',
      startDate: excelDate('2025-02-01'),
      ...fields,
    },
    extra,
  );

const byRow = (rows: ParsedRow[], importRow: number): ParsedRow => {
  const row = rows.find((r) => r.importRow === importRow);
  if (row === undefined) throw new Error(`row ${String(importRow)} not parsed`);
  return row;
};

const codes = (row: ParsedRow): string[] => row.issues.map((i) => i.code);

describe('one row', () => {
  it('converts every column and derives the status', async () => {
    const { rows } = await parse([
      open({
        machineCode: 99990001,
        serial: 'SN-0001',
        'keys.supervisorCode': FAKE_KEY,
        'cassettes.recycle200': 4,
        openTime: excelTime(8 / 24),
        safeCombination: cell(246813, { numFmt: '00 - 00 - 00' }),
        receivedByName: 'Receiver',
        hub: 'HUB-1',
      }),
    ]);
    const row = byRow(rows, 3);
    expect(row.status).toBe('open');
    expect(row.values).toMatchObject({
      branchCode: 'EGYCASH-4',
      area: 'Smouha',
      bankCode: 'NBE',
      machineCode: '99990001',
      startDate: '2025-02-01',
      endDate: null,
      openTime: '08:00',
      hub: 'HUB-1',
    });
    expect(row.values.keys.supervisorCode).toBe(FAKE_KEY);
    expect(row.values.cassettes.recycle200).toBe('4');
    expect(row.plaintextCombination).toBe(FAKE_COMBO);
    expect(row.carriesSecrets).toBe(true);
    expect(row.issues).toEqual([]);
    expect(comparableColumns(row).has('AO')).toBe(false);
    expect(comparableColumns(row).get('J')).toBe(FAKE_KEY);
  });

  it('a blank name, an ended and a pending row', async () => {
    const { rows } = await parse([
      open({ machineCode: 99990002, name: null, endDate: excelDate('2025-06-01') }),
      atmRow({ branchCode: 'EGYCASH-2', bankCode: 'BM', machineCode: 9999003, name: 'Pending' }),
    ]);
    expect(byRow(rows, 3)).toMatchObject({ status: 'ended', values: { name: null } });
    expect(codes(byRow(rows, 3))).toContain('noName');
    expect(byRow(rows, 4).status).toBe('pending');
    expect(byRow(rows, 4).carriesSecrets).toBe(false);
  });

  it('an unreadable end date is flagged, and the K columns never carry a detail', async () => {
    const { rows } = await parse([
      open(
        { machineCode: 99990004, endDate: 'next month', 'keys.supervisorCode': { error: '#REF!' } },
        { AN: { error: '#N/A' } },
      ),
    ]);
    const row = byRow(rows, 3);
    expect(row.dateUnreadable).toBe(true);
    expect(row.issues).toContainEqual({ code: 'dateInvalid', column: 'AR', detail: 'next month' });
    expect(row.issues).toContainEqual({ code: 'errorValue', column: 'J', detail: null });
    expect(row.issues).toContainEqual({ code: 'errorValue', column: 'AN', detail: null });
  });
});

describe('file-level notes', () => {
  it('duplicateOpen marks both rows exempt and names the other row; an ended row is not one', async () => {
    const { rows } = await parse([
      open({ machineCode: 99990010 }),
      open({ machineCode: 99990010, branchCode: 'EGYCASH-2' }),
      open({ machineCode: 99990010, endDate: excelDate('2024-12-01') }),
    ]);
    expect(byRow(rows, 3)).toMatchObject({ openPeriodExempt: true });
    expect(byRow(rows, 3).issues).toContainEqual({
      code: 'duplicateOpen',
      column: 'D',
      detail: '4',
    });
    expect(byRow(rows, 4).issues).toContainEqual({
      code: 'duplicateOpen',
      column: 'D',
      detail: '3',
    });
    expect(byRow(rows, 5).openPeriodExempt).toBe(false);
    expect(codes(byRow(rows, 5))).not.toContain('duplicateOpen');
  });

  it('openNotNewest: an open row with a later period of the same code', async () => {
    const { rows } = await parse([
      open({ machineCode: 99990011, startDate: excelDate('2024-01-01') }),
      open({
        machineCode: 99990011,
        startDate: excelDate('2025-01-01'),
        endDate: excelDate('2025-03-01'),
      }),
    ]);
    expect(byRow(rows, 3).issues).toContainEqual({
      code: 'openNotNewest',
      column: 'AQ',
      detail: '4',
    });
    expect(codes(byRow(rows, 4))).not.toContain('openNotNewest');
  });

  it('hdbSpelling names the other spelling', async () => {
    const { rows } = await parse([
      open({ bankCode: 'HDB', machineCode: 'HDB - 9902' }),
      open({ bankCode: 'HDB', machineCode: 'HDB-ATM9902', endDate: excelDate('2025-03-01') }),
      open({ bankCode: 'HDB', machineCode: 'HDB - 9903' }),
    ]);
    expect(byRow(rows, 3).issues).toContainEqual({
      code: 'hdbSpelling',
      column: 'D',
      detail: 'HDB-ATM9902',
    });
    expect(byRow(rows, 4).issues).toContainEqual({
      code: 'hdbSpelling',
      column: 'D',
      detail: 'HDB - 9902',
    });
    expect(codes(byRow(rows, 5))).not.toContain('hdbSpelling');
  });

  it('exactDuplicate names row numbers, never a value', async () => {
    const same = open(
      { machineCode: 99990012, 'keys.supervisorCode': FAKE_KEY, endDate: excelDate('2025-05-05') },
      { AO: FAKE_COMBO },
    );
    const { rows } = await parse([same, same]);
    const note = byRow(rows, 3).issues.find((i) => i.code === 'exactDuplicate');
    expect(note).toEqual({ code: 'exactDuplicate', column: null, detail: '4' });
    expect(JSON.stringify(rows.map((r) => r.issues))).not.toContain(FAKE_KEY);
    expect(JSON.stringify(rows.map((r) => r.issues))).not.toContain(FAKE_COMBO);
    // The in-memory hash input does not survive the parse.
    expect(Object.keys(byRow(rows, 3))).not.toContain('fingerprintInput');
  });

  it('serialDuplicate: open rows sharing a serial under different codes', async () => {
    const { rows } = await parse([
      open({ machineCode: 99990013, serial: 'SN-77' }),
      open({ machineCode: 99990014, serial: ' sn-77' }),
      open({ machineCode: 99990015, serial: 'SN-78' }),
    ]);
    expect(byRow(rows, 3).issues).toContainEqual({
      code: 'serialDuplicate',
      column: 'I',
      detail: '4',
    });
    expect(byRow(rows, 4).issues).toContainEqual({
      code: 'serialDuplicate',
      column: 'I',
      detail: '3',
    });
    expect(codes(byRow(rows, 5))).not.toContain('serialDuplicate');
  });

  it('id format, date order, future dates, open without area or bank', async () => {
    const { rows } = await parse([
      open({ machineCode: 123 }),
      open({
        machineCode: 99990016,
        startDate: excelDate('2025-05-01'),
        endDate: excelDate('2025-04-01'),
      }),
      open({ machineCode: 99990017, startDate: excelDate('2027-01-01') }),
      open({ machineCode: 99990018, endDate: excelDate('2026-12-31') }),
      open({ machineCode: 99990019, area: null, bankCode: null }),
    ]);
    expect(byRow(rows, 3).issues).toContainEqual({ code: 'idFormat', column: 'D', detail: '123' });
    expect(codes(byRow(rows, 4))).toContain('endBeforeStart');
    expect(codes(byRow(rows, 5))).toContain('futureStart');
    expect(codes(byRow(rows, 6))).toContain('futureEnd');
    expect(codes(byRow(rows, 7))).toEqual(expect.arrayContaining(['openNoArea', 'noBank']));
  });
});

describe('legacy marks (EG-2)', () => {
  it('captures fills that are not on column A, and derives areaRedFill / rowFill', async () => {
    const parsed = await parse(
      [
        open(
          { machineCode: 99990020, bankCode: cell('NBE', { fill: 'FFFFFF00' }) },
          {
            AN: cell('note', { fill: 'FFFF66FF' }),
            AW: cell('hub', { fill: 'FFFF0000' }),
          },
        ),
        open({
          machineCode: 99990021,
          branchCode: cell('EGYCASH-4', { fill: 'FFC6E0B4' }),
          area: cell('Smouha', { fill: 'FFFF0000' }),
        }),
        open({ machineCode: 99990022 }),
      ],
      { headerFills: { M: 'FFFF0000', O: 'FFFF0000', Z: 'FFFF0000', AP: 'FFFF0000' } },
    );
    expect(byRow(parsed.rows, 3).legacyMarks).toEqual({
      areaRedFill: false,
      rowFill: null,
      cellFills: [
        { column: 'C', fill: 'FFFFFF00' },
        { column: 'AN', fill: 'FFFF66FF' },
        { column: 'AW', fill: 'FFFF0000' },
      ],
    });
    expect(byRow(parsed.rows, 4).legacyMarks).toEqual({
      areaRedFill: true,
      rowFill: 'FFC6E0B4',
      cellFills: [
        { column: 'A', fill: 'FFC6E0B4' },
        { column: 'B', fill: 'FFFF0000' },
      ],
    });
    expect(byRow(parsed.rows, 5).legacyMarks).toBeNull();
    expect(parsed.headerFills.map((f) => f.column)).toEqual(['M', 'O', 'Z', 'AP']);
  });
});
