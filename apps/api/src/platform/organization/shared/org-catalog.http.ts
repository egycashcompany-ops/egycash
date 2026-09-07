// Handler/router factory shared by the two org-unit catalogs — the same arrangement
// `org-unit.http.ts` gives the hierarchy, over one implementation.
//
// THE PERMISSIONS ARE THE UNIT'S OWN: `department.view`, `department.create` and so on. No
// `departmentCatalog.*` keys were invented, and that is a decision rather than a shortcut — the
// catalog is not a new authority, it is the same act of administering the company's departments
// carried out once instead of once per branch. Splitting the keys would hand somebody the power to
// add «العمليات» to a branch while forbidding them to say what «العمليات» is, which is not a
// separation anybody asked for and not one any screen could explain.
//
// The `/options` route is deliberately NOT here. The catalog's whole audience is the form that
// picks an entry, and that form is `department.create` territory; a caller who may create a
// department already holds `department.view`. When the UI phase proves otherwise this is where the
// exception goes, with the reason next to it.
import { Router, type Request, type Response } from 'express';
import { type ZodType } from 'zod';
import { ListOrgUnitsQuerySchema, objectId, type ListOrgUnitsQuery } from '@ecms/contracts';
import { z } from 'zod';
import { asyncHandler } from '../../../infrastructure/http/async-handler';
import { created, noContent, ok, okPage } from '../../../infrastructure/http/respond';
import { validate, validated } from '../../../infrastructure/http/validate';
import { scopeSelector } from '../../../shared/types';
import { authContext, authenticate } from '../../auth';
import { authorize } from '../../rbac';
import { type OrgCatalogDoc } from './org-catalog';
import { type OrgCatalogService } from './org-catalog.service';

const IdParamSchema = z.object({ id: objectId() }).strict();
type IdParam = z.infer<typeof IdParamSchema>;

export interface OrgCatalogHttpConfig<TDoc extends OrgCatalogDoc, TDto> {
  /** The UNIT's permission resource — `department`, `section` — never a catalog-only one. */
  resource: string;
  service: OrgCatalogService<TDoc>;
  toDto: (doc: TDoc) => TDto;
  createSchema: ZodType;
  updateSchema: ZodType;
  /** Narrow list results from validated query params (e.g. sections by their department entry). */
  listFilter?: (query: ListOrgUnitsQuery) => Record<string, unknown>;
  basePath: string;
}

export const makeOrgCatalogHandlers = <TDoc extends OrgCatalogDoc, TDto>(
  config: OrgCatalogHttpConfig<TDoc, TDto>,
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
      const { params } = validated<never, never, IdParam>(req);
      ok(res, config.toDto(await config.service.getById(params.id)));
    },
    create: async (req: Request, res: Response): Promise<void> => {
      const ctx = authContext(req);
      const { body } = validated<Record<string, unknown>>(req);
      const doc = await config.service.create(
        body as Parameters<OrgCatalogService<TDoc>['create']>[0],
        ctx.userId,
      );
      created(res, config.toDto(doc), `${config.basePath}/${String(doc._id)}`);
    },
    update: async (req: Request, res: Response): Promise<void> => {
      const ctx = authContext(req);
      const { body, params } = validated<Record<string, unknown>, never, IdParam>(req);
      const doc = await config.service.update(
        params.id,
        body as unknown as Parameters<OrgCatalogService<TDoc>['update']>[1],
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
  };
};

export const makeOrgCatalogRouter = <TDoc extends OrgCatalogDoc, TDto>(
  config: OrgCatalogHttpConfig<TDoc, TDto>,
  handlers: ReturnType<typeof makeOrgCatalogHandlers<TDoc, TDto>>,
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
