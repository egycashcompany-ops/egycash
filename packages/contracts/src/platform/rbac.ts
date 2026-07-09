import { z } from 'zod';
import {
  objectId,
  DataScopeSchema,
  LocalizedStringSchema,
  PaginationQuerySchema,
} from '../common/index.js';

export const CreateRoleSchema = z
  .object({
    name: LocalizedStringSchema,
    description: z.string().max(500).optional(),
    permissionKeys: z.array(z.string()).min(1),
  })
  .strict();
export type CreateRole = z.infer<typeof CreateRoleSchema>;

export const UpdateRoleSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    description: z.string().max(500).nullable().optional(),
    permissionKeys: z.array(z.string()).min(1).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateRole = z.infer<typeof UpdateRoleSchema>;

export interface RoleDto {
  id: string;
  name: { ar: string; en: string };
  description: string | null;
  isSystem: boolean;
  permissionKeys: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

// Role assignments are time-boundable (Review R14): expiry is enforced at
// permission-set computation, not by a cleanup job.
export const CreateRoleAssignmentSchema = z
  .object({
    userId: objectId(),
    roleId: objectId(),
    scope: DataScopeSchema,
    /** Required when scope is `branch` and the target user has no home branch. */
    branchId: objectId().optional(),
    validFrom: z.coerce.date().optional(),
    validTo: z.coerce.date().optional(),
  })
  .strict()
  .refine((v) => v.validFrom === undefined || v.validTo === undefined || v.validFrom < v.validTo, {
    message: 'validFrom must be before validTo',
    path: ['validTo'],
  });
export type CreateRoleAssignment = z.infer<typeof CreateRoleAssignmentSchema>;

export interface RoleAssignmentDto {
  id: string;
  userId: string;
  roleId: string;
  scope: 'own' | 'branch' | 'organization';
  branchId: string | null;
  validFrom: string | null;
  validTo: string | null;
  createdAt: string;
}

export const ListRoleAssignmentsQuerySchema = PaginationQuerySchema.extend({
  userId: objectId().optional(),
  roleId: objectId().optional(),
}).strict();
export type ListRoleAssignmentsQuery = z.infer<typeof ListRoleAssignmentsQuerySchema>;

export interface PermissionDto {
  key: string;
  resource: string;
  action: string;
  moduleId: string;
  name: { ar: string; en: string };
  breakGlass: boolean;
}
