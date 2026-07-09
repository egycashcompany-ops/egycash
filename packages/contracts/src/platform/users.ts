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

const UserOrganizationSchema = z
  .object({
    branchId: objectId().nullable().default(null),
    departmentId: objectId().nullable().default(null),
    sectionId: objectId().nullable().default(null),
    jobTitleId: objectId().nullable().default(null),
  })
  .strict();

export const CreateUserSchema = z
  .object({
    email: z.string().email(),
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
  .strict();
export type CreateUser = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z
  .object({
    firstName: LocalizedStringSchema.optional(),
    lastName: LocalizedStringSchema.optional(),
    phone: PhoneNumberSchema.nullable().optional(),
    locale: LocaleSchema.optional(),
    organization: UserOrganizationSchema.partial().optional(),
    version: z.number().int().min(0),
  })
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
}).strict();
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;

export interface UserDto {
  id: string;
  email: string;
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
  totpEnabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface InvitedUserDto extends UserDto {
  /** Returned once at creation — used to build the activation link (dev: logged). */
  activationToken: string;
}
