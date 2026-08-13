// Thin HTTP mapping only (ADR-003). The caller's capabilities are computed HERE from the
// session's effective permissions and handed to the service — the Leave idiom, so the service
// authorizes without reaching into the request.
import { type Request, type Response } from 'express';
import {
  type AttendanceRegularizationDto,
  type CancelAttendanceRegularization,
  type CreateAttendanceRegularization,
  type DecideAttendanceRegularization,
  type ListAttendanceRegularizationsQuery,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { employeeLabelMap, labelFields } from '../../shared/employee-labels';
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

export const listRegularizations = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListAttendanceRegularizationsQuery, never>(req);
  const page = await regularizationService.list(
    query,
    scopeSelector(ctx, 'attendance.decideRegularization'),
  );
  const labels = await employeeLabelMap(page.items.map((doc) => String(doc.employeeId)));
  okPage(
    res,
    page,
    (doc): AttendanceRegularizationDto => ({
      ...toRegularizationDto(doc),
      ...labelFields(labels, String(doc.employeeId)),
    }),
  );
};

export const listMyRegularizations = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListAttendanceRegularizationsQuery, never>(req);
  // Any employee/branch filter is dropped: /me answers for the caller's own record only.
  const page = await regularizationService.listMine(String(ctx.userId), {
    page: query.page,
    pageSize: query.pageSize,
    sortDir: query.sortDir,
    ...(query.sortBy === undefined ? {} : { sortBy: query.sortBy }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.from === undefined ? {} : { from: query.from }),
    ...(query.to === undefined ? {} : { to: query.to }),
  });
  okPage(res, page, toRegularizationDto);
};

export const pendingRegularizationDecisions = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const ctx = authContext(req);
  const docs = await regularizationService.pendingDecisions(
    ctx,
    flagsOf(req),
    scopeSelector(ctx, 'attendance.decideRegularization'),
  );
  const labels = await employeeLabelMap(docs.map((doc) => String(doc.employeeId)));
  ok(
    res,
    docs.map(
      (doc): AttendanceRegularizationDto => ({
        ...toRegularizationDto(doc),
        ...labelFields(labels, String(doc.employeeId)),
      }),
    ),
  );
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
