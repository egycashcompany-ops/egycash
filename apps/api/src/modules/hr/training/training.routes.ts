// Router: authenticate → authorize → validate → controller.
//
// THE PERMISSION SPLIT. `trainingCourse.*` administers the CATALOGUE — configuration, and a small
// group's job. `trainingSession.*` schedules and runs DELIVERIES, which is a larger group's daily
// work, and `trainingSession.conduct` is the one that starts, completes and cancels: completing is
// what will write the immutable records (D7), so it is a heavier act than editing a room booking
// and is not folded into `edit`.
//
// The catalogue is deliberately NOT gated by `trainingSession.view`: somebody scheduling a delivery
// must be able to pick a course, and nothing in the catalogue is sensitive.
import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  AttachTrainingCertificateSchema,
  CancelTrainingEnrollmentSchema,
  CompleteTrainingSessionSchema,
  ErrorCodes,
  CreateTrainingCourseSchema,
  CreateTrainingNominationSchema,
  CreateTrainingSessionSchema,
  DecideTrainingNominationSchema,
  EnrollInTrainingSessionSchema,
  ListTrainingEnrollmentsQuerySchema,
  ListTrainingNominationsQuerySchema,
  ListTrainingRecordsQuerySchema,
  MarkTrainingAttendanceBulkSchema,
  MarkTrainingAttendanceSchema,
  ListTrainingCoursesQuerySchema,
  ListTrainingSessionsQuerySchema,
  TransitionTrainingSessionSchema,
  UpdateTrainingCourseSchema,
  UpdateTrainingSessionSchema,
  WithdrawTrainingNominationSchema,
  objectId,
} from '@ecms/contracts';
import { asyncHandler, validate } from '../../../platform/web';
import { AppError } from '../../../shared/errors';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import {
  attachTrainingCertificate,
  cancelTrainingEnrollment,
  completeTrainingSession,
  getTrainingRecord,
  listTrainingRecords,
  markTrainingAttendance,
  markTrainingAttendanceBulk,
  createTrainingCourse,
  createTrainingNomination,
  createTrainingSession,
  decideTrainingNomination,
  enrollInTrainingSession,
  getTrainingNomination,
  listTrainingEnrollments,
  listTrainingNominations,
  withdrawTrainingNomination,
  getTrainingCourse,
  getTrainingSession,
  listTrainingCourses,
  listTrainingSessions,
  transitionTrainingSession,
  updateTrainingCourse,
  updateTrainingSession,
} from './training.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

/** A signed certificate is a scan or a phone photograph, so the cap is the one images need. */
const CERTIFICATE_MAX_MB = 25;

const multipartSingle = (): RequestHandler => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: CERTIFICATE_MAX_MB * 1024 * 1024, files: 1 },
  }).single('file');
  return (req: Request, res: Response, next: NextFunction): void => {
    upload(req, res, (error: unknown) => {
      if (error === undefined || error === null) {
        next();
        return;
      }
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        next(
          new AppError(
            ErrorCodes.FILE_TOO_LARGE,
            422,
            `File exceeds the ${String(CERTIFICATE_MAX_MB)} MB cap`,
          ),
        );
        return;
      }
      next(error);
    });
  };
};

export const buildTrainingCoursesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    // Authenticated, not gated by `trainingCourse.manage`: picking a course is not administering
    // the catalogue, and the same decoupling `org-unit.http.ts` states for its dropdowns.
    validate({ query: ListTrainingCoursesQuerySchema }),
    asyncHandler(listTrainingCourses),
  );
  router.get(
    '/:id',
    authenticate,
    validate({ params: IdParamSchema }),
    asyncHandler(getTrainingCourse),
  );
  router.post(
    '/',
    authenticate,
    authorize('trainingCourse.manage'),
    validate({ body: CreateTrainingCourseSchema }),
    asyncHandler(createTrainingCourse),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('trainingCourse.manage'),
    validate({ body: UpdateTrainingCourseSchema, params: IdParamSchema }),
    asyncHandler(updateTrainingCourse),
  );
  return router;
};

export const buildTrainingSessionsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('trainingSession.view'),
    validate({ query: ListTrainingSessionsQuerySchema }),
    asyncHandler(listTrainingSessions),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('trainingSession.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getTrainingSession),
  );
  router.post(
    '/',
    authenticate,
    authorize('trainingSession.create'),
    validate({ body: CreateTrainingSessionSchema }),
    asyncHandler(createTrainingSession),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('trainingSession.edit'),
    validate({ body: UpdateTrainingSessionSchema, params: IdParamSchema }),
    asyncHandler(updateTrainingSession),
  );
  /**
   * COMPLETION IS ITS OWN ROUTE, not an action on `/transition`, because it takes the list of
   * people it qualifies (D7) and writes their permanent records. Folding it back into the
   * transition would give the system a second way to complete a session — one that quietly
   * qualifies nobody.
   */
  router.post(
    '/:id/complete',
    authenticate,
    authorize('trainingSession.conduct'),
    validate({ body: CompleteTrainingSessionSchema, params: IdParamSchema }),
    asyncHandler(completeTrainingSession),
  );
  // Its own grant: starting and calling off a session is running it, not editing a room booking.
  router.post(
    '/:id/transition',
    authenticate,
    authorize('trainingSession.conduct'),
    validate({ body: TransitionTrainingSessionSchema, params: IdParamSchema }),
    asyncHandler(transitionTrainingSession),
  );
  return router;
};

/**
 * Nominations and the seats they create (T3).
 *
 * THE PERMISSION SPLIT IS D3 MADE MECHANICAL. `create` asks; `decide` answers. Two keys, because
 * one key held by one person is not a two-person rule — and the service additionally refuses the
 * nominator their own decision, since a key says what you may do, not who you are.
 *
 * Seats sit on `decide` rather than a key of their own: putting somebody in directly and approving
 * a nomination for them are the same act with and without the paperwork, and taking a seat back is
 * the same authority reversing itself. A third key would suggest they were three different powers.
 */
export const buildTrainingNominationsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('trainingNomination.view'),
    validate({ query: ListTrainingNominationsQuerySchema }),
    asyncHandler(listTrainingNominations),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('trainingNomination.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getTrainingNomination),
  );
  router.post(
    '/',
    authenticate,
    authorize('trainingNomination.create'),
    validate({ body: CreateTrainingNominationSchema }),
    asyncHandler(createTrainingNomination),
  );
  router.post(
    '/:id/decide',
    authenticate,
    authorize('trainingNomination.decide'),
    validate({ body: DecideTrainingNominationSchema, params: IdParamSchema }),
    asyncHandler(decideTrainingNomination),
  );
  // On `create`, not `decide`: taking your own request back is not a decision about somebody.
  router.post(
    '/:id/withdraw',
    authenticate,
    authorize('trainingNomination.create'),
    validate({ body: WithdrawTrainingNominationSchema, params: IdParamSchema }),
    asyncHandler(withdrawTrainingNomination),
  );
  return router;
};

export const buildTrainingEnrollmentsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('trainingNomination.view'),
    validate({ query: ListTrainingEnrollmentsQuerySchema }),
    asyncHandler(listTrainingEnrollments),
  );
  router.post(
    '/',
    authenticate,
    authorize('trainingNomination.decide'),
    validate({ body: EnrollInTrainingSessionSchema }),
    asyncHandler(enrollInTrainingSession),
  );
  router.post(
    '/:id/cancel',
    authenticate,
    authorize('trainingNomination.decide'),
    validate({ body: CancelTrainingEnrollmentSchema, params: IdParamSchema }),
    asyncHandler(cancelTrainingEnrollment),
  );
  /**
   * Marking the room is CONDUCTING, not deciding (D6). The person who taught the session says who
   * was in it; the person who grants seats does not, and neither of them completes anybody by
   * doing it — that is a separate act on the session itself.
   */
  router.post(
    '/:id/attendance',
    authenticate,
    authorize('trainingSession.conduct'),
    validate({ body: MarkTrainingAttendanceSchema, params: IdParamSchema }),
    asyncHandler(markTrainingAttendance),
  );
  router.post(
    '/attendance',
    authenticate,
    authorize('trainingSession.conduct'),
    validate({ body: MarkTrainingAttendanceBulkSchema }),
    asyncHandler(markTrainingAttendanceBulk),
  );
  return router;
};

/**
 * The records, and the certificates on them (D8, D9).
 *
 * READ-ONLY apart from the certificate. There is no update route and no delete route, because a
 * record says what somebody was taught and that is not a thing anybody later edits — see
 * `training-immutability.spec.ts`, which holds the same claim against the service.
 */
export const buildTrainingRecordsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('trainingRecord.view'),
    validate({ query: ListTrainingRecordsQuerySchema }),
    asyncHandler(listTrainingRecords),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('trainingRecord.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getTrainingRecord),
  );
  // The conducting key, because attaching a certificate is the last step of running a session —
  // the person who taught it is the person holding the paper.
  router.post(
    '/:id/certificate',
    authenticate,
    authorize('trainingSession.conduct'),
    multipartSingle(),
    validate({ body: AttachTrainingCertificateSchema, params: IdParamSchema }),
    asyncHandler(attachTrainingCertificate),
  );
  return router;
};
