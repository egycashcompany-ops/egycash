// Roles are DATA (admin-managed bundles of permissions); system roles are seeded
// and protected (ADR-004).
import { Schema, model } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../shared/base/base.model';

export interface RoleDoc extends BaseDocFields {
  /** Stable key for seeded system roles (`super-admin`, `platform-admin`); null for admin-created. */
  key: string | null;
  name: LocalizedString;
  description: string | null;
  isSystem: boolean;
  permissionKeys: string[];
}

const roleSchema = new Schema<RoleDoc>(
  {
    key: { type: String, default: null },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    description: { type: String, default: null },
    isSystem: { type: Boolean, default: false },
    permissionKeys: { type: [String], required: true },
    ...baseFields,
  },
  baseSchemaOptions,
);
roleSchema.index(
  { key: 1 },
  { unique: true, name: 'ux_key', partialFilterExpression: { key: { $type: 'string' } } },
);

export const RoleModel = model<RoleDoc>('Role', roleSchema, 'roles');
