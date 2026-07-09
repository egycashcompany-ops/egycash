import { Schema, model, type Types } from 'mongoose';
import { SETTING_SCOPES, type SettingScope } from '@ecms/contracts';

export interface SettingValueDoc {
  _id: Types.ObjectId;
  key: string;
  scope: SettingScope;
  /** Branch/user id; null at organization scope (the organization is a singleton, ADR-015). */
  scopeRef: Types.ObjectId | null;
  value: unknown;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const settingValueSchema = new Schema<SettingValueDoc>(
  {
    key: { type: String, required: true },
    scope: { type: String, enum: SETTING_SCOPES, required: true },
    scopeRef: { type: Schema.Types.ObjectId, default: null },
    value: { type: Schema.Types.Mixed },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { strict: true, timestamps: true },
);
settingValueSchema.index(
  { key: 1, scope: 1, scopeRef: 1 },
  { unique: true, name: 'ux_key_scope_scopeRef' },
);

export const SettingValueModel = model<SettingValueDoc>(
  'SettingValue',
  settingValueSchema,
  'settings_values',
);
