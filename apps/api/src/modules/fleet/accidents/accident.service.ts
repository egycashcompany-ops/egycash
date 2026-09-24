// Accidents (fleet design §4.6, FR-10). Single-document writes: repository write → audit →
// event, the FL-2 commit-point pattern. Status flips both ways — the legacy toggled freely and
// the design keeps that — but a no-op flip is refused, so every published event is a real change.
// Recording is allowed against ANY registered vehicle including a disposed one: an accident is
// historical paperwork about the day it happened, not a new operational fact about the car.
import {
  FleetEvents,
  parseFleetSort,
  type CreateFleetAccident,
  type FleetAccidentCarTransfersDto,
  type FleetAccidentSummaryQuery,
  type FleetAccidentTotalsDto,
  type FleetAccidentTransferEntryDto,
  type FleetAccidentTransferInput,
  type ListFleetAccidentsQuery,
  type Paginated,
  type SetFleetAccidentStatus,
  type UpdateFleetAccident,
} from '@ecms/contracts';
import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { userService } from '../../../platform/users';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetAccidentRepository } from './accident.repository';
import { vehicleIdOf } from '../fleet.mappers';
import { type FleetAccidentDoc, type FleetAccidentTransfer } from './accident.model';
import {
  addMoney,
  allocateTransfer,
  carRemaining,
  liveTransfers,
  sumLive,
  toPiastres,
  toPounds,
} from './accident-transfer';

const entityRef = (id: string) => ({ moduleId: 'fleet', entityType: 'accident', entityId: id });

const snapshot = (doc: FleetAccidentDoc) => ({
  vehicleId: vehicleIdOf(doc),
  occurredAt: doc.occurredAt,
  culprit: doc.culprit,
  culpritEmployeeId: doc.culpritEmployeeId === null ? null : String(doc.culpritEmployeeId),
  statement: doc.statement,
  companyCost: doc.companyCost,
  amountCollected: doc.amountCollected,
  paidAmount: doc.paidAmount,
  // What transfers moved in and out — so the trail explains a remaining that changed while none
  // of the three facts did.
  transferredIn: doc.transferredIn ?? 0,
  transferredOut: doc.transferredOut ?? 0,
  status: doc.status,
  notes: doc.notes,
});

/** An audit to record once the transaction has committed — `auditService` cannot join one. */
interface PendingAudit {
  id: string;
  action: 'create' | 'update' | 'delete';
  before: FleetAccidentDoc | null;
  after: FleetAccidentDoc | null;
}

/** A source file's cached `transferredOut`, moved by a line: `after` is what gets written. */
type OutDeltas = Map<string, number>;

const addDelta = (deltas: OutDeltas, accidentId: Types.ObjectId, amount: number): void => {
  const key = String(accidentId);
  deltas.set(key, addMoney(deltas.get(key) ?? 0, amount));
};

/** The whole of a transfer, stopped: it stays on the file and no figure counts it any more. */
const voided = (
  transfer: FleetAccidentTransfer,
  by: string,
  reason: 'removed' | 'fileDeleted',
): FleetAccidentTransfer => ({
  ...transfer,
  voidedAt: new Date(),
  voidedBy: new Types.ObjectId(by),
  voidReason: reason,
});

/** «بواسطة» — the recorder's name as it reads today, kept on the transfer. */
const nameOf = async (by: string): Promise<string | null> => {
  const user = await userService.findByIdSystem(by);
  if (user === null) return null;
  const name = [user.profile.firstName.ar, user.profile.lastName.ar]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' ');
  return name === '' ? null : name;
};

const eventPayload = (doc: FleetAccidentDoc, code: string) => ({
  accidentId: String(doc._id),
  vehicleId: vehicleIdOf(doc),
  code,
  companyCost: doc.companyCost,
  amountCollected: doc.amountCollected,
  paidAmount: doc.paidAmount,
});

class FleetAccidentService {
  /**
   * Plan one transfer onto a file of `receivingVehicleId`: read the source car's files INSIDE the
   * transaction, refuse more than it has, and say which of its files give what — oldest first.
   */
  private async planTransfer(
    input: FleetAccidentTransferInput,
    receivingVehicleId: string | null,
    by: string,
    byName: string | null,
    session: ClientSession,
  ): Promise<{ transfer: FleetAccidentTransfer; out: OutDeltas }> {
    if (receivingVehicleId === null) {
      throw new BusinessRuleError('a file with no registry car cannot receive a transfer');
    }
    if (input.fromVehicleId === receivingVehicleId) {
      throw new BusinessRuleError('a car cannot take from its own remaining');
    }
    const source = await fleetVehicleRepository.getById(input.fromVehicleId);
    // The lock FIRST, then the read it protects — see `lockForAccidentTransfer`.
    await fleetVehicleRepository.lockForAccidentTransfer(String(source._id), session);
    const files = await fleetAccidentRepository.liveOfCar(String(source._id), source.code, session);
    const allocation = allocateTransfer(files, input.amount);
    if (!allocation.ok) {
      throw new BusinessRuleError(
        `car ${source.code} has ${allocation.available.toFixed(2)} remaining — ${input.amount.toFixed(2)} is more than that`,
      );
    }
    const out: OutDeltas = new Map();
    for (const line of allocation.lines) addDelta(out, line.accidentId, line.amount);
    return {
      transfer: {
        _id: new Types.ObjectId(),
        fromVehicleId: source._id,
        fromVehicleCode: source.code,
        amount: toPounds(toPiastres(input.amount)),
        lines: allocation.lines,
        at: new Date(),
        by: new Types.ObjectId(by),
        byName,
        voidedAt: null,
        voidedBy: null,
        voidReason: null,
      },
      out,
    };
  }

  /**
   * Move the source files' `transferredOut` by `deltas`, reading each inside the transaction.
   * Returns the audits: each file's figure before and after.
   */
  private async applyOut(
    deltas: OutDeltas,
    by: string,
    session: ClientSession,
  ): Promise<PendingAudit[]> {
    const files = await fleetAccidentRepository.findLiveByIds([...deltas.keys()], session);
    const audits: PendingAudit[] = [];
    for (const file of files) {
      const delta = deltas.get(String(file._id)) ?? 0;
      if (delta === 0) continue;
      // Floored at zero: the figure is a sum of live lines, so it can only go below by residue.
      const next = Math.max(0, addMoney(file.transferredOut ?? 0, delta));
      await fleetAccidentRepository.setTransferState(
        file._id,
        { transferredOut: next },
        { by, session, bumpVersion: false },
      );
      audits.push({
        id: String(file._id),
        action: 'update',
        before: file,
        after: { ...file, transferredOut: next },
      });
    }
    return audits;
  }

  private async recordAudits(audits: readonly PendingAudit[]): Promise<void> {
    for (const audit of audits) {
      await auditService.record({
        entityRef: entityRef(audit.id),
        action: audit.action,
        ...(audit.action === 'delete'
          ? {}
          : {
              changes: diffChanges(
                audit.before === null ? {} : snapshot(audit.before),
                audit.after === null ? {} : snapshot(audit.after),
              ),
            }),
      });
    }
  }

  async create(input: CreateFleetAccident, by: string): Promise<FleetAccidentDoc> {
    const vehicle = await fleetVehicleRepository.getById(input.vehicleId);
    if (input.transfer !== undefined)
      return this.createWithTransfer(input, input.transfer, by, vehicle.code);
    const doc = await fleetAccidentRepository.create(
      {
        vehicleId: new Types.ObjectId(input.vehicleId),
        occurredAt: input.occurredAt,
        culprit: input.culprit,
        culpritEmployeeId:
          input.culpritEmployeeId == null ? null : new Types.ObjectId(input.culpritEmployeeId),
        statement: input.statement,
        companyCost: input.companyCost,
        amountCollected: input.amountCollected,
        paidAmount: input.paidAmount,
        status: 'open',
        notes: input.notes ?? null,
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    await emit(FleetEvents.AccidentRecorded, eventPayload(doc, vehicle.code));
    return doc;
  }

  /** A new file that takes from another car as it is recorded — one transaction for both. */
  private async createWithTransfer(
    input: CreateFleetAccident,
    transferInput: FleetAccidentTransferInput,
    by: string,
    code: string,
  ): Promise<FleetAccidentDoc> {
    const byName = await nameOf(by);
    const { doc, audits } = await unitOfWork(async (session) => {
      const { transfer, out } = await this.planTransfer(
        transferInput,
        input.vehicleId,
        by,
        byName,
        session,
      );
      const created = await fleetAccidentRepository.create(
        {
          vehicleId: new Types.ObjectId(input.vehicleId),
          occurredAt: input.occurredAt,
          culprit: input.culprit,
          culpritEmployeeId:
            input.culpritEmployeeId == null ? null : new Types.ObjectId(input.culpritEmployeeId),
          statement: input.statement,
          companyCost: input.companyCost,
          amountCollected: input.amountCollected,
          paidAmount: input.paidAmount,
          transfersIn: [transfer],
          transferredIn: transfer.amount,
          transferredOut: 0,
          status: 'open',
          notes: input.notes ?? null,
        },
        { by, session },
      );
      const sources = await this.applyOut(out, by, session);
      return {
        doc: created,
        audits: [
          {
            id: String(created._id),
            action: 'create',
            before: null,
            after: created,
          } as PendingAudit,
          ...sources,
        ],
      };
    });
    await this.recordAudits(audits);
    await emit(FleetEvents.AccidentRecorded, eventPayload(doc, code));
    return doc;
  }

  /**
   * The mongo filter for one set of accident filters — built ONCE, for both the page and its
   * totals, so the sums under the table can only ever describe the rows the table is drawn from.
   */
  private async filterFor(
    query: FleetAccidentSummaryQuery,
  ): Promise<FilterQuery<FleetAccidentDoc>> {
    return fleetAccidentRepository.accidentFilter({
      vehicleId: query.vehicleId,
      vehicleIds: await this.vehicleScope(query),
      vehicleCodes: query.vehicleCodes,
      culprit: query.culprit,
      culpritEmployeeId: query.culpritEmployeeId,
      notes: query.notes,
      status: query.status,
      from: query.from,
      to: query.to,
    });
  }

  /**
   * The vehicle codes the reader named, resolved to vehicle ids.
   *
   * An accident stores its vehicle by id and never carries the code, so "show me 213" is a
   * question about the registry that has to be answered before this collection can be filtered at
   * all — the same two-step `maintenance.service` takes for its code filter.
   *
   * `undefined` means the reader did not ask, and nothing is narrowed. An EMPTY ARRAY means they
   * asked about codes no vehicle has, which narrows to nothing — the filter is never dropped for
   * matching nothing, or the screen would answer an impossible search with the whole fleet.
   *
   * TWO SHAPES, one answer. `vehicleCodes` is the filter bar's picker: exact, several, ORed.
   * `code` is the single substring box it replaced, kept working for saved links. Asked together
   * they UNION — both name cars the reader wants, so refusing their sum would answer a wider
   * question with a narrower page. `vehicleId` stays its own clause in the repository, where it
   * intersects, because a dropdown pick is a different kind of statement.
   */
  private async vehicleScope(query: {
    vehicleCodes?: readonly string[] | undefined;
    code?: string | undefined;
  }): Promise<string[] | undefined> {
    if (query.vehicleCodes === undefined && query.code === undefined) return undefined;
    const ids = new Set<string>();
    if (query.vehicleCodes !== undefined) {
      for (const id of await fleetVehicleRepository.idsByCodes(query.vehicleCodes)) ids.add(id);
    }
    if (query.code !== undefined) {
      for (const id of await fleetVehicleRepository.idsByCodeSearch(query.code)) ids.add(id);
    }
    return [...ids];
  }

  async list(query: ListFleetAccidentsQuery): Promise<Paginated<FleetAccidentDoc>> {
    return fleetAccidentRepository.listAccidents({
      filter: await this.filterFor(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      // …and the rest of the reader's order behind it. `sortBy` stays the first column
      // so nothing that only speaks the pagination contract is left sorting by nothing.
      sorts: parseFleetSort(query.sort),
    });
  }

  /**
   * The figures under the table: how many files the filters match and what they add up to.
   *
   * Separate from `list` because it answers a different question — the WHOLE filtered set, not
   * the page — and the query it takes has no `page` or `pageSize` to give it. Summing the rows
   * the client happens to be holding would produce a number that changes when the reader turns
   * the page, which is worse than showing none.
   */
  async summary(query: FleetAccidentSummaryQuery): Promise<FleetAccidentTotalsDto> {
    return fleetAccidentRepository.totals(await this.filterFor(query));
  }

  /** Facts edit — audited, version-aware, publishes nothing (§8 lists no accident.updated). */
  async update(id: string, input: UpdateFleetAccident, by: string): Promise<FleetAccidentDoc> {
    const current = await fleetAccidentRepository.getById(id);
    const movesCar = input.vehicleId !== undefined && input.vehicleId !== vehicleIdOf(current);
    // A file that has GIVEN to other cars keeps its car: what it gave is logged against that car,
    // and moving the file would move the gift with it while the log still named the old car.
    if (movesCar && (current.transferredOut ?? 0) > 0) {
      throw new BusinessRuleError(
        'other files took from this accident — remove those transfers before moving it to another car',
      );
    }
    // …and a file cannot end up on a car it took from: that car would be paying itself.
    if (
      movesCar &&
      liveTransfers(current).some((transfer) => String(transfer.fromVehicleId) === input.vehicleId)
    ) {
      throw new BusinessRuleError('this accident took from that car — it cannot be moved onto it');
    }
    if (input.transfer !== undefined) return this.updateWithTransfer(id, input, input.transfer, by);
    const before = current;
    const set: Partial<FleetAccidentDoc> = {};
    if (input.vehicleId !== undefined) {
      await fleetVehicleRepository.getById(input.vehicleId);
      set.vehicleId = new Types.ObjectId(input.vehicleId);
    }
    if (input.occurredAt !== undefined) set.occurredAt = input.occurredAt;
    if (input.culprit !== undefined) set.culprit = input.culprit;
    // `null` CLEARS the reference — «it turned out to be a third party» is an edit somebody has
    // to be able to make, so undefined (untouched) and null (cleared) are kept apart.
    if (input.culpritEmployeeId !== undefined) {
      set.culpritEmployeeId =
        input.culpritEmployeeId === null ? null : new Types.ObjectId(input.culpritEmployeeId);
    }
    if (input.statement !== undefined) set.statement = input.statement;
    if (input.companyCost !== undefined) set.companyCost = input.companyCost;
    if (input.amountCollected !== undefined) set.amountCollected = input.amountCollected;
    if (input.paidAmount !== undefined) set.paidAmount = input.paidAmount;
    if (input.notes !== undefined) set.notes = input.notes ?? null;

    const updated = await fleetAccidentRepository.updateById(id, set, {
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

  /** The same edit, plus one more transfer onto this file — one transaction for all of it. */
  private async updateWithTransfer(
    id: string,
    input: UpdateFleetAccident,
    transferInput: FleetAccidentTransferInput,
    by: string,
  ): Promise<FleetAccidentDoc> {
    const byName = await nameOf(by);
    const { doc, audits } = await unitOfWork(async (session) => {
      const before = await fleetAccidentRepository.findLive(id, session);
      if (before === null) throw new NotFoundError();
      if (input.vehicleId !== undefined) await fleetVehicleRepository.getById(input.vehicleId);
      const receiving = input.vehicleId ?? vehicleIdOf(before);
      const { transfer, out } = await this.planTransfer(
        transferInput,
        receiving,
        by,
        byName,
        session,
      );
      const transfersIn = [...(before.transfersIn ?? []), transfer];
      const set: Partial<FleetAccidentDoc> = {
        transfersIn,
        transferredIn: sumLive(liveTransfers({ transfersIn })),
      };
      if (input.vehicleId !== undefined) set.vehicleId = new Types.ObjectId(input.vehicleId);
      if (input.occurredAt !== undefined) set.occurredAt = input.occurredAt;
      if (input.culprit !== undefined) set.culprit = input.culprit;
      if (input.culpritEmployeeId !== undefined) {
        set.culpritEmployeeId =
          input.culpritEmployeeId === null ? null : new Types.ObjectId(input.culpritEmployeeId);
      }
      if (input.statement !== undefined) set.statement = input.statement;
      if (input.companyCost !== undefined) set.companyCost = input.companyCost;
      if (input.amountCollected !== undefined) set.amountCollected = input.amountCollected;
      if (input.paidAmount !== undefined) set.paidAmount = input.paidAmount;
      if (input.notes !== undefined) set.notes = input.notes ?? null;
      // The version check is the edit's own: a clerk working from a stale copy is refused here,
      // transfer and all.
      const updated = await fleetAccidentRepository.updateById(id, set, {
        by,
        version: input.version,
        session,
      });
      const sources = await this.applyOut(out, by, session);
      return {
        doc: updated,
        audits: [{ id, action: 'update', before, after: updated } as PendingAudit, ...sources],
      };
    });
    await this.recordAudits(audits);
    return doc;
  }

  /**
   * «خدت من مين او ادت ل مين» — one car's transfers, both directions, and what it has left.
   *
   * `remaining` is computed by the same code that caps a new transfer, over the same files, so the
   * figure the clerk is shown is the figure the save will be checked against.
   */
  async carTransfers(vehicleId: string): Promise<FleetAccidentCarTransfersDto> {
    const vehicle = await fleetVehicleRepository.getById(vehicleId);
    const files = await fleetAccidentRepository.liveOfCar(String(vehicle._id), vehicle.code);
    const entries: FleetAccidentTransferEntryDto[] = [];
    for (const file of files) {
      for (const transfer of liveTransfers(file)) {
        entries.push({
          transferId: String(transfer._id),
          accidentId: String(file._id),
          direction: 'in',
          otherVehicleId: String(transfer.fromVehicleId),
          otherVehicleCode: transfer.fromVehicleCode,
          amount: transfer.amount,
          at: transfer.at.toISOString(),
          byName: transfer.byName ?? null,
        });
      }
    }
    const takers = await fleetAccidentRepository.takersFrom(String(vehicle._id));
    const codes = await fleetVehicleRepository.codesByIds(
      takers.map((taker) => vehicleIdOf(taker)).filter((id): id is string => id !== null),
    );
    for (const taker of takers) {
      const takerVehicle = vehicleIdOf(taker);
      for (const transfer of liveTransfers(taker)) {
        if (String(transfer.fromVehicleId) !== String(vehicle._id)) continue;
        entries.push({
          transferId: String(transfer._id),
          accidentId: String(taker._id),
          direction: 'out',
          otherVehicleId: takerVehicle,
          otherVehicleCode:
            (takerVehicle === null ? null : codes.get(takerVehicle)) ?? taker.vehicleCode ?? null,
          amount: transfer.amount,
          at: transfer.at.toISOString(),
          byName: transfer.byName ?? null,
        });
      }
    }
    entries.sort((a, b) => b.at.localeCompare(a.at) || a.transferId.localeCompare(b.transferId));
    return {
      vehicleId: String(vehicle._id),
      vehicleCode: vehicle.code,
      remaining: carRemaining(files),
      entries,
    };
  }

  /**
   * Remove one transfer from the log: the amount goes back to the files it was drawn from, and the
   * file that received it stops counting it. The transfer itself stays on the file, voided.
   */
  async voidTransfer(accidentId: string, transferId: string, by: string): Promise<void> {
    const audits = await unitOfWork(async (session) => {
      const file = await fleetAccidentRepository.findLive(accidentId, session);
      if (file === null) throw new NotFoundError();
      const target = liveTransfers(file).find((transfer) => String(transfer._id) === transferId);
      if (target === undefined) throw new NotFoundError('no such transfer on this accident');
      const out: OutDeltas = new Map();
      for (const line of target.lines) addDelta(out, line.accidentId, -line.amount);
      const transfersIn = (file.transfersIn ?? []).map((transfer) =>
        String(transfer._id) === transferId ? voided(transfer, by, 'removed') : transfer,
      );
      const transferredIn = sumLive(liveTransfers({ transfersIn }));
      await fleetAccidentRepository.setTransferState(
        file._id,
        { transfersIn, transferredIn },
        { by, session, bumpVersion: true },
      );
      const sources = await this.applyOut(out, by, session);
      return [
        {
          id: accidentId,
          action: 'update',
          before: file,
          after: { ...file, transfersIn, transferredIn },
        } as PendingAudit,
        ...sources,
      ];
    });
    await this.recordAudits(audits);
  }

  /** FR-10 — open↔closed, both directions, each audited and published; a no-op is refused. */
  async setStatus(
    id: string,
    input: SetFleetAccidentStatus,
    by: string,
  ): Promise<FleetAccidentDoc> {
    const before = await fleetAccidentRepository.getById(id);
    if (before.status === input.status) {
      throw new ConflictError(`the accident is already ${input.status} (FR-10 refuses no-ops)`);
    }
    const updated = await fleetAccidentRepository.updateById(
      id,
      { status: input.status },
      { by, version: input.version },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [{ field: 'status', old: before.status, new: updated.status }],
    });
    // A file kept from the old book for a car the registry never had names its car itself.
    const code =
      updated.vehicleId == null
        ? (updated.vehicleCode ?? '')
        : (await fleetVehicleRepository.getById(String(updated.vehicleId))).code;
    await emit(
      input.status === 'closed' ? FleetEvents.AccidentClosed : FleetEvents.AccidentReopened,
      eventPayload(updated, code),
    );
    return updated;
  }

  /**
   * Delete a file — and with it every transfer it is part of.
   *
   * A file that RECEIVED transfers gives their amounts back to the cars they came from. A file
   * that GAVE to others takes back what they drew from it: those transfers are voided whole, so
   * each of their other source files is restored too and no figure is left counting half of one.
   * Every voided transfer stays on its file, as the deleted file itself stays in the database.
   */
  async softDelete(id: string, by: string): Promise<void> {
    const current = await fleetAccidentRepository.getById(id);
    const involved = liveTransfers(current).length > 0 || (current.transferredOut ?? 0) > 0;
    if (!involved) {
      await fleetAccidentRepository.softDeleteById(id, { by });
      await auditService.record({ entityRef: entityRef(id), action: 'delete' });
      return;
    }
    const audits = await unitOfWork(async (session) => {
      const file = await fleetAccidentRepository.findLive(id, session);
      if (file === null) throw new NotFoundError();
      const out: OutDeltas = new Map();
      const pending: PendingAudit[] = [];
      // What this file took, handed back.
      for (const transfer of liveTransfers(file)) {
        for (const line of transfer.lines) addDelta(out, line.accidentId, -line.amount);
      }
      if (liveTransfers(file).length > 0) {
        await fleetAccidentRepository.setTransferState(
          file._id,
          {
            transfersIn: (file.transfersIn ?? []).map((transfer) =>
              transfer.voidedAt == null ? voided(transfer, by, 'fileDeleted') : transfer,
            ),
            transferredIn: 0,
          },
          { by, session, bumpVersion: true },
        );
      }
      // What others took from this file, taken back — whole transfers, not just this file's line.
      for (const taker of await fleetAccidentRepository.takersOf(id, session)) {
        if (String(taker._id) === id) continue;
        const transfersIn = (taker.transfersIn ?? []).map((transfer) => {
          const drawsHere =
            transfer.voidedAt == null &&
            transfer.lines.some((line) => String(line.accidentId) === id);
          if (!drawsHere) return transfer;
          for (const line of transfer.lines) addDelta(out, line.accidentId, -line.amount);
          return voided(transfer, by, 'fileDeleted');
        });
        const transferredIn = sumLive(liveTransfers({ transfersIn }));
        await fleetAccidentRepository.setTransferState(
          taker._id,
          { transfersIn, transferredIn },
          { by, session, bumpVersion: true },
        );
        pending.push({
          id: String(taker._id),
          action: 'update',
          before: taker,
          after: { ...taker, transfersIn, transferredIn },
        });
      }
      // The file being deleted is not restored — it is leaving every figure anyway.
      out.delete(id);
      pending.push(...(await this.applyOut(out, by, session)));
      await fleetAccidentRepository.softDeleteById(id, { by, session });
      pending.push({ id, action: 'delete', before: null, after: null });
      return pending;
    });
    await this.recordAudits(audits);
  }
}

export const fleetAccidentService = new FleetAccidentService();
