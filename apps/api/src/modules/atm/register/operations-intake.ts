// A machine added on /atm/data-edit lands in the register (DEC-36). The owner's call (final): the
// add is recorded as an OPEN receipt dated the add day, linked to the machine and flagged
// «بيانات ناقصة» (DEC-37) for Efficiency to complete — so the machine counts in the Data Report and
// gives the settlements a bank from day one, instead of being refused there as `noRegisterBank`.
//
// The add stays Operations' write (`atmMachine.manage`, D2): the entry is its SIDE EFFECT, the
// mirror of a register receipt writing the master under register keys (register-coupling.ts). So
// no register key is checked, and nothing a register key guards is written — no K or S field
// (DEC-7 does not apply), no field beyond what the add form itself carries.
//
// ONE `unitOfWork` per machine, the decision table in order (spec DEC-36):
//   a. an OPEN entry of the code in ANOTHER branch (a null branch and DEC-11 pairs count) → 409
//      `ATM_REGISTER_OPEN_PERIOD_EXISTS`, nothing written. D6 is company-wide, so unmapped branches
//      too;
//   b. `coupleReceipt` — the register's own receipt path, reused UNCHANGED: a code ACTIVE elsewhere
//      → 409 `ATM_REGISTER_CODE_ACTIVE_ELSEWHERE` (data-edit can no longer break the mail matcher,
//      DEC-9); an archived master here is reactivated with the form's name, area and bank; else a
//      new master. `link` only comes from a race with another add (the caller checked) → 409;
//   c. the branch has no `EGYCASH-n` code (DEC-10), or the code is a placeholder → the machine is
//      committed and works, and the register records nothing (`none`);
//   d. open entries of the code in THIS branch (DEC-24 archived-while-open, an unlinked imported
//      row, one linked to a deleted master): one linked to this master → `existing`; else every one
//      unlinked or pointing at a master no longer live is linked → `linked`. The entry's data wins:
//      its fields and flag are untouched, and no bank is needed;
//   e. the newest PENDING entry of (branch, code) is received → `received` (critic gap 5: a later
//      receipt would otherwise leave it behind as a duplicate);
//   f. a new OPEN entry → `created`, when the bank text resolved to a catalog bank; else `noBank`.
// A race on `ux_open_period_per_code` rolls the WHOLE unit back — master included — as a 409 with
// the same code; a retry lands in step a. Audits are recorded once, after commit (the
// register.service pattern: `withTransaction` may run the callback twice).
import {
  ErrorCodes,
  type AtmBankCode,
  type AtmMachineRegisterOutcomeDto,
  type AtmMachineRegisterReason,
  type ErrorCode,
} from '@ecms/contracts';
import { Types, type ClientSession } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { ConflictError, ValidationError } from '../../../shared/errors';
import { type AuthContext } from '../../../shared/types';
import { resolveBankOfLabel, type AtmBankCatalog } from '../catalogs/bank-catalog';
import { type AtmBankDoc } from '../catalogs/bank.model';
import { AtmMachineModel, type AtmMachineDoc } from '../machines/machine.model';
import { cairoDateString } from '../shared/cairo-time';
import {
  coupleReceipt,
  isCouplingRefusal,
  isPlaceholderMachineCode,
  type PendingAudit,
} from './register-coupling';
import { REGISTER_CASSETTE_FIELDS, REGISTER_KEY_FIELDS } from './register.mapper';
import { type AtmRegisterEntryDoc } from './register.model';
import { atmRegisterEntryRepository } from './register.repository';
import { describeBranch } from './register-refusals';
import { redactedDiff } from './register-secrets';
import { type RegisterSettings } from './register-settings';
import { entrySnapshot } from './register.service';

/** Why an add was refused outright — nothing was written for it. */
export type IntakeRefusalReason = 'openElsewhere' | 'activeElsewhere' | 'activeHere';

/** A 409 the bulk add reads as a per-row outcome, and the single add returns as it is. */
export class IntakeRefusal extends ConflictError {
  constructor(
    readonly reason: IntakeRefusalReason,
    message: string,
    code: ErrorCode = ErrorCodes.DUPLICATE,
  ) {
    super(message, code);
  }
}

export interface OperationsIntakeInput {
  branchId: string;
  /** Normalized. */
  machineCode: string;
  name: string;
  area: string;
  /** The Operations bank text, stored verbatim on the master. */
  bankName: string;
  /** The catalog bank it resolved to (`resolveIntakeBank`); null = none. */
  bank: AtmBankDoc | null;
}

export interface OperationsIntakeResult {
  machine: AtmMachineDoc;
  /** The code was archived in this branch and the add brought it back with the form's data. */
  reactivated: boolean;
  register: AtmMachineRegisterOutcomeDto;
}

/**
 * The add's bank: the catalog first, then the branch's mapped spelling (`resolveBankOfLabel`). An
 * ARCHIVED bank is refused (400 `body.bankName INACTIVE`) — archiving stops new machines on it —
 * while a text that maps to no bank adds the machine all the same (`noBank`): refusing it would
 * block Operations over a spelling nobody has linked yet.
 */
export const resolveIntakeBank = async (
  branchId: string,
  bankName: string,
  catalog: AtmBankCatalog,
): Promise<AtmBankDoc | null> => {
  const bank = await resolveBankOfLabel(branchId, bankName, catalog);
  if (bank !== null && !bank.isActive) {
    throw new ValidationError([
      { field: 'body.bankName', code: 'INACTIVE', message: 'this bank is archived' },
    ]);
  }
  return bank;
};

// ── The decision table, pure ────────────────────────────────────────────────────────────────────

type OpenRow = Pick<AtmRegisterEntryDoc, '_id' | 'branchId' | 'machineId'>;

/** Step a: an open entry of the code held by ANOTHER branch — no branch at all counts as another. */
export const openElsewhereOf = <T extends Pick<OpenRow, 'branchId'>>(
  open: readonly T[],
  branchId: string,
): T | null =>
  open.find((row) => row.branchId === null || String(row.branchId) !== branchId) ?? null;

/** What steps c–f decided for the register, once the master is known. */
export type IntakeRegisterPlan =
  | { action: 'none'; reason: AtmMachineRegisterReason }
  | { action: 'existing'; entryId: Types.ObjectId }
  | { action: 'linked'; entryIds: Types.ObjectId[] }
  | { action: 'received'; entryId: Types.ObjectId; bankCode: AtmBankCode }
  | { action: 'created'; bankCode: AtmBankCode };

/**
 * Pure: steps c–f. `openHere` are the code's open entries (all in this branch, after step a);
 * `liveMasterIds` the ids among their masters that are still live; `pending` the newest pending
 * entry of (branch, code), read only when there is no open one.
 */
export const planIntakeRegister = (input: {
  mapped: boolean;
  placeholder: boolean;
  machineId: Types.ObjectId | string;
  openHere: readonly Pick<OpenRow, '_id' | 'machineId'>[];
  liveMasterIds: ReadonlySet<string>;
  pending: Pick<AtmRegisterEntryDoc, '_id' | 'bankCode'> | null;
  bankCode: AtmBankCode | null;
}): IntakeRegisterPlan => {
  if (!input.mapped) return { action: 'none', reason: 'branchUnmapped' };
  if (input.placeholder) return { action: 'none', reason: 'placeholderCode' };
  const machineId = String(input.machineId);
  if (input.openHere.length > 0) {
    const own = input.openHere.find((row) => String(row.machineId) === machineId);
    if (own !== undefined) return { action: 'existing', entryId: own._id };
    const relink = input.openHere.filter(
      (row) => row.machineId === null || !input.liveMasterIds.has(String(row.machineId)),
    );
    if (relink.length > 0) return { action: 'linked', entryIds: relink.map((row) => row._id) };
    // Every open entry here holds ANOTHER live master — no state a write path produces (a branch's
    // live master of a code is unique). Nothing is stolen from it; the entry stands as it is.
    const [first] = input.openHere;
    if (first !== undefined) return { action: 'existing', entryId: first._id };
  }
  if (input.pending !== null) {
    const bankCode = input.pending.bankCode ?? input.bankCode;
    return bankCode === null
      ? { action: 'none', reason: 'noBank' }
      : { action: 'received', entryId: input.pending._id, bankCode };
  }
  return input.bankCode === null
    ? { action: 'none', reason: 'noBank' }
    : { action: 'created', bankCode: input.bankCode };
};

/**
 * Pure: the override an intake entry records — null when the text IS the bank's catalog label (the
 * entry then follows the catalog, D5), else the text (`NBE FOREX`, a former label …), so the entry's
 * effective label is exactly what the master carries.
 */
export const intakeOpsBankLabel = (
  bankName: string,
  bankCode: AtmBankCode,
  catalog: Pick<AtmBankCatalog, 'opsLabel'>,
): string | null => (bankName === catalog.opsLabel(bankCode) ? null : bankName);

/** `YYYY-MM-DD` → the UTC-midnight Date the register stores. */
const businessDate = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/**
 * Pure: step e's write — the pending entry becomes OPEN on the add day, linked and flagged; only a
 * null area, bank or name is filled from the form (the entry's own data wins). The override follows
 * the form only where the bank came from it.
 */
export const intakeReceiptFill = (
  pending: Pick<AtmRegisterEntryDoc, 'area' | 'bankCode' | 'name' | 'opsBankLabel'>,
  input: Pick<OperationsIntakeInput, 'area' | 'name' | 'bankName'> & { bank: AtmBankCode | null },
  machineId: Types.ObjectId,
  today: string,
  catalog: Pick<AtmBankCatalog, 'opsLabel'>,
): Record<string, unknown> => {
  const bankCode = pending.bankCode ?? input.bank;
  return {
    startDate: businessDate(today),
    status: 'open',
    machineId,
    dataIncomplete: true,
    area: pending.area ?? input.area,
    bankCode,
    name: pending.name ?? input.name,
    ...(pending.opsBankLabel === null && bankCode !== null && bankCode === input.bank
      ? { opsBankLabel: intakeOpsBankLabel(input.bankName, bankCode, catalog) }
      : {}),
  };
};

/** Pure: step f's entry — what the add form knows, every other field empty. */
export const intakeEntryFields = (
  input: Pick<OperationsIntakeInput, 'branchId' | 'machineCode' | 'name' | 'area' | 'bankName'>,
  bankCode: AtmBankCode,
  machineId: Types.ObjectId,
  today: string,
  catalog: Pick<AtmBankCatalog, 'opsLabel'>,
): Partial<AtmRegisterEntryDoc> => ({
  branchId: new Types.ObjectId(input.branchId),
  area: input.area,
  bankCode,
  opsBankLabel: intakeOpsBankLabel(input.bankName, bankCode, catalog),
  machineCode: input.machineCode,
  machineId,
  name: input.name,
  operationType: null,
  vendor: null,
  model: null,
  serial: null,
  keys: Object.fromEntries(
    REGISTER_KEY_FIELDS.map((field) => [field, null]),
  ) as unknown as AtmRegisterEntryDoc['keys'],
  cassettes: Object.fromEntries(
    REGISTER_CASSETTE_FIELDS.map((field) => [field, null]),
  ) as unknown as AtmRegisterEntryDoc['cassettes'],
  openTime: null,
  closeTime: null,
  accessHoursNotes: null,
  receiptNotes: null,
  safeCombination: null,
  locationPlusCode: null,
  locationUrl: null,
  hub: null,
  startDate: businessDate(today),
  endDate: null,
  receivedByName: null,
  handoverName: null,
  handoverNotes: null,
  status: 'open',
  openPeriodExempt: false,
  source: 'operations',
  dataIncomplete: true,
  importRunId: null,
  importRow: null,
  importIssues: [],
  legacyMarks: null,
});

// ── The unit ────────────────────────────────────────────────────────────────────────────────────

const entryRef = (id: string) => ({
  moduleId: 'atm',
  entityType: 'registerEntry',
  entityId: id,
});

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/**
 * The other branch, named only where the caller could see it: by the page's own key
 * (`atmMachine.view`) or the register's — never more than either page shows (review finding F-9).
 */
const whereIs = (
  ctx: AuthContext,
  branchId: Types.ObjectId | string | null | undefined,
  settings: Pick<RegisterSettings, 'codeByBranchId'>,
): string => {
  const byMachines = describeBranch(ctx, branchId, settings, 'atmMachine.view');
  return byMachines === 'another branch'
    ? describeBranch(ctx, branchId, settings, 'atmRegister.view')
    : byMachines;
};

const openElsewhere = (code: string, where: string): IntakeRefusal =>
  new IntakeRefusal(
    'openElsewhere',
    `machine ${code} already has an open period in ${where}`,
    ErrorCodes.ATM_REGISTER_OPEN_PERIOD_EXISTS,
  );

/** The live masters among some ids, inside the session. */
const liveMasterIdsOf = async (
  ids: readonly Types.ObjectId[],
  session: ClientSession,
): Promise<Set<string>> => {
  if (ids.length === 0) return new Set();
  const rows = await AtmMachineModel.find({ _id: { $in: [...ids] }, isDeleted: false }, { _id: 1 })
    .session(session)
    .lean<{ _id: Types.ObjectId }[]>()
    .exec();
  return new Set(rows.map((row) => String(row._id)));
};

/**
 * One data-edit add, master and register together (the table above). Throws `IntakeRefusal` (409)
 * for a code held elsewhere or a racing add here; the caller has already refused a code ACTIVE in
 * this branch and resolved the bank (`resolveIntakeBank`). Area labels are the caller's, after.
 */
export const recordOperationsIntake = async (
  input: OperationsIntakeInput,
  ctx: AuthContext,
  settings: RegisterSettings,
): Promise<OperationsIntakeResult> => {
  const code = input.machineCode;
  const placeholder = isPlaceholderMachineCode(code);
  const mapped = settings.codeByBranchId.has(input.branchId);
  const today = cairoDateString(new Date());
  const bankCode = input.bank?.code ?? null;

  const { result, audits } = await unitOfWork(async (session) => {
    const audits: PendingAudit[] = [];
    // a — a placeholder is "no real code" (§6.3): one open period per code does not concern it.
    const open = placeholder ? [] : await atmRegisterEntryRepository.findOpenByCode(code, session);
    const other = openElsewhereOf(open, input.branchId);
    if (other !== null) throw openElsewhere(code, whereIs(ctx, other.branchId, settings));

    // b
    const coupled = await coupleReceipt(
      {
        branchId: input.branchId,
        machineCode: code,
        name: input.name,
        area: input.area,
        opsLabel: input.bankName,
      },
      ctx.userId,
      session,
    );
    if (isCouplingRefusal(coupled)) {
      if (coupled.refused === 'activeElsewhere') {
        throw new IntakeRefusal(
          'activeElsewhere',
          `machine ${code} is active in the Operations list of ${whereIs(ctx, coupled.otherBranchId, settings)}`,
          ErrorCodes.ATM_REGISTER_CODE_ACTIVE_ELSEWHERE,
        );
      }
      // `blankArea` / `noName` cannot happen: the add form requires both.
      const field = coupled.refused === 'blankArea' ? 'body.area' : 'body.name';
      throw new ValidationError([{ field, code: 'REQUIRED', message: 'required' }]);
    }
    if (coupled.action === 'link') {
      throw new IntakeRefusal('activeHere', 'ATM machine code already registered');
    }
    audits.push(...coupled.audits);
    const machineId = coupled.machineId;
    const machine = await AtmMachineModel.findOne({ _id: machineId })
      .session(session)
      .lean<AtmMachineDoc>()
      .exec();
    if (machine === null) throw new Error('the coupled master vanished inside its own transaction');

    // c–f
    const others = open.flatMap((row) =>
      row.machineId === null || String(row.machineId) === String(machineId) ? [] : [row.machineId],
    );
    const pending =
      mapped && !placeholder && open.length === 0
        ? await atmRegisterEntryRepository.findNewestPendingByCode(input.branchId, code, session)
        : null;
    const plan = planIntakeRegister({
      mapped,
      placeholder,
      machineId,
      openHere: open,
      liveMasterIds: await liveMasterIdsOf(others, session),
      pending,
      bankCode,
    });

    const outcome = (entryId: Types.ObjectId | null): AtmMachineRegisterOutcomeDto => ({
      action: plan.action,
      reason: plan.action === 'none' ? plan.reason : null,
      entryId: entryId === null ? null : String(entryId),
      bankCode,
    });
    const done = (entryId: Types.ObjectId | null) => ({
      result: { machine, reactivated: coupled.action === 'reactivate', register: outcome(entryId) },
      audits,
    });

    if (plan.action === 'none') return done(null);
    if (plan.action === 'existing') return done(plan.entryId);
    if (plan.action === 'linked') {
      for (const id of plan.entryIds) {
        const before = open.find((row) => String(row._id) === String(id));
        if (before === undefined) continue;
        const updated = await atmRegisterEntryRepository.updateById(
          String(id),
          { machineId },
          { by: ctx.userId, version: before.__v, session },
        );
        audits.push({
          entityRef: entryRef(String(id)),
          action: 'update',
          changes: redactedDiff(entrySnapshot(before), entrySnapshot(updated)),
        });
      }
      return done(plan.entryIds[0] ?? null);
    }
    if (plan.action === 'received') {
      // `planIntakeRegister` answers `received` only for the pending entry it was given.
      const before = pending as AtmRegisterEntryDoc;
      let updated: AtmRegisterEntryDoc;
      try {
        updated = await atmRegisterEntryRepository.updateById(
          String(before._id),
          intakeReceiptFill(
            before,
            { ...input, bank: bankCode },
            machineId,
            today,
            settings.catalog,
          ),
          { by: ctx.userId, version: before.__v, session },
        );
      } catch (error) {
        // The race-proof half of D6: an open period of this code committed meanwhile.
        if (isDuplicateKeyError(error)) throw openElsewhere(code, 'the register');
        throw error;
      }
      audits.push({
        entityRef: entryRef(String(before._id)),
        action: 'statusChange',
        changes: redactedDiff(entrySnapshot(before), entrySnapshot(updated)),
      });
      return done(before._id);
    }
    let entry: AtmRegisterEntryDoc;
    try {
      entry = await atmRegisterEntryRepository.create(
        intakeEntryFields(input, plan.bankCode, machineId, today, settings.catalog),
        { by: ctx.userId, session },
      );
    } catch (error) {
      // The repository reads `ux_open_period_per_code`'s E11000 as a ConflictError.
      if (error instanceof ConflictError || isDuplicateKeyError(error)) {
        throw openElsewhere(code, 'the register');
      }
      throw error;
    }
    audits.push({
      entityRef: entryRef(String(entry._id)),
      action: 'create',
      changes: redactedDiff({}, entrySnapshot(entry)),
    });
    return done(entry._id);
  });

  for (const audit of audits) await auditService.record(audit);
  return result;
};
