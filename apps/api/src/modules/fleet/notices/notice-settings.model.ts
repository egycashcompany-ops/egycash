// A form's set-up (إعداد النماذج) — one per insurer's form: what each box starts with on a new
// notice, and which boxes share one answer.
//
// «احط قيم افتراضيه … قيم بتتكرر فى اكتر من مكان زى كود العربيه و تواريخ معينه ف انا عاوز احدد دى
// برضو». Boxes are named by the form's own keys (the web client draws the form), so the server keeps
// a plain map, as it does for a notice's answers.
import { Schema, model } from 'mongoose';
import {
  FLEET_NOTICE_TEMPLATES,
  type FleetNoticeDefaultMode,
  type FleetNoticeTemplate,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface FleetNoticeSettingsDoc extends BaseDocFields {
  template: FleetNoticeTemplate;
  defaults: Record<string, { mode: FleetNoticeDefaultMode; value: string }>;
  links: { name: string; keys: string[] }[];
}

const noticeSettingsSchema = new Schema<FleetNoticeSettingsDoc>(
  {
    template: { type: String, enum: FLEET_NOTICE_TEMPLATES, required: true },
    defaults: { type: Schema.Types.Mixed, required: true, default: {} },
    links: { type: Schema.Types.Mixed, required: true, default: [] },
    ...baseFields,
  },
  { ...baseSchemaOptions, minimize: false },
);

// One set-up per form.
noticeSettingsSchema.index(
  { template: 1 },
  {
    name: 'ux_notice_settings_template',
    unique: true,
    partialFilterExpression: { isDeleted: false },
  },
);

export const FleetNoticeSettingsModel = model<FleetNoticeSettingsDoc>(
  'FleetNoticeSettings',
  noticeSettingsSchema,
  'fleet_notice_settings',
);
