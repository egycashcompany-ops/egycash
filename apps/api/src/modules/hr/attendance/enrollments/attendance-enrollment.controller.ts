// Thin HTTP mapping only (ADR-003): parse, delegate, respond.
import { type Request, type Response } from 'express';
import {
  type CreateAttendanceEnrollment,
  type ListAttendanceEnrollmentsQuery,
  type UpdateAttendanceEnrollment,
} from '@ecms/contracts';
import { created, noContent, ok, okPage } from '../../../../platform/web';
import { validated } from '../../../../infrastructure/http/validate';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import {
  attendanceEnrollmentService,
  toAttendanceEnrollmentDto,
} from './attendance-enrollment.service';

type IdParam = { id: string };

/**
 * The map NARROWS by the EMPLOYEE's branch, not the device's.
 *
 * A mapping row says who a person is, so «which mappings may I read» is the same question as
 * «whose attendance may I read» — and a branch manager who could list every enrolment on a
 * shared device would learn the names of people filed elsewhere.
 */
const enrollmentScope = (req: Request) =>
  scopeSelector(authContext(req), 'attendanceDevice.view');

export const listAttendanceEnrollments = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListAttendanceEnrollmentsQuery, never>(req);
  const page = await attendanceEnrollmentService.list(query, enrollmentScope(req));
  okPage(res, page, (doc) => toAttendanceEnrollmentDto(doc));
};

export const getAttendanceEnrollment = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const doc = await attendanceEnrollmentService.getById(params.id, enrollmentScope(req));
  ok(res, toAttendanceEnrollmentDto(doc));
};

export const createAttendanceEnrollment = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateAttendanceEnrollment, never, never>(req);
  const doc = await attendanceEnrollmentService.create(ctx, body);
  created(
    res,
    toAttendanceEnrollmentDto(doc),
    `/api/v1/hr/attendance/enrollments/${String(doc._id)}`,
  );
};

export const updateAttendanceEnrollment = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateAttendanceEnrollment, never, IdParam>(req);
  const doc = await attendanceEnrollmentService.update(ctx, params.id, body, enrollmentScope(req));
  ok(res, toAttendanceEnrollmentDto(doc));
};

export const deleteAttendanceEnrollment = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await attendanceEnrollmentService.remove(ctx, params.id, enrollmentScope(req));
  noContent(res);
};
