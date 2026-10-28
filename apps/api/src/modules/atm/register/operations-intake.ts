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
//      DEC-9); an archived master here is reactivated, else a new master is written. Name and area
//      come from the form (DEC-36(b); DEC-8 tolerates a master/entry difference there). The BANK
//      comes from the entry steps d/e will couple it to, when that entry has one (D5/DEC-8: a
//      coupling keeps the bank label one fact on both rows — `intakeMasterLabel`), else from the
//      form. `link` only comes from a race with another add (the caller checked) → 409;
//   c. no register code resolves to the branch (DEC-10 — a code mapped to a branch linked to work
//      as it counts, `atm.branchLinks`), or the code is a placeholder → the machine is committed
//      and works, and the register records nothing (`none`);
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
//
// The add is undone with it: deleting the machine on data-edit (how a mistyped code is fixed) also
// removes the stub step f wrote, while it is still UNTOUCHED (`removeUntouchedIntakeStubs`) — so an
// add followed by a delete leaves nothing in the register, as before DEC-36. Anything Efficiency
// touched, received or linked stays.
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
import { AtmRegisterEntryModel, type AtmRegisterEntryDoc } from './register.model';
import { atmRegisterEntryRepository } from './register.repository';
import { describeBranch } from './register-refusals';
import { redactedDiff } from './register-secrets';
import { effectiveOpsLabel, type RegisterSettings } from './register-settings';
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

/** Stands in for the master's id where only the fill's LABEL is wanted (`intakeMasterLabel`). */
const NO_MACHINE = new Types.ObjectId('000000000000000000000000');

/**
 * Pure: the bank label the coupled master is written with (step b). When step d or e will couple
 * the master to an entry that already exists, that entry's bank wins — every coupling path of the
 * register writes the master FROM the entry's label (create, reactivate, receive-pending; link copies
 * the master's onto the entry), so Operations and the register never disagree about a machine's bank
 * (D5, DEC-8). Without this the master took the form's text while the received pending entry kept
 * its own bank: the Data Report and the settlements read CIB, the boards and the mail matcher NBE.
 *
 *   · step e — the label the RECEIVED entry will carry, override included, computed through the
 *     same `intakeReceiptFill` that writes it (so a form «NBE FOREX» on a bank-less pending entry
 *     still reaches the master as «NBE FOREX»);
 *   · step d — the open entries' effective label when they all agree on one;
 *   · otherwise (no such entry, no bank on it, entries that disagree, an unmapped branch or a
 *     placeholder code — steps c and f) — the form's text, exactly what Operations typed.
 */
export const intakeMasterLabel = (input: {
  mapped: boolean;
  placeholder: boolean;
  openHere: readonly Pick<AtmRegisterEntryDoc, 'bankCode' | 'opsBankLabel'>[];
  pending: Pick<AtmRegisterEntryDoc, 'area' | 'bankCode' | 'name' | 'opsBankLabel'> | null;
  form: Pick<OperationsIntakeInput, 'area' | 'name' | 'bankName'> & { bank: AtmBankCode | null };
  today: string;
  catalog: Pick<AtmBankCatalog, 'opsLabel'>;
}): string => {
  const fromEntry = ((): string | null => {
    if (!input.mapped || input.placeholder) return null;
    if (input.openHere.length > 0) {
      const labels = new Set(input.openHere.map((row) => effectiveOpsLabel(row, input.catalog)));
      const [only] = [...labels];
      return labels.size === 1 ? (only ?? null) : null;
    }
    if (input.pending === null) return null;
    const received = {
      ...input.pending,
      ...intakeReceiptFill(input.pending, input.form, NO_MACHINE, input.today, input.catalog),
    } as Pick<AtmRegisterEntryDoc, 'bankCode' | 'opsBankLabel'>;
    return effectiveOpsLabel(received, input.catalog);
  })();
  return fromEntry ?? input.form.bankName;
};

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
const whereIs = async (
  ctx: AuthContext,
  branchId: Types.ObjectId | string | null | undefined,
  settings: Pick<RegisterSettings, 'resolveBranch'>,
): Promise<string> => {
  const byMachines = await describeBranch(ctx, branchId, settings, 'atmMachine.view');
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
  const mapped = settings.isMapped(input.branchId);
  const today = cairoDateString(new Date());
  const bankCode = input.bank?.code ?? null;

  const { result, audits } = await unitOfWork(async (session) => {
    const audits: PendingAudit[] = [];
    // a — a placeholder is "no real code" (§6.3): one open period per code does not concern it.
    const open = placeholder ? [] : await atmRegisterEntryRepository.findOpenByCode(code, session);
    const other = openElsewhereOf(open, input.branchId);
    if (other !== null) throw openElsewhere(code, await whereIs(ctx, other.branchId, settings));

    // Read before b: the bank the master takes depends on the entry d/e will couple it to.
    const pending =
      mapped && !placeholder && open.length === 0
        ? await atmRegisterEntryRepository.findNewestPendingByCode(input.branchId, code, session)
        : null;

    // b
    const coupled = await coupleReceipt(
      {
        branchId: input.branchId,
        machineCode: code,
        name: input.name,
        area: input.area,
        opsLabel: intakeMasterLabel({
          mapped,
          placeholder,
          openHere: open,
          pending,
          form: { ...input, bank: bankCode },
          today,
          catalog: settings.catalog,
        }),
      },
      ctx.userId,
      session,
    );
    if (isCouplingRefusal(coupled)) {
      if (coupled.refused === 'activeElsewhere') {
        throw new IntakeRefusal(
          'activeElsewhere',
          `machine ${code} is active in the Operations list of ${await whereIs(ctx, coupled.otherBranchId, settings)}`,
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

// ── Undoing an add ──────────────────────────────────────────────────────────────────────────────

/**
 * Whether an open entry is still the untouched stub a data-edit add wrote for this master: written
 * by the intake (`source: 'operations'`, step f), still flagged, never written since (`__v` 0 — any
 * edit, area move or handover bumps it), linked to this master and filed in its branch. A RECEIVED
 * pending entry (step e) is `manual` and already written, a LINKED one (step d) is the register's —
 * both belong to Efficiency and are never matched.
 */
export const isUntouchedIntakeStub = (
  entry: Pick<
    AtmRegisterEntryDoc,
    'source' | 'dataIncomplete' | '__v' | 'machineId' | 'branchId' | 'status' | 'isDeleted'
  >,
  master: Pick<AtmMachineDoc, '_id' | 'branchId'>,
): boolean =>
  entry.source === 'operations' &&
  entry.dataIncomplete === true &&
  entry.__v === 0 &&
  entry.status === 'open' &&
  !entry.isDeleted &&
  entry.machineId !== null &&
  String(entry.machineId) === String(master._id) &&
  entry.branchId !== null &&
  String(entry.branchId) === String(master.branchId);

/**
 * The register half of deleting a data-edit machine (the documented fix for a mistyped code: delete,
 * then add again). Before DEC-36 an add followed by a delete left nothing behind; since every add
 * writes an open entry, the stub would otherwise outlive its master — still counted in the Data
 * Report and holding the code's one company-wide open period (D6), so a correct add of that code in
 * any other branch is refused until Efficiency happens to find and delete it. So the delete takes
 * the stub with it, in the caller's transaction.
 *
 * Only an UNTOUCHED stub (`isUntouchedIntakeStub`). Every other open entry on the master stays as it
 * is and the delete is never refused: manage actions on a master with an open entry stay allowed
 * (DEC-24), and the entry then shows `masterState: 'deleted'`. The write repeats the `__v: 0`
 * condition, so an entry Efficiency edits between the read and the write is skipped, not deleted.
 * `archiveIfLastOpen` is not called: the master is being deleted, not archived. Returns the audits
 * owed, for after commit.
 */
export const removeUntouchedIntakeStubs = async (
  master: Pick<AtmMachineDoc, '_id' | 'branchId'>,
  actorId: string,
  session: ClientSession,
): Promise<PendingAudit[]> => {
  const open = await atmRegisterEntryRepository.findOpenForMachine(master._id, session);
  const audits: PendingAudit[] = [];
  const by = new Types.ObjectId(actorId);
  for (const entry of open) {
    if (!isUntouchedIntakeStub(entry, master)) continue;
    const written = await AtmRegisterEntryModel.updateOne(
      {
        _id: entry._id,
        __v: 0,
        isDeleted: false,
        status: 'open',
        source: 'operations',
        dataIncomplete: true,
        machineId: master._id,
      },
      {
        $set: { isDeleted: true, deletedAt: new Date(), deletedBy: by, updatedBy: by },
        $inc: { __v: 1 },
      },
      { session },
    ).exec();
    if (written.modifiedCount !== 1) continue;
    audits.push({
      entityRef: entryRef(String(entry._id)),
      action: 'delete',
      changes: redactedDiff(entrySnapshot(entry), {}),
    });
  }
  return audits;
};
