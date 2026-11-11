// Currency reference admin (Q33 NORMALIZE — the legacy data_lists singleton becomes entities).
// Audited, no events (fleet-catalog precedent).
//
// THE CATALOG'S ORDER (Round 8): «ترتيب العملات فى الجدول لما تظهر تكون على حسب ترتيبها ف شاشة البيانات
// المرجعية» and «اعملى فى شاشة البيانات المرجعية ان اقدر اعدل زى شاشة الحركة بالظبط» — the currencies
// are dragged into order on the reference-data screen exactly as Fleet's catalogs are
// (catalog-item.service.ts `order`), and every screen that lists currencies follows that order.
import {
  MAX_PAGE_SIZE,
  type CreateOperationsCurrency,
  type ListOperationsReferenceQuery,
  type OrderOperationsCurrencies,
  type Paginated,
  type UpdateOperationsCurrency,
} from '@ecms/contracts';
import { ConflictError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { diffChanges } from '../../../shared/utils/diff';
import { operationsCurrencyRepository } from './currency.repository';
import { type OperationsCurrencyDoc } from './currency.model';
import { containsText } from '../catalog-search';

const entityRef = (id: string) => ({
  moduleId: 'operations',
  entityType: 'currency',
  entityId: id,
});

const snapshot = (doc: OperationsCurrencyDoc) => ({
  code: doc.code,
  name: doc.name,
  legacyAliases: doc.legacyAliases,
  sortOrder: doc.sortOrder ?? null,
  isActive: doc.isActive,
});

/**
 * The catalog's order: its dragged places first (a currency nobody placed reads after every placed
 * one), then the CODE read numerically — '2' before '10', the way a person reads it, never the
 * text order that puts '10' first — then the name. Exported for its spec.
 */
export const byCatalogOrder = (a: OperationsCurrencyDoc, b: OperationsCurrencyDoc): number =>
  (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
  a.code.localeCompare(b.code, 'en', { numeric: true }) ||
  a.name.localeCompare(b.name, 'ar');

class OperationsCurrencyService {
  async create(input: CreateOperationsCurrency, by: string): Promise<OperationsCurrencyDoc> {
    const { sortOrder, ...fields } = input;
    const doc = await operationsCurrencyRepository.create(
      {
        ...fields,
        isActive: true,
        // A new currency joins the END of a list somebody has arranged; an unarranged list stays
        // unplaced, so there is nothing to append to — the Fleet catalogs' rule.
        sortOrder: sortOrder !== undefined ? sortOrder : await this.nextOrder(),
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return doc;
  }

  private async nextOrder(): Promise<number | null> {
    const max = await operationsCurrencyRepository.maxOrder();
    return max === null ? null : max + 1;
  }

  /**
   * The catalog — in ITS ORDER when no column is asked for (`byCatalogOrder`), which is what every
   * picker and the reference screen open with; by the column asked for otherwise.
   *
   * The default order is applied here, over the whole matching catalog, and the page cut after it:
   * a numeric-aware code is not a Mongo sort without a collation, and sorting one fetched page
   * would order a page, not the catalog. A catalog of currencies is a few dozen rows.
   */
  async list(query: ListOperationsReferenceQuery): Promise<Paginated<OperationsCurrencyDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.search !== undefined && query.search !== '') {
      filter.$or = [
        { code: containsText(query.search) },
        { name: containsText(query.search) },
      ];
    }
    if (query.sortBy === undefined) {
      const all = (await operationsCurrencyRepository.listAll(filter)).sort(byCatalogOrder);
      const pageSize = Math.min(query.pageSize, MAX_PAGE_SIZE);
      const page = Math.max(1, query.page);
      return {
        items: all.slice((page - 1) * pageSize, page * pageSize),
        meta: {
          page,
          pageSize,
          totalItems: all.length,
          totalPages: Math.max(1, Math.ceil(all.length / pageSize)),
        },
      };
    }
    return operationsCurrencyRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['code', 'name', 'sortOrder', 'createdAt'],
    });
  }

  /**
   * «زى شاشة الحركة بالظبط» — save the catalog's dragged order, Fleet's catalog `order` exactly. The
   * ids named come first, in the order given; every currency NOT named keeps its place after them,
   * so a list filtered on screen (a search, the active ones only) cannot lose the order of what it
   * was not showing. Archived currencies are part of the catalog and keep a place too.
   */
  async order(input: OrderOperationsCurrencies, by: string): Promise<void> {
    const all = await operationsCurrencyRepository.listAll();
    const byId = new Map(all.map((currency) => [String(currency._id), currency]));
    const stranger = input.ids.find((id) => !byId.has(id));
    if (stranger !== undefined) {
      throw new ConflictError(`${stranger} is not a currency of the catalog`);
    }
    const named = new Set(input.ids);
    const current = [...all].sort(byCatalogOrder);
    const ordered = [
      ...input.ids.map((id) => byId.get(id) as OperationsCurrencyDoc),
      ...current.filter((currency) => !named.has(String(currency._id))),
    ];
    await operationsCurrencyRepository.writeOrder(
      ordered.map((currency) => currency._id),
      by,
    );
    const first = ordered[0];
    if (first === undefined) return;
    // One audit row for the whole move, on the first currency — the Fleet catalogs' record of it.
    await auditService.record({
      entityRef: entityRef(String(first._id)),
      action: 'update',
      changes: [
        {
          field: 'order',
          old: current.map((currency) => currency.code),
          new: ordered.map((currency) => currency.code),
        },
      ],
    });
  }

  async update(
    id: string,
    input: UpdateOperationsCurrency,
    by: string,
  ): Promise<OperationsCurrencyDoc> {
    const before = await operationsCurrencyRepository.getById(id);
    const { version, ...fields } = input;
    const updated = await operationsCurrencyRepository.updateById(id, fields, { by, version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }
}

export const operationsCurrencyService = new OperationsCurrencyService();
