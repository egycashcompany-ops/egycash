// Training api/ surface (ADR-013 — P-HR-TRN, phase T2).
//
// Two resources and nothing else: the catalogue and its deliveries. There is no enrollment call
// here, no attendance call and no certificate call — those are T3 and T4, and a client method for
// an endpoint that does not exist is how a screen ends up promising something the server refuses.
import {
  type CreateTrainingCourse,
  type CreateTrainingSession,
  type Paginated,
  type TransitionTrainingSession,
  type TrainingCourseDto,
  type TrainingSessionDto,
  type UpdateTrainingCourse,
  type UpdateTrainingSession,
} from '@ecms/contracts';
import { buildQuery, get, getPage, patch, post, type QueryParams } from '../../../../shared/lib/api-client';

const COURSES = '/hr/training/courses';
const SESSIONS = '/hr/training/sessions';

// ── Courses ─────────────────────────────────────────────────────────────────

export const listTrainingCourses = (params: QueryParams): Promise<Paginated<TrainingCourseDto>> =>
  getPage<TrainingCourseDto>(`${COURSES}${buildQuery(params)}`);

export const getTrainingCourse = (id: string): Promise<TrainingCourseDto> =>
  get<TrainingCourseDto>(`${COURSES}/${id}`);

export const createTrainingCourse = (body: CreateTrainingCourse): Promise<TrainingCourseDto> =>
  post<TrainingCourseDto>(COURSES, body);

export const updateTrainingCourse = (
  id: string,
  body: UpdateTrainingCourse,
): Promise<TrainingCourseDto> => patch<TrainingCourseDto>(`${COURSES}/${id}`, body);

// ── Sessions ────────────────────────────────────────────────────────────────

export const listTrainingSessions = (params: QueryParams): Promise<Paginated<TrainingSessionDto>> =>
  getPage<TrainingSessionDto>(`${SESSIONS}${buildQuery(params)}`);

export const getTrainingSession = (id: string): Promise<TrainingSessionDto> =>
  get<TrainingSessionDto>(`${SESSIONS}/${id}`);

export const createTrainingSession = (body: CreateTrainingSession): Promise<TrainingSessionDto> =>
  post<TrainingSessionDto>(SESSIONS, body);

export const updateTrainingSession = (
  id: string,
  body: UpdateTrainingSession,
): Promise<TrainingSessionDto> => patch<TrainingSessionDto>(`${SESSIONS}/${id}`, body);

/** Start, complete or cancel — one endpoint, because they are one decision with three answers. */
export const transitionTrainingSession = (
  id: string,
  body: TransitionTrainingSession,
): Promise<TrainingSessionDto> => post<TrainingSessionDto>(`${SESSIONS}/${id}/transition`, body);
