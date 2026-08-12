// Thin HTTP mapping only (ADR-003). The caller's capabilities are computed HERE from the
// session's effective permissions and handed to the service — the Leave idiom, so the service
// authorizes without reaching into the request.
import { type Request, type Response } from 'express';
import {
  type CancelAttendanceRegularization,
  type CreateAttendanceRegularization,
  type DecideAttendanceRegularization,
} from '@ecms/contracts';
import { created, ok, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import {
  regularizationService,
  toRegularizationDto,
  type RegularizationCallerFlags,
} from './regularization.service';

type IdParam = { id: string };

const flagsOf = (req: Request): RegularizationCallerFlags => {
  const ctx = authContext(req);
  return {
    canRequest: 'attendance.requestRegularization' in ctx.permissions,
    canDecide: 'attendance.decideRegularization' in ctx.permissions,
  };
};

export const createRegularization = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateAttendanceRegularization, never, never>(req);
  const doc = await regularizationService.create(ctx, flagsOf(req), body);
  created(
    res,
    toRegularizationDto(doc),
    `/api/v1/hr/attendance/regularizations/${String(doc._id)}`,
  );
};

export const decideRegularization = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<DecideAttendanceRegularization, never, IdParam>(req);
  const doc = await regularizationService.decide(ctx, flagsOf(req), params.id, body);
  ok(res, toRegularizationDto(doc));
};

export const cancelRegularization = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<CancelAttendanceRegularization, never, IdParam>(req);
  const doc = await regularizationService.cancel(ctx, params.id, body.version);
  ok(res, toRegularizationDto(doc));
};
