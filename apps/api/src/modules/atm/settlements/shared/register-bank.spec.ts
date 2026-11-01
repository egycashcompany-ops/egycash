// The register is read through ONE helper with ONE projection (docs/12-planning/
// atm-settlements-phase1.md §6.2, §10.2, SEC-15): no key code, no notes field and no safe-door
// combination ref is ever loaded by the settlements pages. And a machine's bank is the common bank
// of its open entries (DS-3): none → `noRegisterBank`, disagreeing → `otherBank`.
import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AtmRegisterEntryModel } from '../../register/register.model';
import {
  REGISTER_BANK_PROJECTION,
  bankMachineIds,
  bankOfEntries,
  machineBanks,
  registerBankRows,
} from './register-bank';

const BRANCH = '64a000000000000000000001';
const M1 = new Types.ObjectId('64a0000000000000000000f1');
const M2 = new Types.ObjectId('64a0000000000000000000f2');
const M3 = new Types.ObjectId('64a0000000000000000000f3');

/** `find(filter, projection).lean().exec()` answering `rows`, recording each call. */
const stubFind = (rows: unknown[]) =>
  vi
    .spyOn(AtmRegisterEntryModel, 'find')
    .mockImplementation(() => ({ lean: () => ({ exec: async () => rows }) }) as never);

/** `find`'s overloads type its calls as `[]`; these are (filter, projection) pairs. */
const callsOf = (spy: { mock: { calls: unknown } }): [unknown, unknown][] =>
  spy.mock.calls as [unknown, unknown][];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('registerBankRows (§6.2)', () => {
  it('asks for open, live entries with exactly the projection — no keys, notes or combination', async () => {
    const find = stubFind([]);
    await registerBankRows([M1, String(M2)]);
    expect(find).toHaveBeenCalledTimes(1);
    const [filter, projection] = callsOf(find)[0] ?? [];
    expect(filter).toEqual({ machineId: { $in: [M1, M2] }, status: 'open', isDeleted: false });
    expect(projection).toEqual({
      machineId: 1,
      bankCode: 1,
      'cassettes.withdrawalCount': 1,
      'cassettes.withdrawal1': 1,
      'cassettes.withdrawal2': 1,
      'cassettes.withdrawal3': 1,
      'cassettes.withdrawal4': 1,
      'cassettes.withdrawal5': 1,
    });
    expect(projection).toBe(REGISTER_BANK_PROJECTION);
    const fields = Object.keys(projection as Record<string, unknown>).join(' ');
    expect(fields).not.toMatch(/keys|Notes|notes|safeCombination/);
  });

  it('reads one bank of one branch on the branch × status × bank index', async () => {
    const find = stubFind([]);
    await registerBankRows({ branchId: BRANCH, bankCode: 'BRK' });
    expect(callsOf(find)[0]?.[0]).toEqual({
      branchId: new Types.ObjectId(BRANCH),
      bankCode: 'BRK',
      status: 'open',
      isDeleted: false,
    });
    expect(callsOf(find)[0]?.[1]).toBe(REGISTER_BANK_PROJECTION);
  });

  it('asks nothing for no machine', async () => {
    const find = stubFind([]);
    expect(await registerBankRows([])).toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });
});

describe('machineBanks (DS-3)', () => {
  it('the common bank, no entry → noRegisterBank, two banks → otherBank', async () => {
    stubFind([
      { _id: new Types.ObjectId(), machineId: M1, bankCode: 'BRK' },
      { _id: new Types.ObjectId(), machineId: M2, bankCode: 'BRK' },
      { _id: new Types.ObjectId(), machineId: M2, bankCode: 'BM' },
    ]);
    const banks = await machineBanks([M1, M2, M3]);
    expect(banks.get(String(M1))).toEqual({ bank: 'BRK', reason: null });
    expect(banks.get(String(M2))).toEqual({ bank: null, reason: 'otherBank' });
    expect(banks.get(String(M3))).toEqual({ bank: null, reason: 'noRegisterBank' });
  });

  it('an open entry without a bank names no bank', () => {
    expect(bankOfEntries([{ bankCode: null }])).toEqual({ bank: null, reason: 'noRegisterBank' });
    expect(bankOfEntries([{ bankCode: 'BRK' }, { bankCode: null }])).toEqual({
      bank: null,
      reason: 'otherBank',
    });
  });
});

describe('bankMachineIds', () => {
  it("re-checks the bank's machines, so a machine with a second bank drops out", async () => {
    const find = vi.spyOn(AtmRegisterEntryModel, 'find');
    find
      .mockImplementationOnce(
        () =>
          ({
            lean: () => ({
              exec: async () => [
                { _id: new Types.ObjectId(), machineId: M1, bankCode: 'BRK' },
                { _id: new Types.ObjectId(), machineId: M2, bankCode: 'BRK' },
              ],
            }),
          }) as never,
      )
      .mockImplementationOnce(
        () =>
          ({
            lean: () => ({
              exec: async () => [
                { _id: new Types.ObjectId(), machineId: M1, bankCode: 'BRK' },
                { _id: new Types.ObjectId(), machineId: M2, bankCode: 'BRK' },
                { _id: new Types.ObjectId(), machineId: M2, bankCode: 'BM' },
              ],
            }),
          }) as never,
      );
    expect(await bankMachineIds(BRANCH, 'BRK')).toEqual([String(M1)]);
    expect(callsOf(find).every((call) => call[1] === REGISTER_BANK_PROJECTION)).toBe(true);
  });
});
