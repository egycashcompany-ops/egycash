// Fleet catalog admin (design §2.10). Configuration, not domain facts: audited, no events.
import {
  parseFleetSort,
  type CreateFleetCatalogItem,
  type FleetCatalogKind,
  type OrderFleetCatalog,
  type ListFleetCatalogQuery,
  type Paginated,
  type UpdateFleetCatalogItem,
} from '@ecms/contracts';
import { ConflictError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetCatalogItemRepository } from './catalog-item.repository';
import { type FleetCatalogItemDoc } from './catalog-item.model';
import { withEnglishName } from './catalog-english';

/** The order a list currently reads in: its places first (unplaced read as last), then by name. */
const byCurrentOrder = (a: FleetCatalogItemDoc, b: FleetCatalogItemDoc): number =>
  (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
  a.name.ar.localeCompare(b.name.ar, 'ar');

const entityRef = (id: string) => ({
  moduleId: 'fleet',
  entityType: 'catalogItem',
  entityId: id,
});

const snapshot = (doc: FleetCatalogItemDoc) => ({
  kind: doc.kind,
  name: doc.name,
  countsForAlarm: doc.countsForAlarm,
  violationSide: doc.violationSide,
  licenseExpenseKind: doc.licenseExpenseKind ?? null,
  isActive: doc.isActive,
});

class FleetCatalogItemService {
  async create(input: CreateFleetCatalogItem, by: string): Promise<FleetCatalogItemDoc> {
    const existing = await fleetCatalogItemRepository.findByKindAndNameAr(
      input.kind,
      input.name.ar,
    );
    if (existing !== null) {
      throw new ConflictError(`"${input.name.ar}" already exists in ${input.kind}`);
    }
    const doc = await fleetCatalogItemRepository.create(
      {
        kind: input.kind,
        // An English half that still carries Arabic — an import knows one string per name and
        // sends it twice — is translated on the way in («ترجمهم انت»).
        name: withEnglishName(input.name),
        countsForAlarm: input.countsForAlarm,
        violationSide: input.violationSide ?? null,
        licenseExpenseKind: input.licenseExpenseKind ?? null,
        isActive: true,
        // A new item joins the END of a list somebody has arranged; an unarranged list stays by
        // name, so there is nothing to append to.
        sortOrder: await this.nextOrder(input.kind),
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

  /**
   * Idempotent create-if-missing for the boot seed, and for the go-live imports.
   *
   * `by` is optional because the BOOT has no author — nobody pressed anything — and `null` is the
   * honest record of that. An operator-run import does have one, and passing it makes those rows
   * attributable like every other row the same run writes; without it a catalog entry created
   * beside a fully-audited vehicle carries no author at all.
   */
  async ensure(
    input: CreateFleetCatalogItem,
    by: string | null = null,
  ): Promise<FleetCatalogItemDoc> {
    const existing = await fleetCatalogItemRepository.findByKindAndNameAr(
      input.kind,
      input.name.ar,
    );
    if (existing !== null) return existing;
    return fleetCatalogItemRepository.create(
      {
        kind: input.kind,
        // An English half that still carries Arabic — an import knows one string per name and
        // sends it twice — is translated on the way in («ترجمهم انت»).
        name: withEnglishName(input.name),
        countsForAlarm: input.countsForAlarm,
        violationSide: input.violationSide ?? null,
        licenseExpenseKind: input.licenseExpenseKind ?? null,
        isActive: true,
        // A new item joins the END of a list somebody has arranged; an unarranged list stays by
        // name, so there is nothing to append to.
        sortOrder: await this.nextOrder(input.kind),
      },
      { by },
    );
  }

  private async nextOrder(kind: FleetCatalogKind): Promise<number | null> {
    const max = await fleetCatalogItemRepository.maxOrder(kind);
    return max === null ? null : max + 1;
  }

  /**
   * «اقدر ارتبهم عن طريق الشد والترك» — save one list's order. The ids named come first, in the
   * order given; any item of the kind not named keeps its place after them, so a list filtered on
   * screen cannot lose the order of what it was not showing.
   */
  async order(input: OrderFleetCatalog, by: string): Promise<void> {
    const all = await fleetCatalogItemRepository.listKind(input.kind);
    const byId = new Map(all.map((item) => [String(item._id), item]));
    const stranger = input.ids.find((id) => !byId.has(id));
    if (stranger !== undefined) {
      throw new ConflictError(`${stranger} is not an item of ${input.kind}`);
    }
    const named = new Set(input.ids);
    const current = [...all].sort(byCurrentOrder);
    const ordered = [
      ...input.ids.map((id) => byId.get(id) as FleetCatalogItemDoc),
      ...current.filter((item) => !named.has(String(item._id))),
    ];
    await fleetCatalogItemRepository.writeOrder(
      ordered.map((item) => item._id),
      by,
    );
    const first = ordered[0];
    if (first === undefined) return;
    await auditService.record({
      entityRef: entityRef(String(first._id)),
      action: 'update',
      changes: [
        {
          field: `order.${input.kind}`,
          old: current.map((item) => item.name.ar),
          new: ordered.map((item) => item.name.ar),
        },
      ],
    });
  }

  async list(query: ListFleetCatalogQuery): Promise<Paginated<FleetCatalogItemDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.kind !== undefined) filter.kind = query.kind;
    if (query.violationSide !== undefined) filter.violationSide = query.violationSide;
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    return fleetCatalogItemRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      // …and the rest of the reader's order behind it. `sortBy` stays the first column
      // so nothing that only speaks the pagination contract is left sorting by nothing.
      // No order asked for: the list as it was ARRANGED, then by name for anything not yet placed.
      sorts:
        query.sort === undefined && query.sortBy === undefined
          ? [
              { by: 'sortOrder', dir: 'asc' },
              { by: 'name.ar', dir: 'asc' },
            ]
          : parseFleetSort(query.sort),
      sortableFields: ['createdAt', 'kind', 'name.ar', 'sortOrder'],
    });
  }

  async update(
    id: string,
    input: UpdateFleetCatalogItem,
    by: string,
  ): Promise<FleetCatalogItemDoc> {
    const before = await fleetCatalogItemRepository.getById(id);
    if (input.countsForAlarm === true && before.kind !== 'workType') {
      throw new ConflictError('only a workType can count for the maintenance alarm');
    }
    // Same shape of rule, same reason: a side on anything but a violation type would be a fact
    // no screen reads, and the update path must refuse it as firmly as creation does.
    if (input.violationSide !== undefined && before.kind !== 'violationType') {
      throw new ConflictError('only a violationType has a side');
    }
    // …and a memo on anything but a licensing-expenses item. Null is allowed anywhere: it is what
    // every other item already holds.
    if (
      input.licenseExpenseKind !== undefined &&
      input.licenseExpenseKind !== null &&
      before.kind !== 'licenseExpenseItem'
    ) {
      throw new ConflictError('only a licenseExpenseItem belongs to a licensing-expenses memo');
    }
    const set: Partial<FleetCatalogItemDoc> = {};
    if (input.name !== undefined) set.name = withEnglishName(input.name);
    if (input.countsForAlarm !== undefined) set.countsForAlarm = input.countsForAlarm;
    if (input.violationSide !== undefined) set.violationSide = input.violationSide;
    if (input.licenseExpenseKind !== undefined) set.licenseExpenseKind = input.licenseExpenseKind;
    if (input.isActive !== undefined) set.isActive = input.isActive;
    const updated = await fleetCatalogItemRepository.updateById(id, set, {
      by,
      version: input.version,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }
}

export const fleetCatalogItemService = new FleetCatalogItemService();
