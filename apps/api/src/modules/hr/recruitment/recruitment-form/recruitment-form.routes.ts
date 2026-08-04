// Two routers with deliberately different postures.
//
// The ADMIN router is ordinary: authenticate, authorize, validate.
//
// The PUBLIC router is reachable by anyone with a link, so it is written to be boring on purpose —
// two endpoints, both keyed by an unguessable token, one of which does exactly one thing
// (register an applicant against that token's source). It is rate-limited per IP, it answers with
// the applicant's code and nothing else, and a wrong or revoked token is a flat 404 that says
// nothing about whether the form, the link or the source is the part that is missing.
import { Router, type Request, type Response } from 'express';
import {
  GenerateRecruitmentFormLinkSchema,
  RecruitmentFormTokenParamSchema,
  SubmitRecruitmentFormSchema,
  UpdateRecruitmentFormSchema,
  type GenerateRecruitmentFormLink,
  type SubmitRecruitmentForm,
  type UpdateRecruitmentForm,
} from '@ecms/contracts';
import { asyncHandler, ok, validate, validated } from '../../../../platform/web';
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
  router.delete(
    '/links/:sourceId',
    authenticate,
    authorize('recruitmentForm.manage'),
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
  ok(res, await recruitmentFormService.submit(params.token, body.answers));
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
  router.post(
    '/:token',
    rateLimit({ name: 'apply-submit', windowSeconds: 3600, max: 20 }),
    validate({ body: SubmitRecruitmentFormSchema, params: RecruitmentFormTokenParamSchema }),
    asyncHandler(submitPublicForm),
  );
  return router;
};
