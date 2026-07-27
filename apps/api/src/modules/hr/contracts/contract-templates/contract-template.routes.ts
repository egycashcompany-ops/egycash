// Router: authenticate → authorize → validate → controller. Template administration is
// contractTemplate.manage; the variable catalog is also readable by contract.create
// (the create wizard shows it). Thin handlers live here — the feature is HTTP-mapping only.
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  CloneContractTemplateSchema,
  CreateContractTemplateSchema,
  ErrorCodes,
  UpdateContractBrandingSchema,
  UpdateContractTemplateSchema,
  objectId,
  type CloneContractTemplate,
  type CreateContractTemplate,
  type UpdateContractBranding,
  type UpdateContractTemplate,
} from '@ecms/contracts';
import { AppError, BusinessRuleError } from '../../../../shared/errors';
import { asyncHandler, created, ok, validate, validated } from '../../../../platform/web';
import { authContext, authenticate } from '../../../../platform/auth';
import { authorize, authorizeAny } from '../../../../platform/rbac';
import { contractBrandingService } from '../branding';
import { contractTemplateService } from './contract-template.service';

const IdParamSchema = z.object({ id: objectId() }).strict();
const KeyParamSchema = z.object({ key: z.string().min(1).max(100) }).strict();
const VersionBodySchema = z.object({ version: z.number().int().min(0) }).strict();

const LOGO_MAX_MB = 5;
const logoUpload = (): RequestHandler => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: LOGO_MAX_MB * 1024 * 1024, files: 1 },
  }).single('file');
  return (req: Request, res: Response, next: NextFunction): void => {
    upload(req, res, (error: unknown) => {
      if (error === undefined || error === null) {
        next();
        return;
      }
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        next(new AppError(ErrorCodes.FILE_TOO_LARGE, 422, `File exceeds the ${LOGO_MAX_MB} MB cap`));
        return;
      }
      next(error);
    });
  };
};

// ── A24 — branding profile handlers ─────────────────────────────────────────

const getBranding = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  ok(res, contractBrandingService.toDto(await contractBrandingService.get(ctx.userId)));
};

const updateBranding = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<UpdateContractBranding>(req);
  ok(res, contractBrandingService.toDto(await contractBrandingService.update(ctx, body)));
};

const uploadBrandingLogo = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const file = req.file;
  if (file === undefined) throw new BusinessRuleError('a file part named "file" is required');
  const doc = await contractBrandingService.uploadLogo(ctx, {
    originalName: file.originalname,
    mime: file.mimetype,
    size: file.size,
    buffer: file.buffer,
  });
  ok(res, contractBrandingService.toDto(doc));
};

const listTemplates = async (_req: Request, res: Response): Promise<void> => {
  const latest = await contractTemplateService.listLatest();
  ok(
    res,
    await Promise.all(
      latest.map(async (t) => {
        const dto = contractTemplateService.toDto(t);
        // Key-level annotation: which version the create wizard pins (published, A17).
        const published =
          t.status === 'published' ? t : await contractTemplateService.publishedOf(t.key);
        dto.publishedTemplateId = published === null ? null : String(published._id);
        dto.publishedTemplateVersion = published?.templateVersion ?? null;
        return dto;
      }),
    ),
  );
};

const listTemplateVersions = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, { key: string }>(req);
  ok(res, (await contractTemplateService.listVersions(params.key)).map((t) => contractTemplateService.toDto(t)));
};

const getTemplate = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, { id: string }>(req);
  ok(res, contractTemplateService.toDto(await contractTemplateService.getById(params.id)));
};

const createTemplate = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateContractTemplate>(req);
  const doc = await contractTemplateService.create(body, ctx.userId);
  created(res, contractTemplateService.toDto(doc), `/api/v1/hr/contract-templates/${String(doc._id)}`);
};

const updateTemplate = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateContractTemplate, never, { id: string }>(req);
  ok(res, contractTemplateService.toDto(await contractTemplateService.update(params.id, body, ctx.userId)));
};

const publishTemplate = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<{ version: number }, never, { id: string }>(req);
  ok(res, contractTemplateService.toDto(await contractTemplateService.publish(params.id, ctx.userId, body.version)));
};

const cloneTemplate = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<CloneContractTemplate, never, { id: string }>(req);
  const doc = await contractTemplateService.clone(params.id, body, ctx.userId);
  created(res, contractTemplateService.toDto(doc), `/api/v1/hr/contract-templates/${String(doc._id)}`);
};

const archiveTemplate = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<{ version: number }, never, { id: string }>(req);
  ok(res, contractTemplateService.toDto(await contractTemplateService.archive(params.id, ctx.userId, body.version)));
};

export const buildContractTemplatesRouter = (): Router => {
  const router = Router();
  const manage = [authenticate, authorize('contractTemplate.manage')] as const;
  // Reads are also open to contract users — the create wizard needs the template picker.
  const read = [authenticate, authorizeAny('contractTemplate.manage', 'contract.view')] as const;

  router.get('/', ...read, asyncHandler(listTemplates));
  // A24 — the branding profile (declared before '/:id').
  router.get('/branding', ...manage, asyncHandler(getBranding));
  router.patch(
    '/branding',
    ...manage,
    validate({ body: UpdateContractBrandingSchema }),
    asyncHandler(updateBranding),
  );
  router.post('/branding/logo', ...manage, logoUpload(), asyncHandler(uploadBrandingLogo));
  router.get(
    '/keys/:key/versions',
    ...manage,
    validate({ params: KeyParamSchema }),
    asyncHandler(listTemplateVersions),
  );
  router.get('/:id', ...read, validate({ params: IdParamSchema }), asyncHandler(getTemplate));
  router.post('/', ...manage, validate({ body: CreateContractTemplateSchema }), asyncHandler(createTemplate));
  router.patch(
    '/:id',
    ...manage,
    validate({ body: UpdateContractTemplateSchema, params: IdParamSchema }),
    asyncHandler(updateTemplate),
  );
  router.post(
    '/:id/publish',
    ...manage,
    validate({ body: VersionBodySchema, params: IdParamSchema }),
    asyncHandler(publishTemplate),
  );
  router.post(
    '/:id/clone',
    ...manage,
    validate({ body: CloneContractTemplateSchema, params: IdParamSchema }),
    asyncHandler(cloneTemplate),
  );
  router.post(
    '/:id/archive',
    ...manage,
    validate({ body: VersionBodySchema, params: IdParamSchema }),
    asyncHandler(archiveTemplate),
  );
  return router;
};
