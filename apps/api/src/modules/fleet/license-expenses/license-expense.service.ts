// «مصروفات التراخيص» — create, read, edit, soft-delete, and the set-up's signatures. Audited like
// every Fleet record.
import { Types, type FilterQuery } from 'mongoose';
import {
  type CreateFleetLicenseExpense,
  type FleetLicenseExpenseDto,
  type FleetLicenseExpenseItemChoice,
  type FleetLicenseExpensePart,
  type FleetLicenseExpensePartDto,
  type FleetLicenseExpenseSettingsDto,
  type FleetLicenseExpenseSignatures,
  type FleetLicenseExpenseTemplates,
  type ListFleetLicenseExpensesQuery,
  type Paginated,
  type SaveFleetLicenseExpenseSettings,
  type UpdateFleetLicenseExpense,
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

/** The items each memo offers: a side nobody chose is `null` — every item, as before. */
const itemsOf = (
  value: FleetLicenseExpenseItemChoice | null | undefined,
): FleetLicenseExpenseItemChoice => {
  const side = (ids: unknown): string[] | null =>
    Array.isArray(ids) ? ids.map((id) => String(id)) : null;
  return { renewal: side(value?.renewal), extension: side(value?.extension) };
};

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

/** The table's filters, as one database filter. */
const expenseFilter = async (
  query: ListFleetLicenseExpensesQuery,
): Promise<FilterQuery<FleetLicenseExpenseDoc>> => {
  const filter: FilterQuery<FleetLicenseExpenseDoc> = {};
  if (query.vehicleCodes !== undefined) {
    const ids = (await fleetVehicleRepository.idsByCodes(query.vehicleCodes)).map(
      (id) => new Types.ObjectId(id),
    );
    filter.$or = [
      { 'renewal.vehicles.vehicleId': { $in: ids } },
      { 'extension.vehicles.vehicleId': { $in: ids } },
    ];
  }
  if (query.kind !== undefined) filter[query.kind] = { $ne: null };
  if (query.from !== undefined || query.to !== undefined) {
    filter.date = {
      ...(query.from === undefined ? {} : { $gte: query.from }),
      ...(query.to === undefined ? {} : { $lt: dayAfter(query.to) }),
    };
  }
  return filter;
};

/** The registry's codes for a page of memos — one read, not one per car. */
const codesFor = async (docs: readonly FleetLicenseExpenseDoc[]): Promise<Map<string, string>> => {
  const ids = new Set<string>();
  for (const doc of docs) {
    for (const part of [doc.renewal, doc.extension]) {
      for (const v of part?.vehicles ?? []) if (v.vehicleId != null) ids.add(String(v.vehicleId));
    }
  }
  return fleetVehicleRepository.codesByIds([...ids]);
};

const partDto = (
  part: FleetLicenseExpensePartDoc | null | undefined,
  codes: Map<string, string>,
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
      };

export const toLicenseExpenseDto = (
  doc: FleetLicenseExpenseDoc,
  codes: Map<string, string> = new Map(),
): FleetLicenseExpenseDto => ({
  id: String(doc._id),
  date: doc.date.toISOString().slice(0, 10),
  renewal: partDto(doc.renewal, codes),
  extension: partDto(doc.extension, codes),
  signatures: signaturesOf(doc.signatures),
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

class FleetLicenseExpenseService {
  async list(query: ListFleetLicenseExpensesQuery): Promise<Paginated<FleetLicenseExpenseDto>> {
    const page = await fleetLicenseExpenseRepository.list({
      filter: await expenseFilter(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'date',
      sortDir: query.sortDir ?? 'desc',
      sortableFields: ['date', 'createdAt', 'updatedAt'],
    });
    const codes = await codesFor(page.items);
    return { ...page, items: page.items.map((doc) => toLicenseExpenseDto(doc, codes)) };
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
          items: itemsOf(null),
          version: null,
        }
      : {
          signatures: signaturesOf(doc.signatures),
          templates: templatesOf(doc.templates),
          items: itemsOf(doc.items),
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
    // …and so does the choice of items.
    const items = input.items ?? itemsOf(before?.items);
    const saved =
      before === null
        ? await fleetLicenseExpenseSettingsRepository.create(
            { key: SETTINGS_KEY, signatures: input.signatures, templates, items },
            { by },
          )
        : await fleetLicenseExpenseSettingsRepository.updateById(
            String(before._id),
            { signatures: input.signatures, templates, items },
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
              items: itemsOf(before.items),
            },
        {
          signatures: signaturesOf(saved.signatures),
          templates: templatesOf(saved.templates),
          items: itemsOf(saved.items),
        },
      ),
    });
    return {
      signatures: signaturesOf(saved.signatures),
      templates: templatesOf(saved.templates),
      items: itemsOf(saved.items),
      version: saved.__v,
    };
  }
}

export const fleetLicenseExpenseService = new FleetLicenseExpenseService();
