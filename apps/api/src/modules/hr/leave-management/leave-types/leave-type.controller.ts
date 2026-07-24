// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type CreateLeaveType, type UpdateLeaveType } from '@ecms/contracts';
import { created, ok, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { leaveTypeService, toLeaveTypeDto } from './leave-type.service';

type IdParam = { id: string };

export const listLeaveTypes = async (_req: Request, res: Response): Promise<void> => {
  const rows = await leaveTypeService.list();
  ok(res, rows.map(toLeaveTypeDto));
};

export const createLeaveType = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateLeaveType, never, never>(req);
  const doc = await leaveTypeService.create(ctx, body);
  created(res, toLeaveTypeDto(doc), `/api/v1/hr/leave-types/${String(doc._id)}`);
};

export const updateLeaveType = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateLeaveType, never, IdParam>(req);
  const doc = await leaveTypeService.update(ctx, params.id, body);
  ok(res, toLeaveTypeDto(doc));
};
