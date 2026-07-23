// Handler/router factory shared by the org-unit sub-features — each feature keeps
// the canonical controller/routes files, thin, over this one implementation.
import { Router } from 'express';
import { type Request, type Response } from 'express';
import { type ZodType } from 'zod';
import { ListOrgUnitsQuerySchema, objectId, type ListOrgUnitsQuery } from '@ecms/contracts';
import { z } from 'zod';
import { asyncHandler } from '../../../infrastructure/http/async-handler';
import { created, noContent, ok, okPage } from '../../../infrastructure/http/respond';
import { validate, validated } from '../../../infrastructure/http/validate';
import { scopeSelector } from '../../../shared/types';
import { authContext, authenticate } from '../../auth';
import { authorize } from '../../rbac';
import { type OrgUnitDoc, type OrgUnitService } from './org-unit';

const IdParamSchema = z.object({ id: objectId() }).strict();
type IdParam = z.infer<typeof IdParamSchema>;

export interface OrgUnitHttpConfig<TDoc extends OrgUnitDoc, TDto> {
  /** Permission resource, e.g. `branch` → `branch.view` etc. */
  resource: string;
  service: OrgUnitService<TDoc>;
  toDto: (doc: TDoc) => TDto;
  createSchema: ZodType;
  updateSchema: ZodType;
  /** Narrow list results from validated query params (e.g. departments by branchId). */
  listFilter?: (query: ListOrgUnitsQuery) => Record<string, unknown>;
  basePath: string;
}

export const makeOrgUnitHandlers = <TDoc extends OrgUnitDoc, TDto>(
  config: OrgUnitHttpConfig<TDoc, TDto>,
) => {
  const viewPermission = `${config.resource}.view`;
  return {
    list: async (req: Request, res: Response): Promise<void> => {
      const ctx = authContext(req);
      const { query } = validated<never, ListOrgUnitsQuery>(req);
      const extra = config.listFilter === undefined ? {} : config.listFilter(query);
      const page = await config.service.list(query, scopeSelector(ctx, viewPermission), extra);
      okPage(res, page, config.toDto);
    },
    get: async (req: Request, res: Response): Promise<void> => {
      const ctx = authContext(req);
      const { params } = validated<never, never, IdParam>(req);
      ok(
        res,
        config.toDto(await config.service.getById(params.id, scopeSelector(ctx, viewPermission))),
      );
    },
    create: async (req: Request, res: Response): Promise<void> => {
      const ctx = authContext(req);
      const { body } = validated<Record<string, unknown>>(req);
      const doc = await config.service.create(
        body as Parameters<OrgUnitService<TDoc>['create']>[0],
        ctx.userId,
      );
      created(res, config.toDto(doc), `${config.basePath}/${String(doc._id)}`);
    },
    update: async (req: Request, res: Response): Promise<void> => {
      const ctx = authContext(req);
      const { body, params } = validated<Record<string, unknown>, never, IdParam>(req);
      // Safe: `body` was parsed by the feature's UpdateSchema in the validate middleware.
      const doc = await config.service.update(
        params.id,
        body as unknown as Parameters<OrgUnitService<TDoc>['update']>[1],
        ctx.userId,
      );
      ok(res, config.toDto(doc));
    },
    remove: async (req: Request, res: Response): Promise<void> => {
      const ctx = authContext(req);
      const { params } = validated<never, never, IdParam>(req);
      await config.service.softDelete(params.id, ctx.userId);
      noContent(res);
    },
    // Reference options for form dropdowns — any authenticated user, decoupled from `<r>.view`.
    options: async (_req: Request, res: Response): Promise<void> => {
      ok(res, await config.service.options());
    },
  };
};

export const makeOrgUnitRouter = <TDoc extends OrgUnitDoc, TDto>(
  config: OrgUnitHttpConfig<TDoc, TDto>,
  handlers: ReturnType<typeof makeOrgUnitHandlers<TDoc, TDto>>,
): Router => {
  const router = Router();
  const r = config.resource;
  router.get(
    '/',
    authenticate,
    authorize(`${r}.view`),
    validate({ query: ListOrgUnitsQuerySchema }),
    asyncHandler(handlers.list),
  );
  // Reference options for form dropdowns (declared before `/:id`). Authenticated but NOT gated by
  // `<r>.view`, so a user who can create a Department/Section can still pick a Branch (bug fix).
  router.get('/options', authenticate, asyncHandler(handlers.options));
  router.get(
    '/:id',
    authenticate,
    authorize(`${r}.view`),
    validate({ params: IdParamSchema }),
    asyncHandler(handlers.get),
  );
  router.post(
    '/',
    authenticate,
    authorize(`${r}.create`),
    validate({ body: config.createSchema }),
    asyncHandler(handlers.create),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize(`${r}.edit`),
    validate({ body: config.updateSchema, params: IdParamSchema }),
    asyncHandler(handlers.update),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize(`${r}.delete`),
    validate({ params: IdParamSchema }),
    asyncHandler(handlers.remove),
  );
  return router;
};
