// Thin HTTP mapping only (ADR-003).
//
// Every mutating handler passes the caller's `AuthContext` into the service. That is what makes the
// privilege-escalation guards apply to every request: the service's `actor` parameter is optional
// so the confinement reconciliation and the seeds can act as the system, and the controller is the
// place that guarantees no HTTP caller ever reaches the unguarded path.
import { type Request, type Response } from 'express';
import {
  type CreateRole,
  type CreateRoleAssignment,
  type ListRoleAssignmentsQuery,
  type ListRolesQuery,
  type UpdateRole,
  type UpdateRoleAssignment,
} from '@ecms/contracts';
import { created, noContent, ok, okPage } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { scopeSelector } from '../../shared/types';
import { authContext } from '../auth';
import { rbacService } from './rbac.service';

type IdParam = { id: string };

export const listPermissions = async (_req: Request, res: Response): Promise<void> => {
  // Catalog + pages in one answer (P7-A): a `pageId` the client cannot resolve is not useful, and
  // two responses could disagree about a tree that has to be rendered from both.
  ok(res, await rbacService.listPermissionCatalog());
};

export const listRoles = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListRolesQuery>(req);
  const page = await rbacService.listRoles(query);
  okPage(res, page, (doc) => rbacService.toRoleDto(doc));
};

export const getRole = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, rbacService.toRoleDto(await rbacService.getRole(params.id)));
};

export const createRole = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateRole>(req);
  const doc = await rbacService.createRole(body, ctx.userId, ctx);
  created(res, rbacService.toRoleDto(doc), `/api/v1/platform/roles/${String(doc._id)}`);
};

export const updateRole = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateRole, never, IdParam>(req);
  ok(res, rbacService.toRoleDto(await rbacService.updateRole(params.id, body, ctx.userId, ctx)));
};

export const deleteRole = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await rbacService.deleteRole(params.id, ctx.userId);
  noContent(res);
};

export const listAssignments = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListRoleAssignmentsQuery>(req);
  const page = await rbacService.listAssignments(query, scopeSelector(ctx, 'role.view'));
  // One batched role read for the whole page — never one per row.
  const roles = await rbacService.rolesForAssignments(page.items);
  okPage(res, page, (doc) => rbacService.toAssignmentDto(doc, roles.get(String(doc.roleId))));
};

export const createAssignment = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateRoleAssignment>(req);
  const doc = await rbacService.assignRole(body, ctx.userId, ctx);
  const role = await rbacService.getRole(String(doc.roleId));
  created(res, rbacService.toAssignmentDto(doc, role));
};

export const updateAssignment = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateRoleAssignment, never, IdParam>(req);
  const doc = await rbacService.updateAssignment(params.id, body, ctx.userId, ctx);
  const role = await rbacService.getRole(String(doc.roleId));
  ok(res, rbacService.toAssignmentDto(doc, role));
};

export const revokeAssignment = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await rbacService.revokeAssignment(params.id, ctx.userId, ctx);
  noContent(res);
};
