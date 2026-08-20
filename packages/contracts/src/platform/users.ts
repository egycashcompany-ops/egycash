import { z } from 'zod';
import {
  objectId,
  LocaleSchema,
  LocalizedStringSchema,
  PaginationQuerySchema,
  PhoneNumberSchema,
} from '../common/index.js';

export const USER_STATUSES = ['invited', 'active', 'suspended', 'archived'] as const;
export const UserStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof UserStatusSchema>;

/**
 * Admin-visible activation state (design §15.4) — DERIVED server-side, never stored.
 * The employee card renders a fifth state, "not invited", for an employee with no login.
 */
export const ACCOUNT_STATUSES = ['invitationSent', 'activated', 'expired', 'locked'] as const;
export const AccountStatusSchema = z.enum(ACCOUNT_STATUSES);
export type AccountStatus = z.infer<typeof AccountStatusSchema>;

/**
 * Which population an account belongs to.
 *
 * `employee` — a login that belongs to an HR employee (ADR-017).
 * `system`   — a platform account belonging to nobody: the seeded super-admin, service accounts.
 * `external` — someone outside the company: a customer, a supplier, an auditor. The account names
 *              the module that owns the relationship and the record it points at, and it is NOT an
 *              employee, so nothing that offers "pick a person" may offer it.
 *
 * Derived from the account, never stored: an account has an employee, or an external subject, or
 * neither. Those are mutually exclusive by construction.
 */
export const USER_KINDS = ['employee', 'system', 'external'] as const;
export const UserKindSchema = z.enum(USER_KINDS);
export type UserKind = z.infer<typeof UserKindSchema>;

/**
 * The record OUTSIDE the platform that an external account is.
 *
 * The same shape `employeeId` has, with the owner named: an opaque back-reference the platform
 * stores and never interprets. `moduleId` says who owns the relationship, `subjectType` which of
 * that module's records it is, and `subjectId` which one — so a second module with external users
 * of its own writes one new `subjectType` and reuses everything else.
 */
export interface ExternalSubjectDto {
  moduleId: string;
  subjectType: string;
  subjectId: string;
}

/** Login username: lowercase-normalized; defaults to the Employee Code (e.g. `001025`). */
export const UsernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/, 'letters, digits, dot, underscore or hyphen');

const UserOrganizationSchema = z
  .object({
    branchId: objectId().nullable().default(null),
    departmentId: objectId().nullable().default(null),
    sectionId: objectId().nullable().default(null),
    jobTitleId: objectId().nullable().default(null),
  })
  .strict();

/**
 * An account must be reachable by at least one login identifier.
 *
 * Both fields are individually optional — an account may sign in by username, by email, or by
 * either — but an account with NEITHER can never sign in at all: `findByIdentifier` matches on
 * username, email or employee code, and a platform account has no employee code. Such a record
 * used to be creatable and looked completely normal in every list; the invariant is stated here,
 * at the boundary, so no caller can produce one.
 *
 * The same rule holds on UPDATE, but it cannot live in a schema there: whether clearing the email
 * leaves the account reachable depends on the username it already has, which only the service can
 * see.
 */
const hasLoginIdentifier = (value: {
  email?: string | undefined;
  username?: string | undefined;
}): boolean => value.email !== undefined || value.username !== undefined;

const LOGIN_IDENTIFIER_REQUIRED = {
  message: 'an account needs at least one login identifier — an email or a username',
  path: ['username'],
};

export const CreateUserSchema = z
  .object({
    email: z.string().email().optional(),
    /** Second login identifier. Admin-supplied here; HR defaults it to the Employee Code. */
    username: UsernameSchema.optional(),
    firstName: LocalizedStringSchema,
    lastName: LocalizedStringSchema,
    phone: PhoneNumberSchema.optional(),
    locale: LocaleSchema.default('ar'),
    organization: UserOrganizationSchema.default({
      branchId: null,
      departmentId: null,
      sectionId: null,
      jobTitleId: null,
    }),
  })
  .strict()
  .refine(hasLoginIdentifier, LOGIN_IDENTIFIER_REQUIRED);
export type CreateUser = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z
  .object({
    firstName: LocalizedStringSchema.optional(),
    lastName: LocalizedStringSchema.optional(),
    /**
     * Nullable: an account that signs in by username may drop its email. The service refuses the
     * change when it would leave the account with no identifier at all — a rule that needs the
     * STORED username to decide, which is why it is not expressed here.
     */
    email: z.string().email().nullable().optional(),
    phone: PhoneNumberSchema.nullable().optional(),
    locale: LocaleSchema.optional(),
    /** Administrators may change the username later (the Employee Code is never editable). */
    username: UsernameSchema.optional(),
    organization: UserOrganizationSchema.partial().optional(),
    version: z.number().int().min(0),
  })
  // `.strict()` is the guard that keeps `employeeId` out: the employee ↔ login link is owned by HR
  // (ADR-017) and is written only through its service, so an update that named it would be a
  // second, unowned writer of the same fact. A test pins this.
  .strict();
export type UpdateUser = z.infer<typeof UpdateUserSchema>;

export const ChangeUserStatusSchema = z
  .object({
    status: z.enum(['active', 'suspended', 'archived']),
    version: z.number().int().min(0),
  })
  .strict();
export type ChangeUserStatus = z.infer<typeof ChangeUserStatusSchema>;

export const ListUsersQuerySchema = PaginationQuerySchema.extend({
  status: UserStatusSchema.optional(),
  branchId: objectId().optional(),
  search: z.string().max(200).optional(),
  /** Narrow to one population — the pickers ask for `employee` so a customer is never offered. */
  kind: UserKindSchema.optional(),
}).strict();
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;

export interface UserDto {
  id: string;
  email: string | null;
  /** Second login identifier; null for accounts that only log in by email. */
  username: string | null;
  /** First-login gate state (admin visibility; design 4.2 — dormant since §14). */
  mustChangePassword: boolean;
  /** A one-time setup/activation link is outstanding (design §14) — resend is possible. */
  setupLinkPending: boolean;
  /** Derived activation state for admin screens (design §15.4). */
  accountStatus: AccountStatus;
  // ── Account panel (design §16.5) — read-only lifecycle timestamps + delivery outcomes ──
  /** When the most recent setup link was issued; survives consumption (§16.1). */
  invitationSentAt: string | null;
  /** Validity end of the PENDING link; null once consumed, superseded, or swept. */
  invitationExpiresAt: string | null;
  /** First successful activation; null while invited. */
  activatedAt: string | null;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
  /** Per-channel outcome of the most recent invitation delivery (§16.4). */
  lastDelivery: { channel: 'whatsapp' | 'email'; ok: boolean; detail: string | null }[] | null;
  totpEnabled: boolean;
  /** D6 — admin-forced TOTP enrollment pending/active. */
  totpRequired: boolean;
  /** The Employee this login belongs to; null for platform/system and external accounts. */
  employeeId: string | null;
  /** The outside record this login belongs to; null for everyone who works here. */
  externalSubject: ExternalSubjectDto | null;
  /** Which population this account is — derived from the two fields above. */
  kind: UserKind;
  phone: string | null;
  firstName: { ar: string; en: string };
  lastName: { ar: string; en: string };
  locale: 'ar' | 'en';
  status: UserStatus;
  organization: {
    branchId: string | null;
    departmentId: string | null;
    sectionId: string | null;
    jobTitleId: string | null;
  };
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface InvitedUserDto extends UserDto {
  /** Returned once at creation — used to build the activation link (dev: logged). */
  activationToken: string;
}
