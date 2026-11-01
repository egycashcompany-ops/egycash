// The machine sync's decision, pure: a machines file against the branch — what is added, brought
// back, edited (bank, name, area), left alone, refused, unreadable or listed twice — and the
// machines the file does not list, reported and never deleted.
import { describe, expect, it } from 'vitest';
import { type AtmBankCode } from '@ecms/contracts';
import {
  foldSpaces,
  planDigestOf,
  planMachineSync,
  type SyncBankCatalog,
  type SyncMachine,
} from './plan-machine-sync';
import { type MachineFileRow } from './read-machine-file';

const LABELS: Record<string, AtmBankCode> = {
  NBE: 'NBE',
  MISR: 'BM',
  'BANQUE MISR': 'BM',
  CIB: 'CIB',
  OLD: 'XOLD' as AtmBankCode,
};
const catalog: SyncBankCatalog = {
  codeOfLabel: (label) => LABELS[label.trim().toUpperCase()] ?? null,
  labelOf: (code) => (code === 'BM' ? 'MISR' : code),
  isActive: (code) => code !== ('XOLD' as AtmBankCode),
};

let rowNo = 1;
const row = (code: string, bank: string, name: string, area: string): MachineFileRow => ({
  row: ++rowNo,
  code,
  bank,
  name,
  area,
});
const machine = (over: Partial<SyncMachine> & { machineCode: string }): SyncMachine => ({
  id: `id-${over.machineCode}`,
  bankName: 'NBE',
  name: `ATM ${over.machineCode}`,
  area: 'Zamalek',
  isActive: true,
  ...over,
});

describe('planMachineSync', () => {
  it('adds what the branch lacks, refuses what works elsewhere, and leaves the same alone', () => {
    const plan = planMachineSync(
      [
        row('100', 'NBE', 'ATM 100', 'Zamalek'),
        row('200', 'NBE', 'New one', 'Dokki'),
        row('300', 'MISR', 'Away', 'Giza'),
      ],
      [machine({ machineCode: '100' })],
      new Map([['300', 'activeElsewhere' as const]]),
      catalog,
    );
    expect(plan.rows.map((r) => [r.machineCode, r.status])).toEqual([
      ['100', 'same'],
      ['200', 'add'],
      ['300', 'elsewhere'],
    ]);
    expect(plan.counts).toMatchObject({ same: 1, add: 1, elsewhere: 1, extra: 0 });
  });

  it('edits the bank, the name and the area that differ — the code is identity', () => {
    const plan = planMachineSync(
      [row('100', 'MISR', 'Renamed', 'Dokki')],
      [machine({ machineCode: '100', bankName: 'NBE', name: 'ATM 100', area: 'Zamalek' })],
      new Map(),
      catalog,
    );
    const [only] = plan.rows;
    expect(only).toMatchObject({
      status: 'update',
      changes: ['bank', 'name', 'area'],
      file: { bank: 'MISR', name: 'Renamed', area: 'Dokki' },
      current: { bank: 'NBE', name: 'ATM 100', area: 'Zamalek' },
      machineId: 'id-100',
    });
  });

  it('reads a bank by the catalog bank it names, and writes the catalog label', () => {
    const plan = planMachineSync(
      [row('100', 'Banque Misr', 'ATM 100', 'Zamalek')],
      [machine({ machineCode: '100', bankName: 'MISR' })],
      new Map(),
      catalog,
    );
    expect(plan.rows[0]).toMatchObject({ status: 'same', file: { bank: 'MISR' } });
  });

  it('folds spaces in names and areas, so a stray space is not a change nor a new area', () => {
    const plan = planMachineSync(
      [row(' 0100 ', ' NBE ', '  ATM   100 ', 'Omrania /  ElHaram')],
      [machine({ machineCode: '100', name: 'ATM 100', area: 'Omrania / ElHaram' })],
      new Map(),
      catalog,
    );
    expect(plan.rows[0]).toMatchObject({
      machineCode: '100',
      status: 'same',
      file: { name: 'ATM 100', area: 'Omrania / ElHaram' },
    });
    expect(foldSpaces('  a \t b\n')).toBe('a b');
  });

  it('follows the file exactly otherwise — a different letter case is a change', () => {
    const plan = planMachineSync(
      [row('100', 'NBE', 'ATM 100', 'ZAMALEK')],
      [machine({ machineCode: '100', area: 'Zamalek' })],
      new Map(),
      catalog,
    );
    expect(plan.rows[0]).toMatchObject({ status: 'update', changes: ['area'] });
  });

  it('brings an archived machine back with the file’s three', () => {
    const plan = planMachineSync(
      [row('100', 'NBE', 'ATM 100', 'Zamalek')],
      [machine({ machineCode: '100', isActive: false })],
      new Map(),
      catalog,
    );
    expect(plan.rows[0]).toMatchObject({ status: 'reactivate', changes: [] });
  });

  it('never offers what the add would refuse: archived here but working elsewhere, or open in another register', () => {
    const plan = planMachineSync(
      [row('100', 'NBE', 'ATM 100', 'Zamalek'), row('200', 'NBE', 'ATM 200', 'Zamalek')],
      [machine({ machineCode: '100', isActive: false })],
      new Map([
        ['100', 'activeElsewhere' as const],
        ['200', 'openElsewhere' as const],
      ]),
      catalog,
    );
    expect(plan.rows.map((r) => [r.machineCode, r.status, r.elsewhere, r.machineId])).toEqual([
      ['100', 'elsewhere', 'activeElsewhere', 'id-100'],
      ['200', 'elsewhere', 'openElsewhere', null],
    ]);
    expect(plan.counts).toMatchObject({ elsewhere: 2, add: 0, reactivate: 0 });
  });

  it('prefers the active machine of a code over an archived one', () => {
    const plan = planMachineSync(
      [row('100', 'NBE', 'ATM 100', 'Zamalek')],
      [
        machine({ machineCode: '100', id: 'old', isActive: false }),
        machine({ machineCode: '100', id: 'live' }),
      ],
      new Map(),
      catalog,
    );
    expect(plan.rows[0]).toMatchObject({ status: 'same', machineId: 'live' });
  });

  it('marks a row it cannot read, and a code listed twice — the first listing counts', () => {
    const plan = planMachineSync(
      [
        row('', 'NBE', '', 'Dokki'),
        row('101', '', 'X', 'Dokki'),
        row('102', 'NOPE', 'X', 'Dokki'),
        row('103', 'NBE', '', 'Dokki'),
        row('104', 'NBE', 'X', ''),
        row('105', 'NBE', 'First', 'Dokki'),
        row('0105', 'NBE', 'Second', 'Giza'),
      ],
      [],
      new Map(),
      catalog,
    );
    expect(plan.rows.map((r) => [r.status, r.issue])).toEqual([
      ['invalid', 'noCode'],
      ['invalid', 'noBank'],
      ['invalid', 'unknownBank'],
      ['invalid', 'noName'],
      ['invalid', 'noArea'],
      ['add', null],
      ['duplicate', null],
    ]);
    expect(plan.rows[6]?.firstRow).toBe(plan.rows[5]?.row);
    expect(plan.counts).toMatchObject({ invalid: 5, add: 1, duplicate: 1 });
  });

  it('never adds or brings back a machine on an archived bank, but compares one already working', () => {
    const plan = planMachineSync(
      [
        row('100', 'OLD', 'ATM 100', 'Zamalek'),
        row('200', 'OLD', 'ATM 200', 'Zamalek'),
        row('300', 'OLD', 'ATM 300', 'Zamalek'),
      ],
      [
        machine({ machineCode: '200', isActive: false, bankName: 'OLD' }),
        machine({ machineCode: '300', bankName: 'OLD' }),
      ],
      new Map(),
      catalog,
    );
    expect(plan.rows.map((r) => [r.status, r.issue])).toEqual([
      ['invalid', 'archivedBank'],
      ['invalid', 'archivedBank'],
      ['same', null],
    ]);
  });

  it('reports the branch’s machines the file does not list — active ones only, never to delete', () => {
    const plan = planMachineSync(
      [row('100', 'NBE', 'ATM 100', 'Zamalek'), row('400', 'NOPE', 'X', 'Y')],
      [
        machine({ machineCode: '100' }),
        machine({ machineCode: '300' }),
        machine({ machineCode: '200' }),
        machine({ machineCode: '500', isActive: false }),
        machine({ machineCode: '400' }),
      ],
      new Map(),
      catalog,
    );
    // 400 is named by an unreadable row: named, so not extra.
    expect(plan.extra.map((m) => m.machineCode)).toEqual(['200', '300']);
    expect(plan.counts.extra).toBe(2);
  });

  it('hashes the comparison: a machine edited since — even one that matched — changes it', () => {
    const fileRows = [row('100', 'NBE', 'ATM 100', 'Zamalek')];
    const before = planMachineSync(fileRows, [machine({ machineCode: '100' })], new Map(), catalog);
    const again = planMachineSync(fileRows, [machine({ machineCode: '100' })], new Map(), catalog);
    const moved = planMachineSync(
      fileRows,
      [machine({ machineCode: '100', area: 'Moved by operator' })],
      new Map(),
      catalog,
    );
    expect(planDigestOf('b1', before)).toBe(planDigestOf('b1', again));
    expect(planDigestOf('b1', before)).not.toBe(planDigestOf('b1', moved));
    // The branch is part of it.
    expect(planDigestOf('b1', before)).not.toBe(planDigestOf('b2', before));
  });
});
