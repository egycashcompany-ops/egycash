// The append-only leave ledger (frozen design §4) — the TRUTH for every balance movement.
// Unique keys make request-driven and scheduler/migration writes idempotent; `paidBreakdown`
// on consumption entries is the frozen Payroll read contract (R7). Never updated, never
// deleted; the balance cache is rebuilt FROM this collection.
import { Schema, type Types, model } from 'mongoose';
import { type LeaveLedgerKind, type LeavePaidBreakdownDto } from '@ecms/contracts';

export interface LeaveLedgerDoc {
  _id: Types.ObjectId;
  employeeId: Types.ObjectId;
  /** What the absence was (reporting). */
  typeId: Types.ObjectId;
  /** Whose balance it hits (accounting, R11); null = untracked consumption. */
  balanceTypeId: Types.ObjectId | null;
  year: number;
  kind: LeaveLedgerKind;
  /** Signed; half-day granularity. Positive adds to availability for grant/carryover/release/adjust(+). */
  days: number;
  requestId: Types.ObjectId | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  paidBreakdown: LeavePaidBreakdownDto[];
  note: string | null;
  by: Types.ObjectId | null;
  createdAt: Date;
}

const ledgerSchema = new Schema<LeaveLedgerDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    typeId: { type: Schema.Types.ObjectId, required: true },
    balanceTypeId: { type: Schema.Types.ObjectId, default: null },
    year: { type: Number, required: true },
    kind: { type: String, required: true },
    days: { type: Number, required: true },
    requestId: { type: Schema.Types.ObjectId, default: null },
    effectiveFrom: { type: Date, default: null },
    effectiveTo: { type: Date, default: null },
    paidBreakdown: {
      type: [new Schema({ days: Number, payRate: Number }, { _id: false })],
      default: [],
    },
    note: { type: String, default: null },
    by: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

// Request-driven entries: at most one per (request, kind, year) — year-boundary splits are
// separate entries; re-running a scheduler step is a no-op duplicate.
ledgerSchema.index(
  { requestId: 1, kind: 1, year: 1 },
  { unique: true, name: 'ux_request_kind_year', partialFilterExpression: { requestId: { $type: 'objectId' } } },
);
// One grant and one carryover per (employee, balance type, year) — boot/yearEnd idempotency.
ledgerSchema.index(
  { employeeId: 1, balanceTypeId: 1, year: 1, kind: 1 },
  {
    unique: true,
    name: 'ux_employee_type_year_grantlike',
    partialFilterExpression: { kind: { $in: ['grant', 'carryover'] } },
  },
);
ledgerSchema.index({ employeeId: 1, typeId: 1, year: 1, createdAt: 1 }, { name: 'ix_employee_type_year' });

export const LeaveLedgerModel = model<LeaveLedgerDoc>('LeaveLedger', ledgerSchema, 'hr_leave_ledger');
