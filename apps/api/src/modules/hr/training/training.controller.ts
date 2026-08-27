// Thin HTTP mapping only (ADR-003): parse, delegate, respond. Every rule lives in the services and
// in `session-rules.ts`.
import { type Request, type Response } from 'express';
import {
  type CreateTrainingCourse,
  type CreateTrainingSession,
  type ListTrainingCoursesQuery,
  type ListTrainingSessionsQuery,
  type TransitionTrainingSession,
  type UpdateTrainingCourse,
  type UpdateTrainingSession,
} from '@ecms/contracts';
import { created, ok, okPage } from '../../../platform/web';
import { validated } from '../../../infrastructure/http/validate';
import { authContext } from '../../../platform/auth';
import { scopeSelector } from '../../../shared/types';
import { trainingCourseService } from './courses/training-course.service';
import { trainingSessionService } from './sessions/training-session.service';
import { toTrainingCourseDto, toTrainingSessionDto } from './training.mapper';

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
