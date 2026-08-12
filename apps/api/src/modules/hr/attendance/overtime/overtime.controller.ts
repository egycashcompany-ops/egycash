// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type ApproveOvertime } from '@ecms/contracts';
import { ok, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { toAttendanceDayDto } from '../day-records';
import { overtimeService } from './overtime.service';

type IdParam = { id: string };

export const approveOvertime = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<ApproveOvertime, never, IdParam>(req);
  const doc = await overtimeService.approve(ctx, params.id, body);
  ok(res, toAttendanceDayDto(doc));
};
