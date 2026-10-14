// The machine directory's rules, without a DOM — what the filters ask the API, how a typed ID list
// is read, what the ID picker offers, and the export reading EVERY page. The screen itself is
// `machines-page.spec.tsx`; the API's answers are tests/integration/atm-machines-filter.spec.ts.
//
// Every bank, area, code and name below is synthetic.
import { describe, expect, it } from 'vitest';
import {
  ATM_MACHINE_CODES_MAX,
  ListAtmMachinesQuerySchema,
  type AtmMachineDto,
  type Paginated,
} from '@ecms/contracts';
import {
  addMachineCodes,
  fetchMachinesForExport,
  hasMachineFilters,
  machineCodeOptions,
  machineCodeSearchTerm,
  machineFilterQuery,
  machinesCsv,
  pageBeyondEnd,
  readMachineCodeInput,
  readTypedMachineCodes,
} from './machine-directory';

const machine = (n: number, over: Partial<AtmMachineDto> = {}): AtmMachineDto => ({
  id: `66000000000000000000${String(n).padStart(4, '0')}`,
  branchId: '660000000000000000000001',
  bankName: 'SYN NBE',
  machineCode: String(10000 + n),
  name: `SYN ATM ${String(n)}`,
  zone: '',
  area: 'SYN Smouha',
  isActive: true,
  version: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const NONE = { banks: [], codes: [], name: '', areas: [] };

describe('what the filters ask the API', () => {
  it('asks for ACTIVE machines only, and nothing else, when nothing is narrowed', () => {
    expect(machineFilterQuery(NONE)).toEqual({ isActive: 'true' });
    expect(hasMachineFilters(NONE)).toBe(false);
    expect(hasMachineFilters({ ...NONE, name: '   ' })).toBe(false);
  });

  it('sends every column narrowed — a name holding a comma escaped, the typed name trimmed', () => {
    const filters = {
      banks: ['SYN Bank, Ltd', 'SYN NBE'],
      codes: ['101', '102'],
      name: '  Mall ',
      areas: ['SYN Raml, Station'],
    };
    expect(hasMachineFilters(filters)).toBe(true);
    expect(machineFilterQuery(filters)).toEqual({
      isActive: 'true',
      banks: 'SYN Bank\\, Ltd,SYN NBE',
      codes: '101,102',
      name: 'Mall',
      areas: 'SYN Raml\\, Station',
    });
  });
});

describe('a typed or pasted ID list', () => {
  it('takes each code the moment its separator is typed, and searches the rest', () => {
    expect(readTypedMachineCodes('0123')).toEqual({ chosen: [], typing: '0123' });
    expect(readTypedMachineCodes('0123 ')).toEqual({ chosen: ['123'], typing: '' });
    expect(readTypedMachineCodes('0123,456\n78')).toEqual({ chosen: ['123', '456'], typing: '78' });
    expect(readTypedMachineCodes('11، 22؛33 4')).toEqual({ chosen: ['11', '22', '33'], typing: '4' });
  });

  // MACH-1: a browser pasting a column into a one-line box turns its new lines into spaces and
  // drops the last one, so the last code came with no separator after it — left in the box as a
  // search, and lost when the list closed. Two of three codes were filtered, and nothing said so.
  it('takes a PASTED list whole — its last code too — however the lines were joined', () => {
    for (const pasted of ['1001\n1002\n1003', '1001 1002 1003', '1101, 1102, 1103', '1001\r\n1002\t1003']) {
      const { chosen, typing } = readMachineCodeInput('', pasted);
      expect(chosen, pasted).toHaveLength(3);
      expect(typing, pasted).toBe('');
    }
    expect(readMachineCodeInput('', '0101 0102 0103')).toEqual({ chosen: ['101', '102', '103'], typing: '' });
    // Pasted after codes already typed into the box: every one of them.
    expect(readMachineCodeInput('7', '71001 1002')).toEqual({ chosen: ['71001', '1002'], typing: '' });
  });

  it('still reads one keystroke at a time as typing — the code in progress stays the search', () => {
    expect(readMachineCodeInput('100', '1001')).toEqual({ chosen: [], typing: '1001' });
    expect(readMachineCodeInput('1001', '1001 ')).toEqual({ chosen: ['1001'], typing: '' });
    // A single pasted code, no separator: a search, as a typed one is.
    expect(readMachineCodeInput('', '1003')).toEqual({ chosen: [], typing: '1003' });
    // The picker opening asks again with nothing typed.
    expect(readMachineCodeInput('1003', '')).toEqual({ chosen: [], typing: '' });
  });
});

describe('the ID picker’s search', () => {
  // MACH-6: stored codes carry no leading zero, and the search is a substring of the stored code —
  // `0123` never matched machine 123 until Enter normalized it.
  it('looks for the code as it is stored: leading zeros dropped, spaces trimmed', () => {
    expect(machineCodeSearchTerm('0123')).toBe('123');
    expect(machineCodeSearchTerm(' 007 ')).toBe('7');
    expect(machineCodeSearchTerm('1230')).toBe('1230');
    // Only zeros name no machine: ask for nothing in particular.
    expect(machineCodeSearchTerm('000')).toBe('');
    expect(machineCodeSearchTerm('')).toBe('');
  });
});

describe('how many codes one filter takes', () => {
  // MACH-3: the API takes at most ATM_MACHINE_CODES_MAX codes; a longer list came back 400 on the
  // list and the summary, and the remembered filter brought the broken view back next visit.
  const codes = (from: number, count: number): string[] =>
    Array.from({ length: count }, (_unused, i) => String(from + i));

  it('adds up to the API’s limit, and counts what did not fit', () => {
    const { next, dropped } = addMachineCodes([], codes(1000, 230));
    expect(next).toEqual(codes(1000, ATM_MACHINE_CODES_MAX));
    expect(dropped).toBe(230 - ATM_MACHINE_CODES_MAX);
    // What the screen then sends, the API accepts.
    const query = machineFilterQuery({ ...NONE, codes: next });
    expect(ListAtmMachinesQuerySchema.safeParse(query).success).toBe(true);
    // One past the limit is what it refused.
    expect(
      ListAtmMachinesQuerySchema.safeParse({ ...query, codes: [...next, '99999'].join(',') }).success,
    ).toBe(false);
  });

  it('keeps the order chosen, each code once, and drops nothing when it fits', () => {
    expect(addMachineCodes(['5', '6'], ['6', '7', '5', '8'])).toEqual({
      next: ['5', '6', '7', '8'],
      dropped: 0,
    });
    const full = codes(1, ATM_MACHINE_CODES_MAX);
    expect(addMachineCodes(full, [full[0] ?? ''])).toEqual({ next: full, dropped: 0 });
    expect(addMachineCodes(full, ['99999'])).toEqual({ next: full, dropped: 1 });
  });
});

describe('a page past the end', () => {
  // MACH-5: a branch switch kept `?page=5` over a set of two pages — an empty table, «لا توجد
  // ماكينات.», and a pager reading «101–30 of 30 · page 5 of 2», beside counts saying 30.
  const meta = (page: number, totalItems: number, pageSize = 25) => ({
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
  });

  it('moves to the last page', () => {
    expect(pageBeyondEnd(5, meta(5, 30))).toBe(2);
    expect(pageBeyondEnd(150, meta(150, 2661))).toBe(107);
    expect(pageBeyondEnd(3, meta(3, 1))).toBe(1);
  });

  it('stays on a page in range, and on an empty set', () => {
    expect(pageBeyondEnd(2, meta(2, 30))).toBeNull();
    expect(pageBeyondEnd(1, meta(1, 30))).toBeNull();
    expect(pageBeyondEnd(4, meta(4, 0))).toBeNull();
  });
});

describe('the ID picker’s list', () => {
  it('lists what is chosen first — found or not — then what the search found', () => {
    const found = [machine(1), machine(2), machine(3)];
    const options = machineCodeOptions(found, ['10002', '99999']);
    expect(options.map((o) => o.value)).toEqual(['10002', '99999', '10001', '10003']);
    expect(options[0]).toEqual({ value: '10002', label: '10002 — SYN ATM 2', shortLabel: '10002' });
    expect(options[1]).toEqual({ value: '99999', label: '99999' });
  });
});

describe('the export', () => {
  it('reads EVERY page the filter matches — not the page in hand — each machine once', async () => {
    const all = Array.from({ length: 250 }, (_unused, i) => machine(i + 1));
    const asked: { page: number; pageSize: number }[] = [];
    const fetchPage = (page: number, pageSize: number): Promise<Paginated<AtmMachineDto>> => {
      asked.push({ page, pageSize });
      return Promise.resolve({
        items: all.slice((page - 1) * pageSize, page * pageSize),
        meta: { page, pageSize, totalItems: all.length, totalPages: Math.ceil(all.length / pageSize) },
      });
    };
    const rows = await fetchMachinesForExport(fetchPage);
    expect(rows).toHaveLength(250);
    expect(rows.map((row) => row.id)).toEqual(all.map((row) => row.id));
    expect(asked.map((call) => call.page).sort()).toEqual([1, 2, 3]);
    expect(asked.every((call) => call.pageSize === 100)).toBe(true);
  });

  it('writes the legacy four columns, Arabic behind a BOM, a comma or a quote escaped', () => {
    const csv = machinesCsv([
      machine(1, { bankName: 'SYN Bank, Ltd', name: 'SYN "Mall" ATM', area: 'سموحة' }),
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1).split('\n')).toEqual([
      'Bank,ID,ATM Name,Area',
      '"SYN Bank, Ltd",10001,"SYN ""Mall"" ATM",سموحة',
    ]);
  });
});
