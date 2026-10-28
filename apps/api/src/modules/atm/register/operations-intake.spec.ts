// The data-edit intake's decision table (DEC-36), pure: steps a–f decide exactly one register
// outcome, the entry they write carries what the add form knows and nothing more, and a pending
// entry is received without its own data being overwritten. The transaction around it is
// tests/integration/atm-data-edit-register.spec.ts.
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  intakeEntryFields,
  intakeOpsBankLabel,
  intakeReceiptFill,
  openElsewhereOf,
  planIntakeRegister,
} from './operations-intake';

const ALEX = new Types.ObjectId().toHexString();
const TANTA = new Types.ObjectId().toHexString();
const master = new Types.ObjectId();
const catalog = { opsLabel: (code: string) => ({ NBE: 'NBE', BM: 'MISR' })[code] ?? code };

const plan = (over: Partial<Parameters<typeof planIntakeRegister>[0]> = {}) =>
  planIntakeRegister({
    mapped: true,
    placeholder: false,
    machineId: master,
    openHere: [],
    liveMasterIds: new Set(),
    pending: null,
    bankCode: 'BM',
    ...over,
  });

describe('step a — an open period in ANOTHER branch', () => {
  it('finds an open entry of another branch, or one with no branch at all', () => {
    const here = { branchId: new Types.ObjectId(ALEX) };
    const there = { branchId: new Types.ObjectId(TANTA) };
    const none = { branchId: null };
    expect(openElsewhereOf([here], ALEX)).toBeNull();
    expect(openElsewhereOf([here, there], ALEX)).toBe(there);
    expect(openElsewhereOf([none], ALEX)).toBe(none);
    expect(openElsewhereOf([], ALEX)).toBeNull();
  });
});

describe('steps c–f — what the register records', () => {
  it('c: an unmapped branch, then a placeholder code, record nothing (in that order)', () => {
    expect(plan({ mapped: false, placeholder: true })).toEqual({
      action: 'none',
      reason: 'branchUnmapped',
    });
    expect(plan({ placeholder: true })).toEqual({ action: 'none', reason: 'placeholderCode' });
  });

  it('d: an open entry already on this master is `existing`, whatever else is open', () => {
    const own = { _id: new Types.ObjectId(), machineId: master };
    const loose = { _id: new Types.ObjectId(), machineId: null };
    expect(plan({ openHere: [loose, own] })).toEqual({ action: 'existing', entryId: own._id });
  });

  it('d: every unlinked entry, and every one on a master no longer live, is `linked` — no bank needed', () => {
    const loose = { _id: new Types.ObjectId(), machineId: null };
    const dead = { _id: new Types.ObjectId(), machineId: new Types.ObjectId() };
    const live = { _id: new Types.ObjectId(), machineId: new Types.ObjectId() };
    expect(
      plan({
        openHere: [loose, dead, live],
        liveMasterIds: new Set([String(live.machineId)]),
        bankCode: null,
      }),
    ).toEqual({ action: 'linked', entryIds: [loose._id, dead._id] });
    // Never stolen from another LIVE master: the entry stands as it is.
    expect(plan({ openHere: [live], liveMasterIds: new Set([String(live.machineId)]) })).toEqual({
      action: 'existing',
      entryId: live._id,
    });
  });

  it('e: a pending entry is `received`, with its own bank first, else the resolved one', () => {
    const own = { _id: new Types.ObjectId(), bankCode: 'CIB' };
    expect(plan({ pending: own })).toEqual({
      action: 'received',
      entryId: own._id,
      bankCode: 'CIB',
    });
    const blank = { _id: new Types.ObjectId(), bankCode: null };
    expect(plan({ pending: blank })).toEqual({
      action: 'received',
      entryId: blank._id,
      bankCode: 'BM',
    });
    expect(plan({ pending: blank, bankCode: null })).toEqual({ action: 'none', reason: 'noBank' });
  });

  it('f: otherwise a new entry when the text resolved to a bank, else `noBank`', () => {
    expect(plan()).toEqual({ action: 'created', bankCode: 'BM' });
    expect(plan({ bankCode: null })).toEqual({ action: 'none', reason: 'noBank' });
  });
});

describe('what the intake writes', () => {
  it('records an override only when the text is not the bank’s catalog label', () => {
    expect(intakeOpsBankLabel('MISR', 'BM', catalog)).toBeNull();
    expect(intakeOpsBankLabel('NBE FOREX', 'NBE', catalog)).toBe('NBE FOREX');
    // Exact text: the master carries `misr`, so the entry's effective label must say so too.
    expect(intakeOpsBankLabel('misr', 'BM', catalog)).toBe('misr');
  });

  it('f: an OPEN entry dated the add day, linked, flagged, `operations`, every other field empty', () => {
    const fields = intakeEntryFields(
      { branchId: ALEX, machineCode: '1234', name: 'ATM', area: 'Smouha', bankName: 'MISR' },
      'BM',
      master,
      '2026-10-28',
      catalog,
    );
    expect(fields).toMatchObject({
      area: 'Smouha',
      bankCode: 'BM',
      opsBankLabel: null,
      machineCode: '1234',
      machineId: master,
      name: 'ATM',
      startDate: new Date('2026-10-28T00:00:00.000Z'),
      endDate: null,
      status: 'open',
      openPeriodExempt: false,
      source: 'operations',
      dataIncomplete: true,
      safeCombination: null,
      receiptNotes: null,
      importRunId: null,
      importIssues: [],
    });
    expect(String(fields.branchId)).toBe(ALEX);
    // No K value is written: the keys and cassettes are all null (DEC-7 never comes up).
    expect(Object.values(fields.keys ?? {}).every((value) => value === null)).toBe(true);
    expect(Object.values(fields.cassettes ?? {}).every((value) => value === null)).toBe(true);
  });

  it('e: the receipt fills only the blanks; the override follows the form only for the form’s bank', () => {
    const form = { area: 'Gleem', name: 'Form', bankName: 'NBE FOREX', bank: 'NBE' };
    const blank = { area: null, bankCode: null, name: 'Pending', opsBankLabel: null };
    expect(intakeReceiptFill(blank, form, master, '2026-10-28', catalog)).toEqual({
      startDate: new Date('2026-10-28T00:00:00.000Z'),
      status: 'open',
      machineId: master,
      dataIncomplete: true,
      area: 'Gleem',
      bankCode: 'NBE',
      name: 'Pending',
      opsBankLabel: 'NBE FOREX',
    });
    const own = { area: 'Kept', bankCode: 'CIB', name: null, opsBankLabel: null };
    const filled = intakeReceiptFill(own, form, master, '2026-10-28', catalog);
    expect(filled).toMatchObject({ area: 'Kept', bankCode: 'CIB', name: 'Form' });
    expect(filled).not.toHaveProperty('opsBankLabel');
  });
});
