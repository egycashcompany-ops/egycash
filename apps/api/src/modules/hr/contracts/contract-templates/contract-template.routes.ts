// Router: authenticate → authorize → validate → controller. Template administration is
// contractTemplate.manage; the variable catalog is also readable by contract.create
// (the create wizard shows it). Thin handlers live here — the feature is HTTP-mapping only.
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  CloneContractTemplateSchema,
  CreateContractTemplateSchema,
  UpdateContractTemplateSchema,
  objectId,
  type CloneContractTemplate,
  type CreateContractTemplate,
  type UpdateContractTemplate,
} from '@ecms/contracts';
import { asyncHandler, created, ok, validate, validated } from '../../../../platform/web';
import { authContext, authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { contractTemplateService } from './contract-template.service';

const IdParamSchema = z.object({ id: objectId() }).strict();
const KeyParamSchema = z.object({ key: z.string().min(1).max(100) }).strict();
const VersionBodySchema = z.object({ version: z.number().int().min(0) }).strict();

const listTemplates = async (_req: Request, res: Response): Promise<void> => {
  ok(res, (await contractTemplateService.listLatest()).map((t) => contractTemplateService.toDto(t)));
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

  router.get('/', ...manage, asyncHandler(listTemplates));
  router.get(
    '/keys/:key/versions',
    ...manage,
    validate({ params: KeyParamSchema }),
    asyncHandler(listTemplateVersions),
  );
  router.get('/:id', ...manage, validate({ params: IdParamSchema }), asyncHandler(getTemplate));
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
