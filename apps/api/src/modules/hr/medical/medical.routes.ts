// Router: authenticate → authorize → validate → controller.
//
// TWO KEYS AND NEITHER IS AN EMPLOYEE KEY (D3). `medicalRecord.view` reads and
// `medicalRecord.manage` writes, and holding `employee.view`, `employee.edit` or every other HR
// permission in the system grants neither. A line manager who may read somebody's attendance,
// salary band and contract may not read their blood type.
//
// `medicalCheck.*` is RECRUITMENT's key, about an applicant's pre-employment exam (D1). Different
// subject, different question, different door — and `medical-visibility.spec.ts` refuses to let
// this feature borrow it.
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
  EndInsuranceCardSchema,
  ErrorCodes,
  IssueInsuranceCardSchema,
  ListInsuranceCardsQuerySchema,
  ListMedicalEventsQuerySchema,
  ListMedicalProfilesQuerySchema,
  RecordMedicalEventSchema,
  UpdateInsuranceCardSchema,
  UpsertMedicalProfileSchema,
  objectId,
} from '@ecms/contracts';
import { asyncHandler, validate } from '../../../platform/web';
import { AppError } from '../../../shared/errors';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import {
  endInsuranceCard,
  getMedicalProfile,
  getMyMedicalProfile,
  issueInsuranceCard,
  listInsuranceCards,
  listMedicalEvents,
  listMedicalProfiles,
  recordMedicalEvent,
  updateInsuranceCard,
  upsertMedicalProfile,
} from './medical.controller';

const EmployeeIdParamSchema = z.object({ employeeId: objectId() }).strict();

export const buildMedicalProfilesRouter = (): Router => {
  const router = Router();
  /**
   * D5 — every employee login, no key.
   *
   * DECLARED BEFORE `/:employeeId`, because Express matches in order and the id route would
   * otherwise swallow `me`. That is the trap `/platform/job-titles/options` fell into, answering
   * 404 to two shipped screens.
   *
   * There is no permission here on purpose: gating your own health record behind
   * `medicalRecord.view` would mean you could read it only if you could also read everybody's.
   */
  router.get('/me', authenticate, asyncHandler(getMyMedicalProfile));
  router.get(
    '/',
    authenticate,
    authorize('medicalRecord.view'),
    validate({ query: ListMedicalProfilesQuerySchema }),
    asyncHandler(listMedicalProfiles),
  );
  router.get(
    '/:employeeId',
    authenticate,
    authorize('medicalRecord.view'),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(getMedicalProfile),
  );
  /**
   * One endpoint for create and correct, because there is one row per person and «has anybody
   * written anything yet» is not a distinction the caller should have to make. A profile is
   * corrected rather than versioned — it says what is true now (D6).
   *
   * PATCH rather than PUT because every field in the body is optional: an HR officer recording only
   * a blood type must not thereby erase the allergies somebody else recorded last year. The verb
   * matches the schema, and both match every other write in this codebase.
   */
  router.patch(
    '/:employeeId',
    authenticate,
    authorize('medicalRecord.manage'),
    validate({ body: UpsertMedicalProfileSchema, params: EmployeeIdParamSchema }),
    asyncHandler(upsertMedicalProfile),
  );
  return router;
};

/** A scan or a phone photograph of a signed certificate — the cap images need. */
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

/**
 * Medical events — TWO ROUTES, and the two that are missing are the point.
 *
 * There is no PATCH and no DELETE (D9). An event records what was said on a day; a correction is a
 * new event, which is the only account of history that survives «what did we know, and when». The
 * repository refuses the write at the seam, so declaring the routes would only mean two endpoints
 * that always fail.
 *
 * Recording is multipart because the certificate arrives WITH the event: the row can never be
 * written again, so there is no «attach it later».
 */
export const buildMedicalEventsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('medicalRecord.view'),
    validate({ query: ListMedicalEventsQuerySchema }),
    asyncHandler(listMedicalEvents),
  );
  router.post(
    '/',
    authenticate,
    authorize('medicalRecord.manage'),
    multipartSingle(),
    validate({ body: RecordMedicalEventSchema }),
    asyncHandler(recordMedicalEvent),
  );
  return router;
};

const CardIdParamSchema = z.object({ id: objectId() }).strict();

/**
 * Insurance — ITS OWN TWO KEYS, not the clinical record's.
 *
 * The first draft shared `medicalRecord.*` and that was backwards. D4 scopes the card by branch
 * precisely because benefits administration is DELEGABLE; gating it on the clinical key would mean
 * that delegating it hands out clinical access, and whoever files a card number could read
 * everybody's conditions. Administrative and clinical are two gates.
 *
 * THERE IS NO RENEW ROUTE. A renewal is what the provider does — one card ends and another is
 * issued — and a single endpoint for it would hide which number somebody actually held on a given
 * day. `hr.medicalInsurance.renewed` is emitted when an issue follows an end for the same person.
 */
export const buildMedicalInsuranceRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('medicalInsurance.view'),
    validate({ query: ListInsuranceCardsQuerySchema }),
    asyncHandler(listInsuranceCards),
  );
  router.post(
    '/',
    authenticate,
    authorize('medicalInsurance.manage'),
    validate({ body: IssueInsuranceCardSchema }),
    asyncHandler(issueInsuranceCard),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('medicalInsurance.manage'),
    validate({ body: UpdateInsuranceCardSchema, params: CardIdParamSchema }),
    asyncHandler(updateInsuranceCard),
  );
  router.post(
    '/:id/end',
    authenticate,
    authorize('medicalInsurance.manage'),
    validate({ body: EndInsuranceCardSchema, params: CardIdParamSchema }),
    asyncHandler(endInsuranceCard),
  );
  return router;
};
