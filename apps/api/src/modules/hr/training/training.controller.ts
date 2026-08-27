// Thin HTTP mapping only (ADR-003): parse, delegate, respond. Every rule lives in the services and
// in `session-rules.ts`.
import { type Request, type Response } from 'express';
import {
  type AttachTrainingCertificate,
  type CancelTrainingEnrollment,
  type CompleteTrainingSession,
  type CreateTrainingCourse,
  type CreateTrainingNomination,
  type CreateTrainingSession,
  type EnrollInTrainingSession,
  type DecideTrainingNomination,
  type ListTrainingEnrollmentsQuery,
  type ListTrainingNominationsQuery,
  type ListTrainingRecordsQuery,
  type MarkTrainingAttendance,
  type MarkTrainingAttendanceBulk,
  type ListTrainingCoursesQuery,
  type ListTrainingSessionsQuery,
  type TransitionTrainingSession,
  type UpdateTrainingCourse,
  type UpdateTrainingSession,
  type WithdrawTrainingNomination,
} from '@ecms/contracts';
import { created, ok, okPage } from '../../../platform/web';
import { validated } from '../../../infrastructure/http/validate';
import { ValidationError } from '../../../shared/errors';
import { type UploadedBinary } from '../../../platform/files';
import { authContext } from '../../../platform/auth';
import { scopeSelector } from '../../../shared/types';
import { trainingCourseService } from './courses/training-course.service';
import { trainingSessionService } from './sessions/training-session.service';
import { toTrainingCourseDto, toTrainingSessionDto } from './training.mapper';
import { trainingNominationService } from './nominations/training-nomination.service';
import {
  toTrainingEnrollmentDto,
  toTrainingNominationDto,
} from './nominations/nomination.mapper';
import { trainingRecordService } from './records/training-record.service';
import { toTrainingRecordDto } from './records/record.mapper';

type IdParam = { id: string };

/**
 * Sessions carry a seat count, and until T3 there is nothing that can occupy a seat. Zero is the
 * truth today rather than a placeholder, and it is written once here so the day the enrollment
 * collection lands there is exactly one call site to change.
 */
const ENROLLED_NONE = 0;

// ── Courses ─────────────────────────────────────────────────────────────────

export const listTrainingCourses = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListTrainingCoursesQuery>(req);
  okPage(res, await trainingCourseService.list(query), toTrainingCourseDto);
};

export const getTrainingCourse = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toTrainingCourseDto(await trainingCourseService.getById(params.id)));
};

export const createTrainingCourse = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateTrainingCourse>(req);
  const doc = await trainingCourseService.create(body, ctx.userId);
  created(res, toTrainingCourseDto(doc), `/api/v1/hr/training/courses/${String(doc._id)}`);
};

export const updateTrainingCourse = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateTrainingCourse, never, IdParam>(req);
  ok(res, toTrainingCourseDto(await trainingCourseService.update(params.id, body, ctx.userId)));
};

// ── Sessions ────────────────────────────────────────────────────────────────

/** Sessions are branch-scoped, so every read passes the caller's scope (D14). */
const sessionScope = (req: Request) => scopeSelector(authContext(req), 'trainingSession.view');

export const listTrainingSessions = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListTrainingSessionsQuery>(req);
  const page = await trainingSessionService.list(query, sessionScope(req));
  okPage(res, page, (doc) => toTrainingSessionDto(doc, ENROLLED_NONE));
};

export const getTrainingSession = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const doc = await trainingSessionService.getById(params.id, sessionScope(req));
  ok(res, toTrainingSessionDto(doc, ENROLLED_NONE));
};

export const createTrainingSession = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateTrainingSession>(req);
  const doc = await trainingSessionService.create(ctx, body);
  created(
    res,
    toTrainingSessionDto(doc, ENROLLED_NONE),
    `/api/v1/hr/training/sessions/${String(doc._id)}`,
  );
};

export const updateTrainingSession = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateTrainingSession, never, IdParam>(req);
  const doc = await trainingSessionService.update(ctx, params.id, body, sessionScope(req));
  ok(res, toTrainingSessionDto(doc, ENROLLED_NONE));
};

export const transitionTrainingSession = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<TransitionTrainingSession, never, IdParam>(req);
  const doc = await trainingSessionService.transition(ctx, params.id, body, sessionScope(req));
  ok(res, toTrainingSessionDto(doc, ENROLLED_NONE));
};

// ── Nominations and seats (T3) ──────────────────────────────────────────────

/** Both collections are about a PERSON, so both reads pass the caller's scope (D14). */
const nominationScope = (req: Request) => scopeSelector(authContext(req), 'trainingNomination.view');

export const listTrainingNominations = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListTrainingNominationsQuery>(req);
  const page = await trainingNominationService.list(query, nominationScope(req));
  okPage(res, page, toTrainingNominationDto);
};

export const getTrainingNomination = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const doc = await trainingNominationService.getById(params.id, nominationScope(req));
  ok(res, toTrainingNominationDto(doc));
};

export const createTrainingNomination = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateTrainingNomination>(req);
  const doc = await trainingNominationService.create(ctx, body, nominationScope(req));
  created(
    res,
    toTrainingNominationDto(doc),
    `/api/v1/hr/training/nominations/${String(doc._id)}`,
  );
};

export const decideTrainingNomination = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<DecideTrainingNomination, never, IdParam>(req);
  const doc = await trainingNominationService.decide(ctx, params.id, body, nominationScope(req));
  ok(res, toTrainingNominationDto(doc));
};

export const withdrawTrainingNomination = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<WithdrawTrainingNomination, never, IdParam>(req);
  const doc = await trainingNominationService.withdraw(ctx, params.id, body, nominationScope(req));
  ok(res, toTrainingNominationDto(doc));
};

export const listTrainingEnrollments = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListTrainingEnrollmentsQuery>(req);
  const page = await trainingNominationService.listEnrollments(query, nominationScope(req));
  okPage(res, page, toTrainingEnrollmentDto);
};

export const enrollInTrainingSession = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<EnrollInTrainingSession>(req);
  const doc = await trainingNominationService.enroll(ctx, body, nominationScope(req));
  created(
    res,
    toTrainingEnrollmentDto(doc),
    `/api/v1/hr/training/enrollments/${String(doc._id)}`,
  );
};

export const cancelTrainingEnrollment = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<CancelTrainingEnrollment, never, IdParam>(req);
  const doc = await trainingNominationService.cancelEnrollment(
    ctx,
    params.id,
    body,
    nominationScope(req),
  );
  ok(res, toTrainingEnrollmentDto(doc));
};

// ── Attendance, completion, records and certificates (T4) ───────────────────

const recordScope = (req: Request) => scopeSelector(authContext(req), 'trainingRecord.view');

/** Multipart intake — the same shape every other HR upload uses, refused the same way when absent. */
const binaryOf = (req: Request): UploadedBinary => {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (file === undefined) {
    throw new ValidationError([{ field: 'file', code: 'REQUIRED', message: 'a file is required' }]);
  }
  return {
    originalName: file.originalname,
    mime: file.mimetype,
    size: file.size,
    buffer: file.buffer,
  };
};

export const markTrainingAttendance = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<MarkTrainingAttendance, never, IdParam>(req);
  const doc = await trainingRecordService.markAttendance(
    ctx,
    params.id,
    body,
    scopeSelector(ctx, 'trainingNomination.view'),
  );
  ok(res, toTrainingEnrollmentDto(doc));
};

export const markTrainingAttendanceBulk = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<MarkTrainingAttendanceBulk>(req);
  ok(
    res,
    await trainingRecordService.markAttendanceBulk(
      ctx,
      body,
      scopeSelector(ctx, 'trainingNomination.view'),
    ),
  );
};

export const completeTrainingSession = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<CompleteTrainingSession, never, IdParam>(req);
  const { session, created: records } = await trainingRecordService.complete(
    ctx,
    params.id,
    body,
    scopeSelector(ctx, 'trainingSession.view'),
  );
  ok(res, {
    session: toTrainingSessionDto(session as never, ENROLLED_NONE),
    recordsCreated: records,
  });
};

export const listTrainingRecords = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListTrainingRecordsQuery>(req);
  const page = await trainingRecordService.list(query, recordScope(req));
  okPage(res, page, toTrainingRecordDto);
};

export const getTrainingRecord = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toTrainingRecordDto(await trainingRecordService.getById(params.id, recordScope(req))));
};

export const attachTrainingCertificate = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<AttachTrainingCertificate, never, IdParam>(req);
  const doc = await trainingRecordService.attachCertificate(
    ctx,
    params.id,
    binaryOf(req),
    body,
    recordScope(req),
  );
  ok(res, toTrainingRecordDto(doc));
};
