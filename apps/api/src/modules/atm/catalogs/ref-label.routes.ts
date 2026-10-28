// The two label lists behind /data_edit_atm's bank/area forms. Reads ride `atmMachine.view` (the
// open forms and pickers need them). Since the register controls which machines exist (D2,
// docs/12-planning/atm-efficiency-register.md §7.1), Operations add, rename and archive-toggle
// labels on their own keys — `atmRefLabel.create` / `atmRefLabel.edit`, or `atmMachine.manage` as
// before — and the service asks that the key reach the label's branch (DEC-29). Deleting a label
// stays `atmMachine.manage` only.
//
// DEC-38/39: Efficiency add AREAS from the register with the register keys they hold, so the add
// also opens to `atmRegister.create` / `.edit` (the service limits them to areas, in a branch they
// reach). `GET /options` is what the data-edit dialogs offer for one branch — any key of the page,
// reaching that branch — and is declared BEFORE `/:kind`, which would otherwise read it as a kind.
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  AtmRefLabelOptionsQuerySchema,
  CreateAtmRefLabelSchema,
  ListAtmRefLabelsQuerySchema,
  UpdateAtmRefLabelSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate, authContext } from '../../../platform/auth';
import { authorize, authorizeAny } from '../../../platform/rbac';
import {
  asyncHandler,
  created,
  noContent,
  ok,
  okPage,
  validate,
  validated,
} from '../../../platform/web';
import { toAtmRefLabelDto } from '../atm.mappers';
import { ATM_REF_LABEL_KINDS, type AtmRefLabelKind } from './ref-label.model';
import { ATM_REF_LABEL_OPTIONS_KEYS, atmRefLabelService } from './ref-label.service';

import {
  type AtmRefLabelOptionsQuery,
  type CreateAtmRefLabel,
  type ListAtmRefLabelsQuery,
  type UpdateAtmRefLabel,
} from '@ecms/contracts';

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

const labelOptions = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, AtmRefLabelOptionsQuery>(req);
  ok(res, await atmRefLabelService.options(query, authContext(req)));
};

const createLabel = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<CreateAtmRefLabel, never, { kind: AtmRefLabelKind }>(req);
  created(
    res,
    toAtmRefLabelDto(await atmRefLabelService.create(params.kind, body, authContext(req))),
  );
};

const updateLabel = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateAtmRefLabel, never, { id: string }>(req);
  ok(res, toAtmRefLabelDto(await atmRefLabelService.update(params.id, body, authContext(req))));
};

const removeLabel = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, { kind: AtmRefLabelKind; id: string }>(req);
  await atmRefLabelService.remove(params.id, authContext(req));
  noContent(res);
};

export const buildAtmRefLabelsRouter = (): Router => {
  const router = Router();
  router.get(
    '/options',
    authenticate,
    authorizeAny(...ATM_REF_LABEL_OPTIONS_KEYS),
    validate({ query: AtmRefLabelOptionsQuerySchema }),
    asyncHandler(labelOptions),
  );
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
    authorizeAny('atmRefLabel.create', 'atmMachine.manage', 'atmRegister.create', 'atmRegister.edit'),
    validate({ body: CreateAtmRefLabelSchema, params: KindParamSchema }),
    asyncHandler(createLabel),
  );
  router.patch(
    '/:kind/:id',
    authenticate,
    authorizeAny('atmRefLabel.edit', 'atmMachine.manage'),
    validate({ body: UpdateAtmRefLabelSchema, params: KindIdParamSchema }),
    asyncHandler(updateLabel),
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
