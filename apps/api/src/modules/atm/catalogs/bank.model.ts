// The company-wide bank catalog — `atm_banks` (DEC-35; docs/12-planning/atm-efficiency-register.md
// D5 as amended).
//
// The owner's call (final): a bank added at runtime is a FULL register bank — it appears in the
// register, the Data Report, settlements and the map. So the register's fixed six-code enum became
// this collection, seeded with the workbook's six (`catalog.migration.ts`). It is OWNED BY ATM, like
// `atm_ref_labels` (port doc D1): ATM writes no other module's collection, and the operations bank
// catalog is a different list with a different administrator.
//
// `code` is never changed after creation and never reused (there is no DELETE — `isActive: false`
// archives): it is the key stored on register entries, plans, plan lines, preparations, standard
// loads, layout-import runs, the note-counter key `atm-note:<branch>:<bank>`, URLs (`?bank=`) and
// report keys (`s1.NBE`).
//
// `opsLabel` is the ONE text a receipt writes on `atm_machines.bankName` when it creates or
// reactivates a master. `formerOpsLabels` keeps every label the bank had, because machines keep the
// text they were given and must still resolve to their bank. `opsLabelKeys` is both, trimmed and
// upper-cased, behind a UNIQUE multikey index — so a machine's bank text can never mean two banks
// (critic gap 6). The service recomputes it on every write; the API never sets it.
//
// The ID formats and the sheet's report orders stay in code (contracts): a regex typed by a user
// would run on every register write — a ReDoS risk, and a regex editor, for what is only a warning.
import { Schema, model } from 'mongoose';
import {
  ATM_BANK_CODE_PATTERN,
  ATM_BANK_COLOR_PATTERN,
  type LocalizedString,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface AtmBankDoc extends BaseDocFields {
  code: string;
  name: LocalizedString;
  opsLabel: string;
  formerOpsLabels: string[];
  /** System-managed: `[opsLabel, ...formerOpsLabels]`, each `atmBankLabelKey`'d, distinct. */
  opsLabelKeys: string[];
  color: string;
  sortOrder: number;
  isActive: boolean;
  /** One of the workbook's six: always shown in the Data Report, as in the sheet. */
  isSeed: boolean;
}

const nameSchema = new Schema<LocalizedString>(
  {
    ar: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
    en: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
  },
  { _id: false },
);

const bankSchema = new Schema<AtmBankDoc>(
  {
    code: { type: String, required: true, match: ATM_BANK_CODE_PATTERN },
    name: { type: nameSchema, required: true },
    opsLabel: { type: String, required: true, trim: true, minlength: 1, maxlength: 64 },
    formerOpsLabels: { type: [String], default: [] },
    opsLabelKeys: { type: [String], default: [] },
    color: { type: String, required: true, match: ATM_BANK_COLOR_PATTERN },
    sortOrder: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, required: true, default: true },
    isSeed: { type: Boolean, required: true, default: false },
    ...baseFields,
  },
  baseSchemaOptions,
);

// Exact names — `atm-indexes.ts` builds them at boot (DEC-26), before the seed writes.
//
// Not partial on `isDeleted`: nothing is ever deleted, and a code is never reused (it keys data
// stored all over ATM), so even a hypothetically deleted row keeps its code.
bankSchema.index({ code: 1 }, { unique: true, name: 'ux_bank_code' });
// Multikey: no two banks may share any current or former label key. Partial on live rows only, the
// ref-label precedent; an ARCHIVED bank keeps its keys — its machines still carry its labels.
bankSchema.index(
  { opsLabelKeys: 1 },
  {
    unique: true,
    name: 'ux_bank_ops_label_keys',
    partialFilterExpression: { isDeleted: false },
  },
);

export const AtmBankModel = model<AtmBankDoc>('AtmBank', bankSchema, 'atm_banks');
