// «أنواع التشغيل» reference admin (Round 20) — «انا عاوز النوع يكون بيضاف من البيانات المرجعيه».
// Built as the currencies are (currencies/currency.service.ts): audited, no events, a dragged order
// «زى شاشة الحركة بالظبط», archived rather than deleted.
import {
  MAX_PAGE_SIZE,
  type CreateOperationsShiftType,
  type ListOperationsReferenceQuery,
  type OperationsShiftTypeColour,
  type OrderOperationsShiftTypes,
  type Paginated,
  type UpdateOperationsShiftType,
} from '@ecms/contracts';
import { ConflictError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { logger } from '../../../infrastructure/logging/logger';
import { diffChanges } from '../../../shared/utils/diff';
import { containsText } from '../catalog-search';
import { OperationsShiftTypeModel, type OperationsShiftTypeDoc } from './shift-type.model';
import { operationsShiftTypeRepository } from './shift-type.repository';

const entityRef = (id: string) => ({
  moduleId: 'operations',
  entityType: 'shiftType',
  entityId: id,
});

const snapshot = (doc: OperationsShiftTypeDoc) => ({
  name: doc.name,
  nameEn: doc.nameEn,
  colour: doc.colour,
  sortOrder: doc.sortOrder ?? null,
  isActive: doc.isActive,
});

/**
 * The catalog's order: its dragged places first (an unplaced type reads after every placed one),
 * then the Arabic name. Exported for its spec.
 */
export const byShiftTypeOrder = (a: OperationsShiftTypeDoc, b: OperationsShiftTypeDoc): number =>
  (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
  a.name.localeCompare(b.name, 'ar');

/**
 * THE LEGACY NINE, in the legacy board's order (its «النوع» list: اختر، يومي، إحتياطى، إحتياطي سفر،
 * أسوان، إيباج، سفر، شلاتين، محصنة، مسائي — «اختر» is the empty choice, not a type). The colours are
 * the ones the approved sample wore. `key` is the seed's identity only — see `seedKey`.
 */
export const LEGACY_SHIFT_TYPES: readonly {
  key: string;
  name: string;
  nameEn: string;
  colour: OperationsShiftTypeColour;
}[] = [
  { key: 'daily', name: 'يومي', nameEn: 'Daily', colour: 'rose' },
  { key: 'reserve', name: 'احتياطي', nameEn: 'Reserve', colour: 'teal' },
  { key: 'reserveTravel', name: 'احتياطي سفر', nameEn: 'Travel reserve', colour: 'fuchsia' },
  { key: 'aswan', name: 'أسوان', nameEn: 'Aswan', colour: 'indigo' },
  { key: 'ebag', name: 'إيباج', nameEn: 'EBAG', colour: 'emerald' },
  { key: 'travel', name: 'سفر', nameEn: 'Travel', colour: 'orange' },
  { key: 'shalateen', name: 'شلاتين', nameEn: 'Shalateen', colour: 'amber' },
  { key: 'secured', name: 'محصنة', nameEn: 'Secured', colour: 'slate' },
  { key: 'evening', name: 'مسائي', nameEn: 'Evening', colour: 'violet' },
];

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/**
 * Boot step: the legacy nine, inserted ONCE and never overwritten — the applicant document types'
 * `ensureSeeded` and the ATM bank catalog's seed, the same two rules:
 *
 *   · KEYED BY `seedKey`, NOT BY NAME, and `$setOnInsert` only. A seeded type the owner renamed,
 *     recoloured, reordered or archived is the owner's now: a restart finds its key and writes
 *     nothing. The filter does not ask `isDeleted` either, so nothing the catalog ever held under
 *     a key is brought back.
 *   · AN E11000 IS SKIPPED, NOT FATAL. Two instances booting together race on `ux_seed_key`, and a
 *     type the owner added by hand under a legacy name holds `ux_name`; either way that one seed
 *     is not inserted, the boot logs it by key and goes on. The boot never fails on a catalog.
 *
 * The indexes are built first (`createIndexes` — `autoIndex` is off in production), so the unique
 * keys the two rules lean on exist before the first insert.
 */
export const seedOperationsShiftTypes = async (): Promise<{
  inserted: number;
  skipped: string[];
}> => {
  await OperationsShiftTypeModel.createIndexes();
  const result = { inserted: 0, skipped: [] as string[] };
  for (const [sortOrder, seed] of LEGACY_SHIFT_TYPES.entries()) {
    try {
      const write = await OperationsShiftTypeModel.updateOne(
        { seedKey: seed.key },
        {
          $setOnInsert: {
            name: seed.name,
            nameEn: seed.nameEn,
            colour: seed.colour,
            // Placed in the legacy order from the start, so the board's picker opens on it.
            sortOrder,
            isActive: true,
          },
        },
        { upsert: true, setDefaultsOnInsert: true },
      ).exec();
      result.inserted += write.upsertedCount;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      result.skipped.push(seed.key);
      logger.warn({ key: seed.key }, 'operations: shift type seed not inserted (duplicate key)');
    }
  }
  if (result.inserted > 0) {
    logger.info(
      { inserted: result.inserted },
      'operations: shift types seeded with the legacy list',
    );
  }
  return result;
};

class OperationsShiftTypeService {
  async create(input: CreateOperationsShiftType, by: string): Promise<OperationsShiftTypeDoc> {
    const { sortOrder, ...fields } = input;
    const doc = await operationsShiftTypeRepository.create(
      {
        ...fields,
        seedKey: null,
        isActive: true,
        // A new type joins the END of an arranged list; an unarranged one stays unplaced.
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
    const max = await operationsShiftTypeRepository.maxOrder();
    return max === null ? null : max + 1;
  }

  /**
   * The catalog — in ITS ORDER when no column is asked for (`byShiftTypeOrder`), the order the
   * board's picker and counts strip read in; by the column asked for otherwise. Archived types are
   * listed unless `isActive` narrows: a row may still carry one, and the board must name it.
   */
  async list(query: ListOperationsReferenceQuery): Promise<Paginated<OperationsShiftTypeDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.search !== undefined && query.search !== '') {
      filter.$or = [{ name: containsText(query.search) }, { nameEn: containsText(query.search) }];
    }
    if (query.sortBy === undefined) {
      const all = (await operationsShiftTypeRepository.listAll(filter)).sort(byShiftTypeOrder);
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
    return operationsShiftTypeRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['name', 'sortOrder', 'createdAt'],
    });
  }

  /** The currencies' `order`, exactly: named ids first, the rest after them in their old order. */
  async order(input: OrderOperationsShiftTypes, by: string): Promise<void> {
    const all = await operationsShiftTypeRepository.listAll();
    const byId = new Map(all.map((type) => [String(type._id), type]));
    const stranger = input.ids.find((id) => !byId.has(id));
    if (stranger !== undefined) {
      throw new ConflictError(`${stranger} is not a type of the catalog`);
    }
    const named = new Set(input.ids);
    const current = [...all].sort(byShiftTypeOrder);
    const ordered = [
      ...input.ids.map((id) => byId.get(id) as OperationsShiftTypeDoc),
      ...current.filter((type) => !named.has(String(type._id))),
    ];
    await operationsShiftTypeRepository.writeOrder(
      ordered.map((type) => type._id),
      by,
    );
    const first = ordered[0];
    if (first === undefined) return;
    await auditService.record({
      entityRef: entityRef(String(first._id)),
      action: 'update',
      changes: [
        {
          field: 'order',
          old: current.map((type) => type.name),
          new: ordered.map((type) => type.name),
        },
      ],
    });
  }

  async update(
    id: string,
    input: UpdateOperationsShiftType,
    by: string,
  ): Promise<OperationsShiftTypeDoc> {
    const before = await operationsShiftTypeRepository.getById(id);
    const { version, ...fields } = input;
    const updated = await operationsShiftTypeRepository.updateById(id, fields, { by, version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }
}

export const operationsShiftTypeService = new OperationsShiftTypeService();
