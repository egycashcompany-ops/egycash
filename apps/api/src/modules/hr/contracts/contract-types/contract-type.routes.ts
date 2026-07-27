// Router: authenticate → authorize → validate → controller. Reading the catalog needs
// contract.view (the create wizard lists types); administration needs contractType.manage.
import { Router } from 'express';
import { type Request, type Response } from 'express';
import { z } from 'zod';
import {
  CreateContractTypeSchema,
  UpdateContractTypeSchema,
  objectId,
  type CreateContractType,
  type UpdateContractType,
} from '@ecms/contracts';
import { asyncHandler, created, ok, validate, validated } from '../../../../platform/web';
import { authContext, authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { contractTypeService } from './contract-type.service';

const IdParamSchema = z.object({ id: objectId() }).strict();

const listContractTypes = async (_req: Request, res: Response): Promise<void> => {
  ok(res, (await contractTypeService.listAll()).map((t) => contractTypeService.toDto(t)));
};

const createContractType = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateContractType>(req);
  const doc = await contractTypeService.create(body, ctx.userId);
  created(res, contractTypeService.toDto(doc), `/api/v1/hr/contract-types/${String(doc._id)}`);
};

const updateContractType = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateContractType, never, { id: string }>(req);
  ok(res, contractTypeService.toDto(await contractTypeService.update(params.id, body, ctx.userId)));
};

export const buildContractTypesRouter = (): Router => {
  const router = Router();
  router.get('/', authenticate, authorize('contract.view'), asyncHandler(listContractTypes));
  router.post(
    '/',
    authenticate,
    authorize('contractType.manage'),
    validate({ body: CreateContractTypeSchema }),
    asyncHandler(createContractType),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('contractType.manage'),
    validate({ body: UpdateContractTypeSchema, params: IdParamSchema }),
    asyncHandler(updateContractType),
  );
  return router;
};
