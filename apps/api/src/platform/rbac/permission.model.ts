// Permission registry — synced from the code catalog at boot; read-only at runtime
// (ADR-004). The DB never invents permissions; the code never checks unregistered ones.
import { Schema, model, type Types } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';

export interface PermissionDoc {
  _id: Types.ObjectId;
  key: string;
  resource: string;
  action: string;
  moduleId: string;
  name: LocalizedString;
  breakGlass: boolean;
  /**
   * The administration surface this permission belongs to, or `null` when none administers it.
   *
   * Mirrors the code catalog like every other field here — the DB never invents one, and no query
   * authorizes on it. It is stored so the role screen can read the tree from `/platform/permissions`
   * instead of the client re-deriving a relationship the registry already knows.
   */
  pageId: string | null;
}

const permissionSchema = new Schema<PermissionDoc>(
  {
    key: { type: String, required: true, unique: true },
    resource: { type: String, required: true },
    action: { type: String, required: true },
    moduleId: { type: String, required: true },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    breakGlass: { type: Boolean, default: false },
    pageId: { type: String, default: null },
  },
  { strict: true, versionKey: false },
);
permissionSchema.index({ moduleId: 1, resource: 1 }, { name: 'ix_moduleId_resource' });

export const PermissionModel = model<PermissionDoc>('Permission', permissionSchema, 'permissions');
