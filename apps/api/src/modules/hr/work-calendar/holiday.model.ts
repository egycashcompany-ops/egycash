// Public-holiday catalog (Leave design §5) — org-wide business-calendar facts, shared by
// Leave counting today and Attendance later. Dates are UTC-midnight date-only values on the
// Africa/Cairo business calendar (R10).
import { Schema, model } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface HolidayDoc extends BaseDocFields {
  date: Date;
  name: LocalizedString;
}

const holidaySchema = new Schema<HolidayDoc>(
  {
    date: { type: Date, required: true },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    ...baseFields,
  },
  baseSchemaOptions,
);

holidaySchema.index(
  { date: 1 },
  { unique: true, name: 'ux_date', partialFilterExpression: { isDeleted: false } },
);

export const HolidayModel = model<HolidayDoc>('Holiday', holidaySchema, 'hr_holidays');
