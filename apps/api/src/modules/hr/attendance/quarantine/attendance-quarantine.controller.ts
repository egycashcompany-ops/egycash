// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type DiscardAttendanceQuarantine,
  type ListAttendanceQuarantineQuery,
  type RetryAttendanceQuarantine,
} from '@ecms/contracts';
import { ok, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { attendanceQuarantineService } from './attendance-quarantine.service';

export const listQuarantine = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListAttendanceQuarantineQuery, never>(req);
  ok(res, await attendanceQuarantineService.list(query));
};

export const listUnmatchedIds = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await attendanceQuarantineService.unmatched());
};

export const retryQuarantine = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<RetryAttendanceQuarantine, never, never>(req);
  ok(res, await attendanceQuarantineService.retry(ctx, body));
};

export const discardQuarantine = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<DiscardAttendanceQuarantine, never, never>(req);
  ok(res, { discarded: await attendanceQuarantineService.discard(ctx, body) });
};
