// User accounts (Platform Core §2). A user is NOT an employee — HR's future
// Employee entity references a platform User; the platform stays business-agnostic.
import { Schema, model, type Types } from 'mongoose';
import { USER_STATUSES, type LocalizedString, type UserStatus } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../shared/base/base.model';

export interface UserDoc extends BaseDocFields {
  email: string;
  phone: string | null;
  passwordHash: string | null;
  profile: {
    firstName: LocalizedString;
    lastName: LocalizedString;
  };
  locale: 'ar' | 'en';
  status: UserStatus;
  organization: {
    branchId: Types.ObjectId | null;
    departmentId: Types.ObjectId | null;
    sectionId: Types.ObjectId | null;
    jobTitleId: Types.ObjectId | null;
  };
  security: {
    passwordChangedAt: Date | null;
    failedLogins: number;
    lockedUntil: Date | null;
    /** Effective-permission cache key version (ADR-004). */
    permissionVersion: number;
    totp: {
      enabled: boolean;
      /** Base32 TOTP secret; at-rest encryption is the DB provider's (Security §3). */
      secret: string | null;
      backupCodeHashes: string[];
    };
  };
  activation: {
    tokenHash: string | null;
    expiresAt: Date | null;
  };
}

const localized = { ar: { type: String, required: true }, en: { type: String, required: true } };

const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, default: null },
    passwordHash: { type: String, default: null },
    profile: {
      firstName: localized,
      lastName: localized,
    },
    locale: { type: String, enum: ['ar', 'en'], default: 'ar' },
    status: { type: String, enum: USER_STATUSES, default: 'invited' },
    organization: {
      branchId: { type: Schema.Types.ObjectId, default: null },
      departmentId: { type: Schema.Types.ObjectId, default: null },
      sectionId: { type: Schema.Types.ObjectId, default: null },
      jobTitleId: { type: Schema.Types.ObjectId, default: null },
    },
    security: {
      passwordChangedAt: { type: Date, default: null },
      failedLogins: { type: Number, default: 0 },
      lockedUntil: { type: Date, default: null },
      permissionVersion: { type: Number, default: 1 },
      totp: {
        enabled: { type: Boolean, default: false },
        secret: { type: String, default: null },
        backupCodeHashes: { type: [String], default: [] },
      },
    },
    activation: {
      tokenHash: { type: String, default: null },
      expiresAt: { type: Date, default: null },
    },
    ...baseFields,
  },
  baseSchemaOptions,
);

userSchema.index(
  { email: 1 },
  { unique: true, name: 'ux_email', partialFilterExpression: { isDeleted: false } },
);
userSchema.index({ 'organization.branchId': 1, status: 1 }, { name: 'ix_branchId_status' });

export const UserModel = model<UserDoc>('User', userSchema, 'users');
