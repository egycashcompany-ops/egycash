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
  /**
   * The list heading this role is filed under — a name an administrator wrote, or null.
   *
   * Organizational only; nothing in the authorization path reads it. It replaced a reference to a
   * department, which could only ever name a department: «أدوار النظام» and «البوابات الخارجية»
   * had nowhere to go, so every role piled up under «عام».
   *
   * There is no group record. A group exists because roles name it, is renamed by rewriting the
   * name on all of them, and is gone when the last one leaves.
   */
  group: string | null;
  permissionKeys: string[];
}

const roleSchema = new Schema<RoleDoc>(
  {
    key: { type: String, default: null },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    description: { type: String, default: null },
    group: { type: String, default: null },
    isSystem: { type: Boolean, default: false },
    permissionKeys: { type: [String], required: true },
    ...baseFields,
  },
  baseSchemaOptions,
);
// The list reads every role and groups in memory (there are tens, not thousands), but it SORTS on
// this so a group's roles stay contiguous across pages — a heading that appeared twice on one
// screen would read as two groups with the same name.
roleSchema.index({ group: 1, 'name.ar': 1 }, { name: 'ix_group_name' });
roleSchema.index(
  { key: 1 },
  { unique: true, name: 'ux_key', partialFilterExpression: { key: { $type: 'string' } } },
);

export const RoleModel = model<RoleDoc>('Role', roleSchema, 'roles');
