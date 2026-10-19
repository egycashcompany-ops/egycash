// «مصروفات التراخيص» — create, read, edit, soft-delete, and the set-up's signatures. Audited like
// every Fleet record.
import { Types, type FilterQuery } from 'mongoose';
import {
  FLEET_LICENSE_EXPENSE_KINDS,
  type CreateFleetLicenseExpense,
  type FleetLicenseExpenseDto,
  type FleetLicenseExpenseKind,
  type FleetLicenseExpensePart,
  type FleetLicenseExpensePartDto,
  type FleetLicenseExpenseSettleStatus,
  type FleetLicenseExpenseSettlementDto,
  type FleetLicenseExpenseSettingsDto,
  type FleetLicenseExpenseSignatures,
  type FleetLicenseExpenseSummaryQuery,
  type FleetLicenseExpenseTemplates,
  type FleetLicenseExpenseTotalsDto,
  type ListFleetLicenseExpensesQuery,
  type Paginated,
  type SaveFleetLicenseExpenseSettings,
  type UpdateFleetLicenseExpense,
  parseFleetSort,
} from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetLicenseExpenseRepository } from './license-expense.repository';
import { fleetLicenseExpenseSettingsRepository } from './license-expense-settings.repository';
import {
  type FleetLicenseExpenseDoc,
  type FleetLicenseExpensePartDoc,
} from './license-expense.model';
import { settlementField, settlementOf } from './license-expense-lock';

/** The names the department's own sheets carry — what the set-up starts from. */
export const DEFAULT_LICENSE_EXPENSE_SIGNATURES: FleetLicenseExpenseSignatures = {
  agent: 'طلعت جابر بحيري',
  director: 'عميد / إيهاب عبد السلام',
  generalManager:
    'لواء أ ح / جمال أحمد أبو إسماعيل\nالمدير العام التنفيذي\nشركة النيل لنقل الأموال (إيجي كاش)',
};

const SETTINGS_KEY = 'default';

/** No template saved yet: every group empty. */
const EMPTY_TEMPLATES: FleetLicenseExpenseTemplates = {
  renewal: { visa: [], cash: [] },
  extension: { visa: [], cash: [] },
};

const templatesOf = (
  value: FleetLicenseExpenseTemplates | null | undefined,
): FleetLicenseExpenseTemplates => ({
  renewal: { visa: value?.renewal?.visa ?? [], cash: value?.renewal?.cash ?? [] },
  extension: { visa: value?.extension?.visa ?? [], cash: value?.extension?.cash ?? [] },
});

/** The day after — a «to» date counts its whole day. */
const dayAfter = (day: Date): Date => new Date(day.getTime() + 24 * 60 * 60 * 1000);

const entityRef = (id: string) => ({
  moduleId: 'fleet',
  entityType: 'licenseExpense',
  entityId: id,
});

const idOrNull = (value: string | null): Types.ObjectId | null =>
  value === null ? null : new Types.ObjectId(value);
const stringOrNull = (value: Types.ObjectId | null | undefined): string | null =>
  value === null || value === undefined ? null : String(value);

const toPart = (part: FleetLicenseExpensePart | null): FleetLicenseExpensePartDoc | null =>
  part === null
    ? null
    : {
        vehicles: part.vehicles.map((v) => ({ vehicleId: idOrNull(v.vehicleId), plate: v.plate })),
        items: part.items.map((item) => ({
          itemId: idOrNull(item.itemId),
          label: item.label,
          amount: item.amount,
          count: item.count,
          paidBy: item.paidBy,
          receipt: item.receipt,
        })),
      };

const partSnapshot = (part: FleetLicenseExpensePartDoc | null | undefined) =>
  part == null
    ? null
    : {
        vehicles: part.vehicles.map((v) => ({
          vehicleId: stringOrNull(v.vehicleId),
          plate: v.plate,
        })),
        items: part.items.map((item) => ({
          itemId: stringOrNull(item.itemId),
          label: item.label,
          amount: item.amount ?? null,
          count: item.count,
          paidBy: item.paidBy,
          receipt: item.receipt,
        })),
      };

const signaturesOf = (
  value: Partial<FleetLicenseExpenseSignatures> | null | undefined,
): FleetLicenseExpenseSignatures => ({
  agent: value?.agent ?? '',
  director: value?.director ?? '',
  generalManager: value?.generalManager ?? '',
});

const snapshot = (doc: FleetLicenseExpenseDoc) => ({
  date: doc.date.toISOString(),
  renewal: partSnapshot(doc.renewal),
  extension: partSnapshot(doc.extension),
  signatures: signaturesOf(doc.signatures),
});

/**
 * «التسوية»: a memo settled, or present and still waiting. A missing settlement field matches
 * `null`, so a record from before settlements existed reads as waiting.
 */
const settledClause = (
  part: FleetLicenseExpenseKind,
  status: FleetLicenseExpenseSettleStatus,
): FilterQuery<FleetLicenseExpenseDoc> => ({
  [part]: { $ne: null },
  [settlementField(part)]: status === 'settled' ? { $ne: null } : null,
});

/**
 * With «النوع», that memo's own status. Without it, `waiting` is a record with any memo still
 * waiting and `settled` one with any memo settled — a half-settled record is both.
 */
const statusClause = (
  status: FleetLicenseExpenseSettleStatus,
  kind: FleetLicenseExpenseKind | undefined,
): FilterQuery<FleetLicenseExpenseDoc> =>
  kind !== undefined
    ? settledClause(kind, status)
    : { $or: FLEET_LICENSE_EXPENSE_KINDS.map((part) => settledClause(part, status)) };

/** The table's filters, as one database filter — the list's and its figures' alike. */
const expenseFilter = async (
  query: FleetLicenseExpenseSummaryQuery,
): Promise<FilterQuery<FleetLicenseExpenseDoc>> => {
  // One clause per filter, joined by `$and`: the cars and the status both need an `$or` of their
  // own, and two `$or` keys on one object would overwrite each other.
  const clauses: FilterQuery<FleetLicenseExpenseDoc>[] = [];
  if (query.vehicleCodes !== undefined) {
    const ids = (await fleetVehicleRepository.idsByCodes(query.vehicleCodes)).map(
      (id) => new Types.ObjectId(id),
    );
    clauses.push({
      $or: [
        { 'renewal.vehicles.vehicleId': { $in: ids } },
        { 'extension.vehicles.vehicleId': { $in: ids } },
      ],
    });
  }
  if (query.kind !== undefined) clauses.push({ [query.kind]: { $ne: null } });
  if (query.status !== undefined) clauses.push(statusClause(query.status, query.kind));
  if (query.from !== undefined || query.to !== undefined) {
    clauses.push({
      date: {
        ...(query.from === undefined ? {} : { $gte: query.from }),
        ...(query.to === undefined ? {} : { $lt: dayAfter(query.to) }),
      },
    });
  }
  if (clauses.length === 0) return {};
  return clauses.length === 1
    ? (clauses[0] as FilterQuery<FleetLicenseExpenseDoc>)
    : { $and: clauses };
};

/**
 * The registry's codes for a page of memos — one read, not one per car. Exported for «تسوية عهدة»,
 * which writes the codes onto its letter.
 */
export const codesFor = async (
  docs: readonly FleetLicenseExpenseDoc[],
): Promise<Map<string, string>> => {
  const ids = new Set<string>();
  for (const doc of docs) {
    for (const part of [doc.renewal, doc.extension]) {
      for (const v of part?.vehicles ?? []) if (v.vehicleId != null) ids.add(String(v.vehicleId));
    }
  }
  return fleetVehicleRepository.codesByIds([...ids]);
};

const settlementDto = (
  doc: FleetLicenseExpenseDoc,
  part: FleetLicenseExpenseKind,
): FleetLicenseExpenseSettlementDto | null => {
  const settlement = settlementOf(doc, part);
  return settlement === null
    ? null
    : {
        operationId: String(settlement.operationId),
        date: settlement.settledAt.toISOString().slice(0, 10),
      };
};

const partDto = (
  part: FleetLicenseExpensePartDoc | null | undefined,
  codes: Map<string, string>,
  settlement: FleetLicenseExpenseSettlementDto | null,
): FleetLicenseExpensePartDto | null =>
  part == null
    ? null
    : {
        vehicles: part.vehicles.map((v) => {
          const vehicleId = stringOrNull(v.vehicleId);
          return {
            vehicleId,
            code: vehicleId === null ? null : (codes.get(vehicleId) ?? null),
            plate: v.plate,
          };
        }),
        items: part.items.map((item) => ({
          itemId: stringOrNull(item.itemId),
          label: item.label,
          amount: item.amount ?? null,
          count: item.count,
          paidBy: item.paidBy,
          receipt: item.receipt,
        })),
        settlement,
      };

export const toLicenseExpenseDto = (
  doc: FleetLicenseExpenseDoc,
  codes: Map<string, string> = new Map(),
): FleetLicenseExpenseDto => ({
  id: String(doc._id),
  date: doc.date.toISOString().slice(0, 10),
  renewal: partDto(doc.renewal, codes, settlementDto(doc, 'renewal')),
  extension: partDto(doc.extension, codes, settlementDto(doc, 'extension')),
  signatures: signaturesOf(doc.signatures),
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

class FleetLicenseExpenseService {
  async list(query: ListFleetLicenseExpensesQuery): Promise<Paginated<FleetLicenseExpenseDto>> {
    const page = await fleetLicenseExpenseRepository.listExpenses({
      filter: await expenseFilter(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'date',
      sortDir: query.sortDir ?? 'desc',
      // «انا عاوز اقدر اعمل الاتنين مع بعض»: the arrows' whole order, as on every Fleet board.
      sorts: parseFleetSort(query.sort),
    });
    const codes = await codesFor(page.items);
    return { ...page, items: page.items.map((doc) => toLicenseExpenseDto(doc, codes)) };
  }

  /** «الإحصائيات» — over every memo the filters match, never the page on screen. */
  async summary(query: FleetLicenseExpenseSummaryQuery): Promise<FleetLicenseExpenseTotalsDto> {
    return fleetLicenseExpenseRepository.totals(await expenseFilter(query));
  }

  async get(id: string): Promise<FleetLicenseExpenseDto> {
    const doc = await fleetLicenseExpenseRepository.getById(id);
    return toLicenseExpenseDto(doc, await codesFor([doc]));
  }

  async create(input: CreateFleetLicenseExpense, by: string): Promise<FleetLicenseExpenseDto> {
    const doc = await fleetLicenseExpenseRepository.create(
      {
        date: input.date,
        renewal: toPart(input.renewal),
        extension: toPart(input.extension),
        signatures: input.signatures,
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return this.get(String(doc._id));
  }

  async update(
    id: string,
    input: UpdateFleetLicenseExpense,
    by: string,
  ): Promise<FleetLicenseExpenseDto> {
    const before = await fleetLicenseExpenseRepository.getById(id);
    // A record «تسوية عهدة» settled is refused INSIDE the write (the repository's
    // `writeConditions`) — 422, whatever the version — and a settlement that lands after this
    // read bumped the version, so the edit is told it is stale instead of overwriting it.
    const updated = await fleetLicenseExpenseRepository.updateById(
      id,
      {
        date: input.date,
        renewal: toPart(input.renewal),
        extension: toPart(input.extension),
        signatures: input.signatures,
      },
      { by, version: input.version },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return this.get(id);
  }

  async remove(id: string, by: string): Promise<void> {
    const before = await fleetLicenseExpenseRepository.getById(id);
    // Soft, and refused (422) for a settled record — atomically, by the repository's lock.
    await fleetLicenseExpenseRepository.softDeleteById(id, { by });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'delete',
      changes: diffChanges(snapshot(before), {}),
    });
  }

  // ── The set-up ──────────────────────────────────────────────────────────────────────────────

  async getSettings(): Promise<FleetLicenseExpenseSettingsDto> {
    const doc = await fleetLicenseExpenseSettingsRepository.findOne({ key: SETTINGS_KEY });
    return doc === null
      ? {
          signatures: DEFAULT_LICENSE_EXPENSE_SIGNATURES,
          templates: EMPTY_TEMPLATES,
          version: null,
        }
      : {
          signatures: signaturesOf(doc.signatures),
          templates: templatesOf(doc.templates),
          version: doc.__v,
        };
  }

  async saveSettings(
    input: SaveFleetLicenseExpenseSettings,
    by: string,
  ): Promise<FleetLicenseExpenseSettingsDto> {
    const before = await fleetLicenseExpenseSettingsRepository.findOne({ key: SETTINGS_KEY });
    // Templates left out of the request stay as they were.
    const templates = input.templates ?? templatesOf(before?.templates);
    const saved =
      before === null
        ? await fleetLicenseExpenseSettingsRepository.create(
            { key: SETTINGS_KEY, signatures: input.signatures, templates },
            { by },
          )
        : await fleetLicenseExpenseSettingsRepository.updateById(
            String(before._id),
            { signatures: input.signatures, templates },
            { by, version: input.version ?? before.__v },
          );
    await auditService.record({
      entityRef: {
        moduleId: 'fleet',
        entityType: 'licenseExpenseSettings',
        entityId: String(saved._id),
      },
      action: before === null ? 'create' : 'update',
      changes: diffChanges(
        before === null
          ? {}
          : {
              signatures: signaturesOf(before.signatures),
              templates: templatesOf(before.templates),
            },
        { signatures: signaturesOf(saved.signatures), templates: templatesOf(saved.templates) },
      ),
    });
    return {
      signatures: signaturesOf(saved.signatures),
      templates: templatesOf(saved.templates),
      version: saved.__v,
    };
  }
}

export const fleetLicenseExpenseService = new FleetLicenseExpenseService();
