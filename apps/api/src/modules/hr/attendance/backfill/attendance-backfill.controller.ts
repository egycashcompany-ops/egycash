// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type ListAttendanceBackfillsQuery,
  type StartAttendanceBackfill,
} from '@ecms/contracts';
import { created, ok, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { attendanceBackfillService } from './attendance-backfill.service';

interface IdParam {
  id: string;
}

export const startAttendanceBackfill = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<StartAttendanceBackfill, never, never>(req);
  const dto = await attendanceBackfillService.start(ctx, body);
  created(res, dto, `/api/v1/hr/attendance/backfills/${dto.id}`);
};

export const listAttendanceBackfills = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListAttendanceBackfillsQuery, never>(req);
  ok(res, await attendanceBackfillService.list(query));
};

export const readAttendanceBackfill = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, await attendanceBackfillService.progress(params.id));
};

export const cancelAttendanceBackfill = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, await attendanceBackfillService.cancel(authContext(req), params.id));
};

export const resumeAttendanceBackfill = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, await attendanceBackfillService.resume(authContext(req), params.id));
};
