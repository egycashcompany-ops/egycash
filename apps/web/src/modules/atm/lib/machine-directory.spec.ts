// The machine directory's rules, without a DOM — what the filters ask the API, how a typed ID list
// is read, what the ID picker offers, and the export reading EVERY page. The screen itself is
// `machines-page.spec.tsx`; the API's answers are tests/integration/atm-machines-filter.spec.ts.
//
// Every bank, area, code and name below is synthetic.
import { describe, expect, it } from 'vitest';
import { type AtmMachineDto, type Paginated } from '@ecms/contracts';
import {
  fetchMachinesForExport,
  hasMachineFilters,
  machineCodeOptions,
  machineFilterQuery,
  machinesCsv,
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
