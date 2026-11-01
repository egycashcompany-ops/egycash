// «عقود توريد السيارات» — create, read, edit, soft-delete, and the deliveries («تسجيل استلام»).
// Every write is audited under the contract. The attachments are vehicle-contract-attachments.ts.
//
// WHAT IS ATOMIC WITH WHAT. A contract edit and every delivery write carry the contract's version,
// so «أكثر من المتبقي» (a delivery) and «أقل من المستلم» (a line edit), each checked on the version
// read, still hold when the write lands — two at once on one version: one wins, the other is a 409.
import { Types, type FilterQuery } from 'mongoose';
import {
  ErrorCodes,
  type ApiErrorDetail,
  type CreateFleetVehicleContract,
  type FleetVehicleContractDto,
  type FleetVehicleContractSummaryQuery,
  type FleetVehicleContractTotalsDto,
  type ListFleetVehicleContractsQuery,
  type Paginated,
  type SaveFleetVehicleContractDelivery,
  type UpdateFleetVehicleContract,
  parseFleetSort,
} from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { AppError, NotFoundError, StaleDocumentError } from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import { ensureCustodyCounter, nextCustodyNumber } from '../custody/custody-counter.model';
import { fleetVehicleTypeRepository } from '../vehicle-types/vehicle-type.repository';
import { toVehicleContractDto, typeNamesFor } from './vehicle-contract.dto';
import {
  dayAfter,
  dayKey,
  deliveryOver,
  lineEditRefusal,
  unknownDeliveryLines,
  utcDay,
  utcTodayYmd,
} from './vehicle-contract.figures';
import {
  type FleetVehicleContractDeliveryDoc,
  type FleetVehicleContractDoc,
  type FleetVehicleContractLineDoc,
} from './vehicle-contract.model';
import { alarmClause, fleetVehicleContractRepository } from './vehicle-contract.repository';

/** The contracts' running number in `fleet_custody_counters` — one new document, nothing shared. */
export const VEHICLE_CONTRACT_COUNTER = 'vehicleContract';

const entityRef = (id: string) => ({
  moduleId: 'fleet',
  entityType: 'vehicleContract',
  entityId: id,
});

const repo = fleetVehicleContractRepository;

/** 422 with a detail per field the rule refused — the screen names each. */
export const refused = (message: string, details: ApiErrorDetail[]): AppError =>
  new AppError(ErrorCodes.BUSINESS_RULE_VIOLATION, 422, message, { details });

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id.toLowerCase());

const snapshot = (doc: FleetVehicleContractDoc) => ({
  no: doc.no,
  name: doc.name,
  date: dayKey(doc.date),
  deadline: doc.deadline == null ? null : dayKey(doc.deadline),
  supplier: doc.supplier,
  lines: doc.lines.map((line) => ({
    id: String(line._id),
    typeId: String(line.typeId),
    count: line.count,
    unitPrice: line.unitPrice ?? null,
  })),
});

const deliverySnapshot = (delivery: Pick<FleetVehicleContractDeliveryDoc, 'date' | 'counts'>) => ({
  date: dayKey(delivery.date),
  counts: delivery.counts.map((entry) => ({ lineId: String(entry.lineId), count: entry.count })),
});

/** The list's filters as one database filter — the list's and its figures' alike. */
const contractFilter = (
  query: FleetVehicleContractSummaryQuery,
  today: Date,
): FilterQuery<FleetVehicleContractDoc> => {
  const clauses: FilterQuery<FleetVehicleContractDoc>[] = [];
  if (query.from !== undefined || query.to !== undefined) {
    clauses.push({
      date: {
        ...(query.from === undefined ? {} : { $gte: utcDay(query.from) }),
        ...(query.to === undefined ? {} : { $lt: dayAfter(query.to) }),
      },
    });
  }
  if (query.suppliers !== undefined) clauses.push({ supplier: { $in: query.suppliers } });
  if (query.typeIds !== undefined)
    clauses.push({ 'lines.typeId': { $in: query.typeIds.map(oid) } });
  if (query.alarm !== undefined) clauses.push(alarmClause(query.alarm, today));
  if (clauses.length === 0) return {};
  return clauses.length === 1
    ? (clauses[0] as FilterQuery<FleetVehicleContractDoc>)
    : { $and: clauses };
};

/** Every make a line newly names must exist and be active. */
const assertActiveTypes = async (
  lines: readonly { typeId: string }[],
  checked: (index: number) => boolean,
): Promise<void> => {
  const details: ApiErrorDetail[] = [];
  const wanted = lines.flatMap((line, index) =>
    checked(index) ? [{ index, typeId: line.typeId }] : [],
  );
  const found = await fleetVehicleTypeRepository.findByIdsSystem(
    wanted.map((entry) => entry.typeId),
  );
  const active = new Set(
    found.filter((type) => !type.isDeleted && type.isActive).map((type) => String(type._id)),
  );
  for (const { index, typeId } of wanted) {
    if (!active.has(typeId.toLowerCase())) {
      details.push({
        field: `lines.${index}.typeId`,
        code: 'INACTIVE_TYPE',
        message: 'this make is not an active vehicle type',
      });
    }
  }
  if (details.length > 0) throw refused('a line names a make that cannot be used', details);
};

const assertVersion = (doc: FleetVehicleContractDoc, version: number): void => {
  if (doc.__v !== version) throw new StaleDocumentError();
};

/** A delivery's counts, refused per line when unknown or over what is still owed. */
const checkedCounts = (
  doc: FleetVehicleContractDoc,
  input: SaveFleetVehicleContractDelivery,
  exceptDeliveryId?: string,
): FleetVehicleContractDeliveryDoc['counts'] => {
  const unknown = unknownDeliveryLines(doc, input.counts);
  if (unknown.length > 0)
    throw refused('a count names a line this contract does not hold', unknown);
  const over = deliveryOver(doc, input.counts, exceptDeliveryId);
  if (over.length > 0) {
    throw refused(
      'a count is more than the cars still owed on its line',
      over.map((entry) => ({
        field: `counts.${entry.index}.count`,
        code: 'OVER_REMAINING',
        message: `only ${entry.left} cars are still owed on this line`,
      })),
    );
  }
  return input.counts
    .filter((entry) => entry.count > 0)
    .map((entry) => ({ lineId: oid(entry.lineId), count: entry.count }));
};

class FleetVehicleContractService {
  private async dto(doc: FleetVehicleContractDoc, now: Date): Promise<FleetVehicleContractDto> {
    return toVehicleContractDto(doc, await typeNamesFor([doc]), utcTodayYmd(now));
  }

  async list(
    query: ListFleetVehicleContractsQuery,
    now: Date,
  ): Promise<Paginated<FleetVehicleContractDto>> {
    const today = utcDay(now);
    const page = await repo.listContracts(
      {
        filter: contractFilter(query, today),
        page: query.page,
        pageSize: query.pageSize,
        sortBy: query.sortBy ?? 'date',
        sortDir: query.sortDir ?? 'desc',
        sorts: parseFleetSort(query.sort),
      },
      today,
    );
    const names = await typeNamesFor(page.items);
    const todayYmd = utcTodayYmd(now);
    return { ...page, items: page.items.map((doc) => toVehicleContractDto(doc, names, todayYmd)) };
  }

  /** «الإحصائيات» — over every contract the filters match, never the page on screen. */
  async summary(
    query: FleetVehicleContractSummaryQuery,
    now: Date,
  ): Promise<FleetVehicleContractTotalsDto> {
    return repo.totals(contractFilter(query, utcDay(now)));
  }

  async suppliers(): Promise<string[]> {
    return repo.suppliers();
  }

  async get(id: string, now: Date): Promise<FleetVehicleContractDto> {
    return this.dto(await repo.getById(id), now);
  }

  async create(input: CreateFleetVehicleContract, by: string): Promise<FleetVehicleContractDto> {
    await assertActiveTypes(input.lines, () => true);
    // Outside the transaction, as custody's memos: the counter never starts below a used number.
    await ensureCustodyCounter(VEHICLE_CONTRACT_COUNTER, await repo.maxNo());
    const doc = await unitOfWork(async (session) => {
      const no = await nextCustodyNumber(VEHICLE_CONTRACT_COUNTER, session);
      return repo.create(
        {
          no,
          name: input.name,
          date: utcDay(input.date),
          deadline: input.deadline === null ? null : utcDay(input.deadline),
          supplier: input.supplier,
          lines: input.lines.map((line) => ({
            _id: new Types.ObjectId(),
            typeId: oid(line.typeId),
            count: line.count,
            unitPrice: line.unitPrice,
          })),
          deliveries: [],
          files: [],
        },
        { by, session },
      );
    });
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return this.dto(doc, new Date());
  }

  /** The whole contract again. Deliveries and attachments are never touched by an edit. */
  async update(
    id: string,
    input: UpdateFleetVehicleContract,
    by: string,
  ): Promise<FleetVehicleContractDto> {
    const before = await repo.getById(id);
    assertVersion(before, input.version);
    const refusals = lineEditRefusal(before, input.lines);
    if (refusals.length > 0) throw refused('the lines cannot change this way', refusals);
    const saved = new Map(before.lines.map((line) => [String(line._id), line]));
    // A make is checked when it is new to its line; a kept line's retired make stays as it was.
    await assertActiveTypes(input.lines, (index) => {
      const line = input.lines[index];
      const own = line?.id == null ? undefined : saved.get(line.id.toLowerCase());
      return own === undefined || String(own.typeId) !== line?.typeId.toLowerCase();
    });
    const lines: FleetVehicleContractLineDoc[] = input.lines.map((line) => ({
      _id: line.id === null ? new Types.ObjectId() : oid(line.id),
      typeId: oid(line.typeId),
      count: line.count,
      unitPrice: line.unitPrice,
    }));
    const updated = await repo.updateById(
      id,
      {
        name: input.name,
        date: utcDay(input.date),
        deadline: input.deadline === null ? null : utcDay(input.deadline),
        supplier: input.supplier,
        lines,
      },
      { by, version: input.version },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return this.dto(updated, new Date());
  }

  /** Soft: the contract, its deliveries and its attachments stay in place, hidden with it. */
  async remove(id: string, by: string): Promise<void> {
    const before = await repo.getById(id);
    await repo.softDeleteById(id, { by });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'delete',
      changes: diffChanges(snapshot(before), {}),
    });
  }

  // ── «تسجيل استلام» ──────────────────────────────────────────────────────────────────────────

  async addDelivery(
    id: string,
    input: SaveFleetVehicleContractDelivery,
    by: string,
  ): Promise<FleetVehicleContractDto> {
    const before = await repo.getById(id);
    assertVersion(before, input.version);
    const counts = checkedCounts(before, input);
    const now = new Date();
    const who = oid(by);
    const delivery: FleetVehicleContractDeliveryDoc = {
      _id: new Types.ObjectId(),
      date: utcDay(input.date),
      counts,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      createdAt: now,
      createdBy: who,
      updatedAt: now,
      updatedBy: who,
    };
    const updated = await repo.pushDelivery(id, input.version, delivery, by);
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        { field: `deliveries.${String(delivery._id)}`, old: null, new: deliverySnapshot(delivery) },
      ],
    });
    return this.dto(updated, now);
  }

  async updateDelivery(
    id: string,
    deliveryId: string,
    input: SaveFleetVehicleContractDelivery,
    by: string,
  ): Promise<FleetVehicleContractDto> {
    const before = await repo.getById(id);
    const own = before.deliveries.find(
      (delivery) =>
        String(delivery._id) === deliveryId.toLowerCase() && delivery.isDeleted !== true,
    );
    if (own === undefined) throw new NotFoundError('this contract has no such delivery');
    assertVersion(before, input.version);
    const counts = checkedCounts(before, input, deliveryId);
    const now = new Date();
    const change = { date: utcDay(input.date), counts, updatedAt: now, updatedBy: oid(by) };
    const updated = await repo.replaceDelivery(id, input.version, deliveryId, change, by);
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        {
          field: `deliveries.${deliveryId.toLowerCase()}`,
          old: deliverySnapshot(own),
          new: deliverySnapshot(change),
        },
      ],
    });
    return this.dto(updated, now);
  }

  /** Soft: the delivery stays in the document, hidden; its cars return to «المتبقي». */
  async removeDelivery(
    id: string,
    deliveryId: string,
    by: string,
  ): Promise<FleetVehicleContractDto> {
    const before = await repo.getById(id);
    const own = before.deliveries.find(
      (delivery) =>
        String(delivery._id) === deliveryId.toLowerCase() && delivery.isDeleted !== true,
    );
    const updated = own === undefined ? null : await repo.softDeleteDelivery(id, deliveryId, by);
    if (own === undefined || updated === null) {
      await repo.getById(id); // 404 for the contract first, when it went meanwhile
      throw new NotFoundError('this contract has no such delivery');
    }
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        { field: `deliveries.${deliveryId.toLowerCase()}`, old: deliverySnapshot(own), new: null },
      ],
    });
    return this.dto(updated, new Date());
  }
}

export const fleetVehicleContractService = new FleetVehicleContractService();
