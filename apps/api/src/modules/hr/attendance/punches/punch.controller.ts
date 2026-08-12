// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type ImportPunches,
  type ListPunchesQuery,
  type RecordPunch,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { punchService, toPunchDto } from './punch.service';

export const listPunches = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListPunchesQuery, never>(req);
  const page = await punchService.list(query);
  okPage(res, page, toPunchDto);
};

export const recordPunch = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<RecordPunch, never, never>(req);
  const doc = await punchService.record(ctx, body);
  created(res, toPunchDto(doc), `/api/v1/hr/attendance/punches/${String(doc._id)}`);
};

export const importPunches = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<ImportPunches, never, never>(req);
  const result = await punchService.import(ctx, body);
  ok(res, result);
};
