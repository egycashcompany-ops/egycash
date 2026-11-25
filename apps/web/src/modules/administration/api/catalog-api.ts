// The catalog's calls (ADR-013): units of measure, item categories and the items that name them —
// one typed function per endpoint `apps/api/src/modules/administration/catalog/*` serves, and
// nothing else. No delete exists: a row retires with `isActive: false` on its PATCH (§5.3).
import {
  MAX_PAGE_SIZE,
  type AdministrationCatalogItemDto,
  type AdministrationItemCategoryDto,
  type AdministrationItemDto,
  type CreateAdministrationCatalogItem,
  type CreateAdministrationItemCategory,
  type CreateAdministrationItemInput,
  type Paginated,
  type UpdateAdministrationCatalogItem,
  type UpdateAdministrationItem,
  type UpdateAdministrationItemCategory,
} from '@ecms/contracts';
import {
  buildQuery,
  get,
  getPage,
  patch,
  post,
  type QueryParams,
} from '../../../shared/lib/api-client';

export type AdministrationListParams = QueryParams;

// ── Units — `administration_catalog_items`, kind `unit` ─────────────────────

export const listUnits = (
  params: AdministrationListParams,
): Promise<Paginated<AdministrationCatalogItemDto>> =>
  getPage<AdministrationCatalogItemDto>(
    `/administration/catalog-items${buildQuery({ ...params, kind: 'unit' })}`,
  );

export const createUnit = (
  body: Omit<CreateAdministrationCatalogItem, 'kind'>,
): Promise<AdministrationCatalogItemDto> =>
  post<AdministrationCatalogItemDto>('/administration/catalog-items', { kind: 'unit', ...body });

export const updateUnit = (
  id: string,
  body: UpdateAdministrationCatalogItem,
): Promise<AdministrationCatalogItemDto> =>
  patch<AdministrationCatalogItemDto>(`/administration/catalog-items/${id}`, body);

// ── Item categories ─────────────────────────────────────────────────────────

export const listCategories = (
  params: AdministrationListParams,
): Promise<Paginated<AdministrationItemCategoryDto>> =>
  getPage<AdministrationItemCategoryDto>(`/administration/item-categories${buildQuery(params)}`);

export const createCategory = (
  body: CreateAdministrationItemCategory,
): Promise<AdministrationItemCategoryDto> =>
  post<AdministrationItemCategoryDto>('/administration/item-categories', body);

export const updateCategory = (
  id: string,
  body: UpdateAdministrationItemCategory,
): Promise<AdministrationItemCategoryDto> =>
  patch<AdministrationItemCategoryDto>(`/administration/item-categories/${id}`, body);

// ── Items ───────────────────────────────────────────────────────────────────

export const listItems = (
  params: AdministrationListParams,
): Promise<Paginated<AdministrationItemDto>> =>
  getPage<AdministrationItemDto>(`/administration/items${buildQuery(params)}`);

/** One item, retired or not — the record page and the resolve-by-id half of ADR-019 rule 5. */
export const getItem = (id: string): Promise<AdministrationItemDto> =>
  get<AdministrationItemDto>(`/administration/items/${id}`);

export const createItem = (body: CreateAdministrationItemInput): Promise<AdministrationItemDto> =>
  post<AdministrationItemDto>('/administration/items', body);

export const updateItem = (
  id: string,
  body: UpdateAdministrationItem,
): Promise<AdministrationItemDto> =>
  patch<AdministrationItemDto>(`/administration/items/${id}`, body);

// ── A catalog read whole ────────────────────────────────────────────────────

/**
 * A hard stop on the pages one catalog may cost: a server reporting a nonsensical `totalPages`
 * cannot turn a select into an unbounded loop. Twenty thousand rows is past any list a select holds.
 */
export const MAX_WHOLE_PAGES = 200;

/**
 * Every row of a catalog, however many pages it takes. A select offers the whole list, and an id
 * the page names is resolved through it; `MAX_PAGE_SIZE` is the server's cap, so one page would cut
 * a list past a hundred rows silently (Fleet's `whole-catalog.ts` reason, rebuilt here rather than
 * imported — no module imports another).
 */
export const readWhole = async <T>(
  read: (params: AdministrationListParams) => Promise<Paginated<T>>,
  params: AdministrationListParams = {},
): Promise<T[]> => {
  const first = await read({
    ...params,
    page: 1,
    pageSize: MAX_PAGE_SIZE,
    sortBy: 'sortOrder',
    sortDir: 'asc',
  });
  const pages = Math.min(first.meta.totalPages, MAX_WHOLE_PAGES);
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, index) =>
      read({
        ...params,
        page: index + 2,
        pageSize: MAX_PAGE_SIZE,
        sortBy: 'sortOrder',
        sortDir: 'asc',
      }),
    ),
  );
  return [first, ...rest].flatMap((page) => page.items);
};
