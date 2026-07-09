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
}

const permissionSchema = new Schema<PermissionDoc>(
  {
    key: { type: String, required: true, unique: true },
    resource: { type: String, required: true },
    action: { type: String, required: true },
    moduleId: { type: String, required: true },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    breakGlass: { type: Boolean, default: false },
  },
  { strict: true, versionKey: false },
);
permissionSchema.index({ moduleId: 1, resource: 1 }, { name: 'ix_moduleId_resource' });

export const PermissionModel = model<PermissionDoc>('Permission', permissionSchema, 'permissions');
