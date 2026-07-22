// User accounts (Platform Core §2). A login account belongs to at most one Employee (ADR-017):
// the platform stores an opaque `employeeId` back-reference (no cross-layer import); the HR module
// owns the linkage. `username` is a second login identifier (defaulted from the Employee Code);
// email is retained. Platform/system accounts (e.g. the seeded super-admin) carry no employeeId.
import { Schema, model, type Types } from 'mongoose';
import { USER_STATUSES, type LocalizedString, type UserStatus } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../shared/base/base.model';

export interface UserDoc extends BaseDocFields {
  email: string;
  /** Second login identifier (login accepts username OR email); null for legacy/system accounts. */
  username: string | null;
  /** The Employee this login belongs to (opaque back-reference); null for platform/system accounts. */
  employeeId: Types.ObjectId | null;
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
    username: { type: String, default: null, lowercase: true, trim: true },
    employeeId: { type: Schema.Types.ObjectId, default: null },
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
// Username is unique among live accounts; accounts without a username are exempt.
userSchema.index(
  { username: 1 },
  {
    unique: true,
    name: 'ux_username',
    partialFilterExpression: { isDeleted: false, username: { $type: 'string' } },
  },
);
// One login per employee (User → one Employee); platform/system accounts (no employeeId) are exempt.
userSchema.index(
  { employeeId: 1 },
  { unique: true, name: 'ux_employeeId', partialFilterExpression: { employeeId: { $type: 'objectId' } } },
);
userSchema.index({ 'organization.branchId': 1, status: 1 }, { name: 'ix_branchId_status' });

export const UserModel = model<UserDoc>('User', userSchema, 'users');
