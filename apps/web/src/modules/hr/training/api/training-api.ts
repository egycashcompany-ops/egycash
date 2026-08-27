// Training api/ surface (ADR-013 — P-HR-TRN, phase T2).
//
// Four resources: the catalogue, its deliveries, the requests to attend them, and the seats those
// requests create. There is no attendance call here and no certificate call — those are T4, and a
// client method for an endpoint that does not exist is how a screen ends up promising something
// the server refuses.
import {
  type CancelTrainingEnrollment,
  type CreateTrainingCourse,
  type CreateTrainingNomination,
  type CreateTrainingSession,
  type DecideTrainingNomination,
  type EnrollInTrainingSession,
  type TrainingEnrollmentDto,
  type TrainingNominationDto,
  type Paginated,
  type TransitionTrainingSession,
  type TrainingCourseDto,
  type TrainingSessionDto,
  type UpdateTrainingCourse,
  type UpdateTrainingSession,
  type WithdrawTrainingNomination,
} from '@ecms/contracts';
import { buildQuery, get, getPage, patch, post, type QueryParams } from '../../../../shared/lib/api-client';

const COURSES = '/hr/training/courses';
const SESSIONS = '/hr/training/sessions';
const NOMINATIONS = '/hr/training/nominations';
const ENROLLMENTS = '/hr/training/enrollments';

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

// ── Nominations ─────────────────────────────────────────────────────────────

export const listTrainingNominations = (
  params: QueryParams,
): Promise<Paginated<TrainingNominationDto>> =>
  getPage<TrainingNominationDto>(`${NOMINATIONS}${buildQuery(params)}`);

export const createTrainingNomination = (
  body: CreateTrainingNomination,
): Promise<TrainingNominationDto> => post<TrainingNominationDto>(NOMINATIONS, body);

export const decideTrainingNomination = (
  id: string,
  body: DecideTrainingNomination,
): Promise<TrainingNominationDto> =>
  post<TrainingNominationDto>(`${NOMINATIONS}/${id}/decide`, body);

export const withdrawTrainingNomination = (
  id: string,
  body: WithdrawTrainingNomination,
): Promise<TrainingNominationDto> =>
  post<TrainingNominationDto>(`${NOMINATIONS}/${id}/withdraw`, body);

// ── Seats ───────────────────────────────────────────────────────────────────

export const listTrainingEnrollments = (
  params: QueryParams,
): Promise<Paginated<TrainingEnrollmentDto>> =>
  getPage<TrainingEnrollmentDto>(`${ENROLLMENTS}${buildQuery(params)}`);

export const enrollInTrainingSession = (
  body: EnrollInTrainingSession,
): Promise<TrainingEnrollmentDto> => post<TrainingEnrollmentDto>(ENROLLMENTS, body);

export const cancelTrainingEnrollment = (
  id: string,
  body: CancelTrainingEnrollment,
): Promise<TrainingEnrollmentDto> =>
  post<TrainingEnrollmentDto>(`${ENROLLMENTS}/${id}/cancel`, body);
