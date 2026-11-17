// Two routers with deliberately different postures.
//
// The ADMIN router is ordinary: authenticate, authorize, validate.
//
// The PUBLIC router is reachable by anyone with a link, so it is written to be boring on purpose —
// two endpoints, both keyed by an unguessable token, one of which does exactly one thing
// (register an applicant against that token's source). It is rate-limited per IP, it answers with
// the applicant's code and nothing else, and a wrong or revoked token is a flat 404 that says
// nothing about whether the form, the link or the source is the part that is missing.
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import {
  GenerateRecruitmentFormLinkSchema,
  RecruitmentFormSourceParamSchema,
  RecruitmentFormTokenParamSchema,
  SubmitRecruitmentFormSchema,
  UpdateRecruitmentFormSchema,
  type GenerateRecruitmentFormLink,
  type SubmitRecruitmentForm,
  type UpdateRecruitmentForm,
} from '@ecms/contracts';
import { asyncHandler, created, ok, validate, validated } from '../../../../platform/web';
import { ErrorCodes } from '@ecms/contracts';
import { AppError, ValidationError } from '../../../../shared/errors';
import { authContext, authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { rateLimit } from '../../../../infrastructure/redis/rate-limiter';
import { recruitmentFormService } from './recruitment-form.service';

const getForm = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await recruitmentFormService.get());
};

const updateForm = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<UpdateRecruitmentForm>(req);
  ok(res, await recruitmentFormService.update(authContext(req), body));
};

const generateLink = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<GenerateRecruitmentFormLink>(req);
  ok(res, await recruitmentFormService.generateLink(authContext(req), body.sourceId));
};

const revokeLink = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, { sourceId: string }>(req);
  ok(res, await recruitmentFormService.revokeLink(authContext(req), params.sourceId));
};

export const buildRecruitmentFormRouter = (): Router => {
  const router = Router();
  // Reading the form is part of registering an applicant (the internal source lives on it), so it
  // rides on `applicant.view`; changing it is its own responsibility.
  router.get('/', authenticate, authorize('applicant.view'), asyncHandler(getForm));
  router.patch(
    '/',
    authenticate,
    authorize('recruitmentForm.manage'),
    validate({ body: UpdateRecruitmentFormSchema }),
    asyncHandler(updateForm),
  );
  router.post(
    '/links',
    authenticate,
    authorize('recruitmentForm.manage'),
    validate({ body: GenerateRecruitmentFormLinkSchema }),
    asyncHandler(generateLink),
  );
  // `validate` is not optional garnish here: `validated(req)` reads what this middleware puts on
  // the request, so a route that skips it hands the handler `undefined` and destructuring it
  // throws — a 500 on every call, which is exactly what revoking a link did.
  router.delete(
    '/links/:sourceId',
    authenticate,
    authorize('recruitmentForm.manage'),
    validate({ params: RecruitmentFormSourceParamSchema }),
    asyncHandler(revokeLink),
  );
  return router;
};

// ── Public ──────────────────────────────────────────────────────────────────

const getPublicForm = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, { token: string }>(req);
  ok(res, await recruitmentFormService.getPublic(params.token));
};

const submitPublicForm = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<SubmitRecruitmentForm, never, { token: string }>(req);
  ok(
    res,
    await recruitmentFormService.submit(params.token, body.answers, body.nationalIdCard, {
      heardFrom: body.heardFrom,
      documents: body.documents,
      cvFileId: body.cvFileId,
    }),
  );
};

/** A phone photo of a card is a few MB; the National-ID category's own cap (10 MB) is authoritative. */
const CARD_PHOTO_MAX_MB = 10;

const cardPhoto = (): RequestHandler => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: CARD_PHOTO_MAX_MB * 1024 * 1024, files: 1 },
  }).single('file');
  return (req: Request, res: Response, next: NextFunction): void => {
    upload(req, res, (error: unknown) => {
      if (error === undefined || error === null) {
        next();
        return;
      }
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        next(new AppError(ErrorCodes.FILE_TOO_LARGE, 422, `File exceeds the ${CARD_PHOTO_MAX_MB} MB cap`));
        return;
      }
      next(error);
    });
  };
};

const uploadPublicCardPhoto = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, { token: string }>(req);
  const file = req.file;
  if (file === undefined) {
    throw new ValidationError([
      { field: 'file', code: 'REQUIRED', message: 'multipart field "file" is required' },
    ]);
  }
  created(
    res,
    await recruitmentFormService.uploadCardPhoto(params.token, {
      originalName: file.originalname,
      mime: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    }),
  );
};

const uploadPublicCv = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, { token: string }>(req);
  const file = req.file;
  if (file === undefined) {
    throw new ValidationError([
      { field: 'file', code: 'REQUIRED', message: 'multipart field "file" is required' },
    ]);
  }
  created(
    res,
    await recruitmentFormService.uploadCv(params.token, {
      originalName: file.originalname,
      mime: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    }),
  );
};

export const buildPublicRecruitmentFormRouter = (): Router => {
  const router = Router();
  // No authenticate: the token IS the credential. Both endpoints are capped per IP — reading
  // generously (a candidate reloads), writing tightly (nobody applies twenty times an hour).
  router.get(
    '/:token',
    rateLimit({ name: 'apply-read', windowSeconds: 300, max: 60 }),
    validate({ params: RecruitmentFormTokenParamSchema }),
    asyncHandler(getPublicForm),
  );
  // The card photos, before the submission that names them. Capped like a submission, a little
  // looser: a candidate may retake a blurred photo a few times.
  router.post(
    '/:token/national-id-card',
    rateLimit({ name: 'apply-card', windowSeconds: 3600, max: 40 }),
    validate({ params: RecruitmentFormTokenParamSchema }),
    cardPhoto(),
    asyncHandler(uploadPublicCardPhoto),
  );
  router.post(
    '/:token/cv',
    rateLimit({ name: 'apply-cv', windowSeconds: 3600, max: 20 }),
    validate({ params: RecruitmentFormTokenParamSchema }),
    cardPhoto(),
    asyncHandler(uploadPublicCv),
  );
  router.post(
    '/:token',
    rateLimit({ name: 'apply-submit', windowSeconds: 3600, max: 20 }),
    validate({ body: SubmitRecruitmentFormSchema, params: RecruitmentFormTokenParamSchema }),
    asyncHandler(submitPublicForm),
  );
  return router;
};
