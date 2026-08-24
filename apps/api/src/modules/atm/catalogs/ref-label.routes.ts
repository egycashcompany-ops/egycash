// The two label lists behind /data_edit_atm's bank/area forms. Reads ride `atmMachine.view` (the
// open forms and pickers need them); mutations are the data-edit surface, `atmMachine.manage`.
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { CreateAtmRefLabelSchema, ListAtmRefLabelsQuerySchema, objectId } from '@ecms/contracts';
import { authenticate, authContext } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import {
  asyncHandler,
  created,
  noContent,
  okPage,
  validate,
  validated,
} from '../../../platform/web';
import { toAtmRefLabelDto } from '../atm.mappers';
import { ATM_REF_LABEL_KINDS, type AtmRefLabelKind } from './ref-label.model';
import { atmRefLabelService } from './ref-label.service';

import { type CreateAtmRefLabel, type ListAtmRefLabelsQuery } from '@ecms/contracts';

const KindParamSchema = z.object({ kind: z.enum(ATM_REF_LABEL_KINDS) }).strict();
const KindIdParamSchema = z.object({ kind: z.enum(ATM_REF_LABEL_KINDS), id: objectId() }).strict();

const listLabels = async (req: Request, res: Response): Promise<void> => {
  const { query, params } = validated<never, ListAtmRefLabelsQuery, { kind: AtmRefLabelKind }>(req);
  okPage(
    res,
    await atmRefLabelService.list(params.kind, query, authContext(req)),
    toAtmRefLabelDto,
  );
};

const createLabel = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<CreateAtmRefLabel, never, { kind: AtmRefLabelKind }>(req);
  created(
    res,
    toAtmRefLabelDto(await atmRefLabelService.create(params.kind, body, authContext(req))),
  );
};

const removeLabel = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, { kind: AtmRefLabelKind; id: string }>(req);
  await atmRefLabelService.remove(params.id, authContext(req));
  noContent(res);
};

export const buildAtmRefLabelsRouter = (): Router => {
  const router = Router();
  router.get(
    '/:kind',
    authenticate,
    authorize('atmMachine.view'),
    validate({ query: ListAtmRefLabelsQuerySchema, params: KindParamSchema }),
    asyncHandler(listLabels),
  );
  router.post(
    '/:kind',
    authenticate,
    authorize('atmMachine.manage'),
    validate({ body: CreateAtmRefLabelSchema, params: KindParamSchema }),
    asyncHandler(createLabel),
  );
  router.delete(
    '/:kind/:id',
    authenticate,
    authorize('atmMachine.manage'),
    validate({ params: KindIdParamSchema }),
    asyncHandler(removeLabel),
  );
  return router;
};
