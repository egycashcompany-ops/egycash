// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type CreateShift, type UpdateShift } from '@ecms/contracts';
import { created, ok, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { shiftService, toShiftDto } from './shift.service';

type IdParam = { id: string };
type VersionBody = { version: number };

export const listShifts = async (_req: Request, res: Response): Promise<void> => {
  const rows = await shiftService.list();
  ok(res, rows.map(toShiftDto));
};

export const createShift = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateShift, never, never>(req);
  const doc = await shiftService.create(ctx, body);
  created(res, toShiftDto(doc), `/api/v1/hr/attendance/shifts/${String(doc._id)}`);
};

export const updateShift = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateShift, never, IdParam>(req);
  const doc = await shiftService.update(ctx, params.id, body);
  ok(res, toShiftDto(doc));
};

export const deactivateShift = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<VersionBody, never, IdParam>(req);
  const doc = await shiftService.deactivate(ctx, params.id, body.version);
  ok(res, toShiftDto(doc));
};
