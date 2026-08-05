// User accounts (Platform Core §2). A login account belongs to at most one Employee (ADR-017):
// the platform stores an opaque `employeeId` back-reference (no cross-layer import); the HR module
// owns the linkage. `username` is a second login identifier (defaulted from the Employee Code);
// email is retained. Platform/system accounts (e.g. the seeded super-admin) carry no employeeId.
import { Schema, model, type Types } from 'mongoose';
import {
  NAV_LAYOUTS,
  USER_STATUSES,
  type LocalizedString,
  type NavLayout,
  type UserStatus,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../shared/base/base.model';

export interface UserDoc extends BaseDocFields {
  /** Optional contact/login identifier — auto-provisioned employee accounts may have none. */
  email: string | null;
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
  /** Presentation-only choices the user makes about their own shell (ADR-013 is untouched). */
  preferences: {
    navLayout: NavLayout;
  };
  status: UserStatus;
  organization: {
    branchId: Types.ObjectId | null;
    departmentId: Types.ObjectId | null;
    sectionId: Types.ObjectId | null;
    jobTitleId: Types.ObjectId | null;
  };
  security: {
    passwordChangedAt: Date | null;
    /** First successful activation (§16.5); null while invited. */
    activatedAt: Date | null;
    /** Last completed login (§16.5). */
    lastLoginAt: Date | null;
    failedLogins: number;
    lockedUntil: Date | null;
    /** Effective-permission cache key version (ADR-004). */
    permissionVersion: number;
    /** First-login gate (auth design 4.2): true until the user changes the temp password. */
    mustChangePassword: boolean;
    totp: {
      enabled: boolean;
      /** Base32 TOTP secret; at-rest encryption is the DB provider's (Security §3). */
      secret: string | null;
      backupCodeHashes: string[];
      /** D6 — admin-forced enrollment: login demands enrollment until enabled. */
      required: boolean;
    };
  };
  activation: {
    tokenHash: string | null;
    expiresAt: Date | null;
    /** §16.1 — last-invitation metadata SURVIVES consumption/supersession/expiry. */
    sentAt: Date | null;
    delivery: { channel: 'whatsapp' | 'email'; ok: boolean; detail: string | null }[] | null;
  };
}

const localized = { ar: { type: String, required: true }, en: { type: String, required: true } };

const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, default: null, lowercase: true, trim: true },
    username: { type: String, default: null, lowercase: true, trim: true },
    employeeId: { type: Schema.Types.ObjectId, default: null },
    phone: { type: String, default: null },
    passwordHash: { type: String, default: null },
    profile: {
      firstName: localized,
      lastName: localized,
    },
    locale: { type: String, enum: ['ar', 'en'], default: 'ar' },
    // Accounts created before the launcher shipped have no stored choice; the default answers
    // for them without a migration, since the field is read through `buildMe` only.
    preferences: {
      navLayout: { type: String, enum: NAV_LAYOUTS, default: 'launchpad' },
    },
    status: { type: String, enum: USER_STATUSES, default: 'invited' },
    organization: {
      branchId: { type: Schema.Types.ObjectId, default: null },
      departmentId: { type: Schema.Types.ObjectId, default: null },
      sectionId: { type: Schema.Types.ObjectId, default: null },
      jobTitleId: { type: Schema.Types.ObjectId, default: null },
    },
    security: {
      passwordChangedAt: { type: Date, default: null },
      activatedAt: { type: Date, default: null },
      lastLoginAt: { type: Date, default: null },
      failedLogins: { type: Number, default: 0 },
      lockedUntil: { type: Date, default: null },
      permissionVersion: { type: Number, default: 1 },
      mustChangePassword: { type: Boolean, default: false },
      totp: {
        enabled: { type: Boolean, default: false },
        secret: { type: String, default: null },
        backupCodeHashes: { type: [String], default: [] },
        required: { type: Boolean, default: false },
      },
    },
    activation: {
      tokenHash: { type: String, default: null },
      expiresAt: { type: Date, default: null },
      sentAt: { type: Date, default: null },
      delivery: { type: [{ _id: false, channel: String, ok: Boolean, detail: { type: String, default: null } }], default: null },
    },
    ...baseFields,
  },
  baseSchemaOptions,
);

// Email is optional (auth design §3): unique among live accounts that HAVE one.
userSchema.index(
  { email: 1 },
  {
    unique: true,
    name: 'ux_email',
    partialFilterExpression: { isDeleted: false, email: { $type: 'string' } },
  },
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
