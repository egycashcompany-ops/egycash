import { type Request, type Response } from 'express';
import {
  type CreateRole,
  type CreateRoleAssignment,
  type ListRoleAssignmentsQuery,
  type PaginationQuery,
  type UpdateRole,
} from '@ecms/contracts';
import { created, noContent, ok, okPage } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { authContext } from '../auth';
import { rbacService } from './rbac.service';

type IdParam = { id: string };

export const listPermissions = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await rbacService.listPermissions());
};

export const listRoles = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, PaginationQuery>(req);
  const page = await rbacService.listRoles(query.page, query.pageSize);
  okPage(res, page, (doc) => rbacService.toRoleDto(doc));
};

export const getRole = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, rbacService.toRoleDto(await rbacService.getRole(params.id)));
};

export const createRole = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateRole>(req);
  const doc = await rbacService.createRole(body, ctx.userId);
  created(res, rbacService.toRoleDto(doc), `/api/v1/platform/roles/${String(doc._id)}`);
};

export const updateRole = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateRole, never, IdParam>(req);
  ok(res, rbacService.toRoleDto(await rbacService.updateRole(params.id, body, ctx.userId)));
};

export const deleteRole = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await rbacService.deleteRole(params.id, ctx.userId);
  noContent(res);
};

export const listAssignments = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListRoleAssignmentsQuery>(req);
  const page = await rbacService.listAssignments(query);
  okPage(res, page, (doc) => rbacService.toAssignmentDto(doc));
};

export const createAssignment = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateRoleAssignment>(req);
  const doc = await rbacService.assignRole(body, ctx.userId);
  created(res, rbacService.toAssignmentDto(doc));
};

export const revokeAssignment = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await rbacService.revokeAssignment(params.id, ctx.userId);
  noContent(res);
};
