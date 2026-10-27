// One applied Full list import (docs/12-planning/atm-settlements-phase1.md §4.8, §5.4).
//
// A run row exists only for an APPLY; a preview writes nothing. It stores COUNTS ONLY — no code, no
// value and no row content (the register import's rule, `register/import/register-import.service.ts`).
// `ux_one_running` is the lock: one running apply per branch × bank (the register's precedent,
// `register/import/register-import-run.model.ts`); a run left `running` past `STALE_RUN_MS` is taken
// over (`abandoned`) by the next apply.
import { Schema, model, type Types } from 'mongoose';
import { ATM_BANK_CODES, ATM_LAYOUT_IMPORT_MODES, type AtmBankCode } from '@ecms/contracts';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';

export type AtmLayoutImportRunState = 'running' | 'done' | 'failed' | 'abandoned';

export interface AtmLayoutImportRunDoc extends BaseDocFields {
  branchId: Types.ObjectId;
  bankCode: AtmBankCode;
  /** ≤ 200. */
  fileName: string;
  fileSha256: string;
  state: AtmLayoutImportRunState;
  startedAt: Date;
  finishedAt: Date | null;
  mode: 'newOnly' | 'newAndChanged' | 'overwriteManual';
  standardLoads: boolean;
  /** Per outcome, plus `created`, `updated`, `conflicts`, `standardLoadsCreated`. */
  counts: Record<string, number>;
  actorName: string | null;
  /** The error's name only — never a message that could quote a cell. */
  error: string | null;
}

const layoutImportRunSchema = new Schema<AtmLayoutImportRunDoc>(
  {
    branchId: { type: Schema.Types.ObjectId, required: true },
    bankCode: { type: String, required: true, enum: ATM_BANK_CODES },
    fileName: { type: String, required: true, maxlength: 200 },
    fileSha256: { type: String, required: true, match: /^[0-9a-f]{64}$/ },
    state: { type: String, required: true, enum: ['running', 'done', 'failed', 'abandoned'] },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    mode: { type: String, required: true, enum: ATM_LAYOUT_IMPORT_MODES },
    standardLoads: { type: Boolean, required: true },
    counts: { type: Schema.Types.Mixed, default: {} },
    actorName: { type: String, default: null },
    error: { type: String, default: null },
    ...baseFields,
  },
  { ...baseSchemaOptions, minimize: false },
);

layoutImportRunSchema.index(
  { branchId: 1, bankCode: 1 },
  { unique: true, name: 'ux_one_running', partialFilterExpression: { state: 'running' } },
);
layoutImportRunSchema.index(
  { branchId: 1, bankCode: 1, createdAt: -1 },
  { name: 'ix_branch_bank_created' },
);

export const AtmLayoutImportRunModel = model<AtmLayoutImportRunDoc>(
  'AtmLayoutImportRun',
  layoutImportRunSchema,
  'atm_layout_import_runs',
);
