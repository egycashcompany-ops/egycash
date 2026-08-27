// Training api/ surface (ADR-013 — P-HR-TRN, phase T2).
//
// Five resources: the catalogue, its deliveries, the requests to attend them, the seats those
// requests create, and the permanent records completing a session writes.
import {
  type CancelTrainingEnrollment,
  type CreateTrainingCourse,
  type CreateTrainingNomination,
  type CreateTrainingSession,
  type DecideTrainingNomination,
  type AttachTrainingCertificate,
  type CompleteTrainingSession,
  type EnrollInTrainingSession,
  type MarkTrainingAttendance,
  type MarkTrainingAttendanceBulk,
  type TrainingRecordDto,
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
import { buildQuery, get, getPage, patch, post, upload, type QueryParams } from '../../../../shared/lib/api-client';

const COURSES = '/hr/training/courses';
const SESSIONS = '/hr/training/sessions';
const NOMINATIONS = '/hr/training/nominations';
const ENROLLMENTS = '/hr/training/enrollments';
const RECORDS = '/hr/training/records';

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

// ── The day, and what it produced ───────────────────────────────────────────

export const markTrainingAttendance = (
  enrollmentId: string,
  body: MarkTrainingAttendance,
): Promise<TrainingEnrollmentDto> =>
  post<TrainingEnrollmentDto>(`${ENROLLMENTS}/${enrollmentId}/attendance`, body);

/** The whole room in one call — how somebody running a session actually works. */
export const markTrainingAttendanceBulk = (
  body: MarkTrainingAttendanceBulk,
): Promise<{ marked: number; failed: { enrollmentId: string; reason: string }[] }> =>
  post<{ marked: number; failed: { enrollmentId: string; reason: string }[] }>(
    `${ENROLLMENTS}/attendance`,
    body,
  );

/**
 * Completing NAMES the people it qualifies (D7).
 *
 * Not `transition`, which handles the two status changes that mean nothing beyond themselves.
 * Completion writes permanent records, and the list is the whole of the decision.
 */
export const completeTrainingSession = (
  sessionId: string,
  body: CompleteTrainingSession,
): Promise<{ session: TrainingSessionDto; recordsCreated: number }> =>
  post<{ session: TrainingSessionDto; recordsCreated: number }>(
    `${SESSIONS}/${sessionId}/complete`,
    body,
  );

export const listTrainingRecords = (params: QueryParams): Promise<Paginated<TrainingRecordDto>> =>
  getPage<TrainingRecordDto>(`${RECORDS}${buildQuery(params)}`);

/** Multipart: the certificate itself, plus the expiry the paper carries (recorded, not enforced). */
export const attachTrainingCertificate = (
  recordId: string,
  file: File,
  body: AttachTrainingCertificate,
): Promise<TrainingRecordDto> => {
  const form = new FormData();
  form.append('file', file);
  if (body.expiresAt !== undefined) {
    form.append('expiresAt', new Date(body.expiresAt).toISOString());
  }
  if (body.note !== undefined) form.append('note', body.note);
  return upload<TrainingRecordDto>(`${RECORDS}/${recordId}/certificate`, form);
};
