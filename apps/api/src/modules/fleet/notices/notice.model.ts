// A filled insurance notice (الإخطارات) — one copy of one insurer's printed form.
//
// The answers are stored as the form's own boxes, box → text, because every insurer's form has
// different boxes and the screen that draws the form is the one that knows them. Nothing here is
// required — «ومش عاوز اى داتا اجبارى» — so an empty notice is a valid row.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';
import { FLEET_NOTICE_TEMPLATES, type FleetNoticeTemplate } from '@ecms/contracts';

export interface FleetNoticeDoc extends BaseDocFields {
  template: FleetNoticeTemplate;
  values: Record<string, string>;
  checks: Record<string, string[]>;
  vehicleId: Types.ObjectId | null;
  driverEmployeeId: Types.ObjectId | null;
  accidentId: Types.ObjectId | null;
}

const noticeSchema = new Schema<FleetNoticeDoc>(
  {
    template: { type: String, enum: FLEET_NOTICE_TEMPLATES, required: true },
    // `minimize: false` keeps an empty map as `{}` rather than dropping the field.
    values: { type: Schema.Types.Mixed, required: true, default: {} },
    checks: { type: Schema.Types.Mixed, required: true, default: {} },
    vehicleId: { type: Schema.Types.ObjectId, default: null },
    driverEmployeeId: { type: Schema.Types.ObjectId, default: null },
    accidentId: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  { ...baseSchemaOptions, minimize: false },
);

// The editor lists a form's saved copies, newest first.
noticeSchema.index({ template: 1, updatedAt: -1 }, { name: 'ix_notice_template_updated' });

export const FleetNoticeModel = model<FleetNoticeDoc>('FleetNotice', noticeSchema, 'fleet_notices');
