// Which bank a machine serves, read from the Efficiency register — the ONE helper the settlements
// pages read the register through (docs/12-planning/atm-settlements-phase1.md §6.2, DS-3, SEC-15).
//
// A machine's bank is the common `bankCode` of the OPEN entries linked to it (`machineId`), the
// map's rule (`map/location/derive.ts` `commonBankCode`). A live machine with no such entry has no
// register bank (`noRegisterBank`): `atm_machines` is filled by the legacy import separately from
// the register, so that is a normal case, not "another bank". One whose open entries disagree
// belongs to no bank (`otherBank`, GS-25). Neither can be planned.
//
// THE PROJECTION. An entry holds `keys`, the notes fields and the `safeCombination` ref
// (`register/register.model.ts`); none of them is ever loaded into this feature's memory (the
// map's rule, `map/location.service.ts`). Only the bank and the withdrawal-cassette texts the
// import compares (§5.3 `registerCountDiffers`, `registerDenominationsDiffer`) leave the database.
import { type AtmBankCode, type AtmRegisterCassettesDto } from '@ecms/contracts';
import { Types } from 'mongoose';
import { commonBankCode } from '../../map/location/derive';
import { AtmRegisterEntryModel } from '../../register/register.model';

/** Exactly these fields, and never another (§6.2). */
export const REGISTER_BANK_PROJECTION = {
  machineId: 1,
  bankCode: 1,
  'cassettes.withdrawalCount': 1,
  'cassettes.withdrawal1': 1,
  'cassettes.withdrawal2': 1,
  'cassettes.withdrawal3': 1,
  'cassettes.withdrawal4': 1,
  'cassettes.withdrawal5': 1,
} as const;

export type RegisterBankCassettes = Partial<
  Pick<
    AtmRegisterCassettesDto,
    | 'withdrawalCount'
    | 'withdrawal1'
    | 'withdrawal2'
    | 'withdrawal3'
    | 'withdrawal4'
    | 'withdrawal5'
  >
>;

export interface RegisterBankRow {
  _id: Types.ObjectId;
  machineId: Types.ObjectId | null;
  bankCode: AtmBankCode | null;
  cassettes?: RegisterBankCassettes;
}

export type RegisterBankFilter =
  | readonly (Types.ObjectId | string)[]
  | { branchId: Types.ObjectId | string; bankCode: AtmBankCode };

const asId = (id: Types.ObjectId | string): Types.ObjectId =>
  typeof id === 'string' ? new Types.ObjectId(id) : id;

const isIdList = (filter: RegisterBankFilter): filter is readonly (Types.ObjectId | string)[] =>
  Array.isArray(filter);

/**
 * The OPEN, live register entries of some machines (by `machineId`), or of one bank in one branch
 * (index `ix_branch_status_bank`), with the projection above.
 */
export const registerBankRows = async (filter: RegisterBankFilter): Promise<RegisterBankRow[]> => {
  if (isIdList(filter) && filter.length === 0) return [];
  const match: Record<string, unknown> = isIdList(filter)
    ? { machineId: { $in: filter.map(asId) } }
    : { branchId: asId(filter.branchId), bankCode: filter.bankCode };
  return AtmRegisterEntryModel.find(
    { ...match, status: 'open', isDeleted: false },
    REGISTER_BANK_PROJECTION,
  )
    .lean<RegisterBankRow[]>()
    .exec();
};

export type MachineBankReason = 'noRegisterBank' | 'otherBank';

export interface MachineBank {
  bank: AtmBankCode | null;
  reason: MachineBankReason | null;
}

/** DS-3 from a machine's open entries (already read). */
export const bankOfEntries = (
  entries: readonly { bankCode: AtmBankCode | null }[],
): MachineBank => {
  const codes = entries.map((e) => e.bankCode ?? null);
  const bank = commonBankCode(codes);
  if (bank !== null) return { bank, reason: null };
  return { bank: null, reason: codes.some((c) => c !== null) ? 'otherBank' : 'noRegisterBank' };
};

/** Every machine's open entries, by machine id — one read. */
export const registerRowsByMachine = async (
  machineIds: readonly (Types.ObjectId | string)[],
): Promise<Map<string, RegisterBankRow[]>> => {
  const byMachine = new Map<string, RegisterBankRow[]>();
  for (const row of await registerBankRows(machineIds)) {
    if (row.machineId === null) continue;
    const key = String(row.machineId);
    byMachine.set(key, [...(byMachine.get(key) ?? []), row]);
  }
  return byMachine;
};

/** DS-3: each machine's register bank, or why it has none. Every id asked gets an answer. */
export const machineBanks = async (
  machineIds: readonly (Types.ObjectId | string)[],
): Promise<Map<string, MachineBank>> => {
  const rows = await registerRowsByMachine(machineIds);
  return new Map(machineIds.map((id) => [String(id), bankOfEntries(rows.get(String(id)) ?? [])]));
};

/**
 * The bank's machines in a branch: the machines its open entries there name, re-checked with
 * `machineBanks` — a machine with a second open entry of another bank drops out (GS-25).
 */
export const bankMachineIds = async (
  branchId: Types.ObjectId | string,
  bankCode: AtmBankCode,
): Promise<string[]> => {
  const named = new Set<string>();
  for (const row of await registerBankRows({ branchId, bankCode })) {
    if (row.machineId !== null) named.add(String(row.machineId));
  }
  const banks = await machineBanks([...named]);
  return [...named].filter((id) => banks.get(id)?.bank === bankCode);
};
