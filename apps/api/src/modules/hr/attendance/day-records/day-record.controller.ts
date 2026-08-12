// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type ListAttendanceDaysQuery,
  type RecomputeAttendanceDays,
} from '@ecms/contracts';
import { ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { dayRecordService, toAttendanceDayDto } from './day-record.service';

export const listAttendanceDays = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListAttendanceDaysQuery, never>(req);
  const page = await dayRecordService.list(query);
  okPage(res, page, toAttendanceDayDto);
};

export const listMyAttendanceDays = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListAttendanceDaysQuery, never>(req);
  // Whatever employee/branch filters arrived are DROPPED: /me answers for the caller only.
  const own = {
    from: query.from,
    to: query.to,
    page: query.page,
    pageSize: query.pageSize,
    sortDir: query.sortDir,
    ...(query.sortBy === undefined ? {} : { sortBy: query.sortBy }),
    ...(query.status === undefined ? {} : { status: query.status }),
  };
  const page = await dayRecordService.listMine(String(ctx.userId), own);
  okPage(res, page, toAttendanceDayDto);
};

export const recomputeAttendanceDays = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<RecomputeAttendanceDays, never, never>(req);
  const result = await dayRecordService.recompute(ctx, body);
  ok(res, result);
};
