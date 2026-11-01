// The machine register — the owner's workbook sheet `ATMs`, one document per Excel row = one
// custody period, from the bank's receipt to the handover back (D1; spec
// docs/12-planning/atm-efficiency-register.md §5.1).
//
// Every text field is `{ type: String, default: null }` and NONE is `required` — `name` included.
// Mongoose's String required-validator rejects '' even when '' is the default (the zone /
// senderEmail lesson, machines/machine.model.ts), and an imported row keeps its blanks (D6,
// DEC-32): a required field would abort a whole 200-row import batch on the first blank cell.
// Manual writes get their non-empty name from Zod, which is where that rule belongs.
//
// No Mongoose validator (maxlength, enum, match) sits on a K or S field: a validation message can
// echo the value, and these values are key codes and the safe-door combination (D3). The
// combination itself is never stored in the clear — `safeCombination` is the secret store's
// opaque ref, bound to `atm_register_entries:<id>:safeCombination` (register-secrets.ts).
import { Schema, model, type Types } from 'mongoose';
import {
  ATM_REGISTER_SOURCES,
  ATM_REGISTER_STATUSES,
  type AtmBankCode,
  type AtmRegisterCassettesDto,
  type AtmRegisterKeysDto,
  type AtmRegisterSource,
  type AtmRegisterStatus,
  type SecretRef,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface AtmRegisterImportIssue {
  code: string;
  column: string | null;
  detail: string | null;
}

/** EG-2 — the workbook's manual fills, import-only, never in a DTO. */
export interface AtmRegisterLegacyMarks {
  /** Derived: B has a solid FFFF0000 fill. */
  areaRedFill: boolean;
  /** Derived: A's solid fill. */
  rowFill: string | null;
  /** EVERY non-default solid fill in A..AW (a colour is not a secret, so K/S columns count). */
  cellFills: { column: string; fill: string }[];
}

export interface AtmRegisterEntryDoc extends BaseDocFields {
  /** Null only for an imported row with a blank column A. Immutable (D4). */
  branchId: Types.ObjectId | null;
  area: string | null;
  /** A catalog code (DEC-35); the service checks it exists — and is active, for a new value. */
  bankCode: AtmBankCode | null;
  /** An explicit Operations bank label (e.g. `NBE FOREX`); null = the catalog bank's label (D5). */
  opsBankLabel: string | null;
  machineCode: string | null;
  /** The Operations master this period is coupled to (D2); null while unlinked (DEC-30). */
  machineId: Types.ObjectId | null;
  /** Null only on an imported blank (DEC-32). */
  name: string | null;
  operationType: string | null;
  vendor: string | null;
  model: string | null;
  serial: string | null;
  /** K — returned only where `atmRegister.viewSecrets` covers the entry. */
  keys: AtmRegisterKeysDto;
  cassettes: AtmRegisterCassettesDto;
  openTime: string | null;
  closeTime: string | null;
  accessHoursNotes: string | null;
  /** K. */
  receiptNotes: string | null;
  /** S — sealed (D3); NEVER plaintext, never mapped to a DTO. */
  safeCombination: SecretRef | null;
  locationPlusCode: string | null;
  locationUrl: string | null;
  hub: string | null;
  /** UTC midnight of the calendar day. */
  startDate: Date | null;
  endDate: Date | null;
  receivedByName: string | null;
  handoverName: string | null;
  /** K. */
  handoverNotes: string | null;
  /** Derived (`deriveAtmRegisterStatus`) on every write, never accepted as input (D1). */
  status: AtmRegisterStatus;
  /** DEC-11: both rows of an imported duplicate-open pair; excluded from the partial unique index. */
  openPeriodExempt: boolean;
  /** `operations` (DEC-36): recorded by the server when Operations added the machine on data-edit. */
  source: AtmRegisterSource;
  /**
   * DEC-37 «بيانات ناقصة» — a STORED flag, not derived from blank fields: most imported rows have
   * legitimate blanks (DEC-32), and key fields cannot be judged without `viewSecrets`. Set by the
   * data-edit intake, set or cleared by Efficiency, never cleared by the server on its own.
   */
  dataIncomplete: boolean;
  importRunId: Types.ObjectId | null;
  importRow: number | null;
  importIssues: AtmRegisterImportIssue[];
  legacyMarks: AtmRegisterLegacyMarks | null;
}

const nullableText = { type: String, default: null } as const;

const keysSchema = new Schema<AtmRegisterKeysDto>(
  {
    supervisorCode: nullableText,
    supervisorCount: nullableText,
    safeDoorCount: nullableText,
    alanki: nullableText,
    combinationKeyCode: nullableText,
    combinationKeyCount: nullableText,
    cashUnitCode: nullableText,
    cashUnitCount: nullableText,
  },
  { _id: false },
);

const cassettesSchema = new Schema<AtmRegisterCassettesDto>(
  {
    withdrawalType: nullableText,
    withdrawalCount: nullableText,
    withdrawal1: nullableText,
    withdrawal2: nullableText,
    withdrawal3: nullableText,
    withdrawal4: nullableText,
    withdrawal5: nullableText,
    depositType: nullableText,
    depositCount: nullableText,
    collectionCount: nullableText,
    recycle200: nullableText,
    recycle100: nullableText,
    recycle50: nullableText,
    spareCount: nullableText,
    spare1: nullableText,
    spare2: nullableText,
    spare3: nullableText,
    spare4: nullableText,
    spare5: nullableText,
  },
  { _id: false },
);

// The secret store's ref, copied from the credential precedent (automation/credentials/
// credential.model.ts) because ATM imports no other module: `provider` and `keyId` are queryable
// metadata the rotation sweep needs in the clear; `ref` is opaque to everyone but the store.
const secretRefSchema = new Schema(
  {
    provider: { type: String, required: true },
    keyId: { type: String, default: null },
    ref: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false },
);

const importIssueSchema = new Schema<AtmRegisterImportIssue>(
  {
    code: String,
    column: { type: String, default: null },
    detail: { type: String, default: null },
  },
  { _id: false },
);

const legacyMarksSchema = new Schema<AtmRegisterLegacyMarks>(
  {
    areaRedFill: Boolean,
    rowFill: { type: String, default: null },
    cellFills: [new Schema({ column: String, fill: String }, { _id: false })],
  },
  { _id: false },
);

const registerEntrySchema = new Schema<AtmRegisterEntryDoc>(
  {
    branchId: { type: Schema.Types.ObjectId, default: null },
    area: nullableText,
    bankCode: nullableText,
    opsBankLabel: nullableText,
    machineCode: nullableText,
    machineId: { type: Schema.Types.ObjectId, default: null },
    name: nullableText,
    operationType: nullableText,
    vendor: nullableText,
    model: nullableText,
    serial: nullableText,
    keys: { type: keysSchema, default: () => ({}) },
    cassettes: { type: cassettesSchema, default: () => ({}) },
    openTime: nullableText,
    closeTime: nullableText,
    accessHoursNotes: nullableText,
    receiptNotes: nullableText,
    safeCombination: { type: secretRefSchema, default: null },
    locationPlusCode: nullableText,
    locationUrl: nullableText,
    hub: nullableText,
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    receivedByName: nullableText,
    handoverName: nullableText,
    handoverNotes: nullableText,
    status: { type: String, required: true, enum: ATM_REGISTER_STATUSES },
    openPeriodExempt: { type: Boolean, required: true, default: false },
    source: { type: String, required: true, enum: ATM_REGISTER_SOURCES },
    // Absent on every row written before DEC-37; the mapper and the filter read that as false.
    dataIncomplete: { type: Boolean, required: true, default: false },
    importRunId: { type: Schema.Types.ObjectId, default: null },
    importRow: { type: Number, default: null },
    importIssues: { type: [importIssueSchema], default: [] },
    legacyMarks: { type: legacyMarksSchema, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// Exact names — `atm-indexes.ts` builds these at boot (DEC-26) and the import relies on them.
//
// D6: one OPEN period per machine code, company-wide — the mail matcher needs exactly one active
// machine per code (mail-tickets/mail-ingestion.service.ts). An imported duplicate-open pair is
// exempt (DEC-11); the service check is not, so neither of those codes can be received again
// while either row is open.
registerEntrySchema.index(
  { machineCode: 1 },
  {
    unique: true,
    name: 'ux_open_period_per_code',
    partialFilterExpression: {
      status: 'open',
      isDeleted: false,
      openPeriodExempt: false,
      machineCode: { $type: 'string' },
    },
  },
);
// The Data Report's one $group (register-report.service.ts).
registerEntrySchema.index(
  { branchId: 1, status: 1, bankCode: 1 },
  { name: 'ix_branch_status_bank' },
);
registerEntrySchema.index({ machineCode: 1, status: 1 }, { name: 'ix_code_status' });
// DEC-37: the «بيانات ناقصة فقط» filter. Partial — only flagged rows are indexed, and they are few:
// the ~3,500 imported rows never carry the flag.
registerEntrySchema.index(
  { branchId: 1, dataIncomplete: 1 },
  { name: 'ix_incomplete', partialFilterExpression: { dataIncomplete: true } },
);
registerEntrySchema.index({ branchId: 1, machineCode: 1 }, { name: 'ix_branch_code' });
// Coupling: "does another open entry still hold this master?" (register-coupling.ts).
registerEntrySchema.index({ machineId: 1, status: 1 }, { name: 'ix_machine_status' });
// D8 idempotency: an Excel row is imported once.
registerEntrySchema.index(
  { importRow: 1 },
  {
    unique: true,
    name: 'ux_import_row',
    partialFilterExpression: { importRow: { $type: 'number' } },
  },
);
// The rotation sweep (DEC-33): "every combination not on the current key".
registerEntrySchema.index(
  { 'safeCombination.keyId': 1 },
  { name: 'ix_combination_keyId', sparse: true },
);

export const AtmRegisterEntryModel = model<AtmRegisterEntryDoc>(
  'AtmRegisterEntry',
  registerEntrySchema,
  'atm_register_entries',
);
