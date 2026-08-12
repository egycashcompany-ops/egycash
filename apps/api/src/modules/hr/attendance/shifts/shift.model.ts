// Shift catalog (frozen design v1.1 §2, D2) — the "meant to be" patterns. Admin-managed and
// seeded exactly like leave types: a shift deactivates, never hard-deletes, because assignments
// and day records reference it forever. Times are Cairo wall-clock strings; the date they bind
// to is decided per day by the engine (D3: a night shift's day is its START date).
import { Schema, model } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface ShiftDoc extends BaseDocFields {
  code: string;
  name: LocalizedString;
  /** `HH:mm` Cairo wall-clock. */
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  breakMinutes: number;
  graceInMinutes: number;
  graceOutMinutes: number;
  /** Config carried for downstream half/full-day interpretation; the v1 engine records minutes only. */
  minMinutesForFullDay: number;
  minMinutesForHalfDay: number;
  active: boolean;
  sortOrder: number;
}

const shiftSchema = new Schema<ShiftDoc>(
  {
    code: { type: String, required: true, trim: true },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    crossesMidnight: { type: Boolean, required: true, default: false },
    breakMinutes: { type: Number, required: true, default: 0 },
    graceInMinutes: { type: Number, required: true, default: 0 },
    graceOutMinutes: { type: Number, required: true, default: 0 },
    minMinutesForFullDay: { type: Number, required: true, default: 0 },
    minMinutesForHalfDay: { type: Number, required: true, default: 0 },
    active: { type: Boolean, required: true, default: true },
    sortOrder: { type: Number, required: true, default: 0 },
    ...baseFields,
  },
  baseSchemaOptions,
);

shiftSchema.index(
  { code: 1 },
  { unique: true, name: 'ux_code', partialFilterExpression: { isDeleted: false } },
);
shiftSchema.index({ active: 1 }, { name: 'ix_active' });

export const ShiftModel = model<ShiftDoc>('AttendanceShift', shiftSchema, 'hr_shifts');
