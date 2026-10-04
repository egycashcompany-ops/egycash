// Fuel cards: the registry of cards, the charging the clerk approves, and the transfers between
// two cards. Every balance change is written with its movement in ONE transaction.
import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import {
  type ApproveFleetFuelCharge,
  type CreateFleetFuelCard,
  type FleetFuelCardDto,
  type FleetFuelCardMovementDto,
  type FleetFuelCardSummaryQuery,
  type FleetFuelCardTotalsDto,
  type FleetFuelTransferResultDto,
  type ListFleetFuelCardMovementsQuery,
  type ListFleetFuelCardsQuery,
  type Paginated,
  type RequestFleetFuelCharge,
  type TransferFleetFuelBalance,
  type UpdateFleetFuelCard,
  parseFleetSort,
} from '@ecms/contracts';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { fileService, type FileDoc, type UploadedBinary } from '../../../platform/files';
import { type AuthContext } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { isVehicleWritable } from '../vehicles/vehicle-status';
import { fleetFuelCardMovementRepository, fleetFuelCardRepository } from './fuel-card.repository';
import { type FleetFuelCardDoc, type FleetFuelCardMovementDoc } from './fuel-card.model';
import { resolveFuelCardDocsCategoryId } from './fuel-card-files';

const entityRef = (id: string) => ({ moduleId: 'fleet', entityType: 'fuelCard', entityId: id });
const piastres = (egp: number): number => Math.round(egp * 100);
const round = (value: number): number => Math.round(value * 100) / 100;

export interface FuelCardWithCode {
  doc: FleetFuelCardDoc;
  vehicleCode: string | null;
}

export const toFuelCardDto = ({ doc, vehicleCode }: FuelCardWithCode): FleetFuelCardDto => ({
  id: String(doc._id),
  vehicleId: doc.vehicleId == null ? null : String(doc.vehicleId),
  vehicleCode: doc.vehicleId == null ? null : vehicleCode,
  label: doc.vehicleId == null ? (doc.label ?? null) : null,
  company: doc.company,
  name: doc.name,
  number: doc.number,
  expiresAt: doc.expiresAt?.toISOString() ?? null,
  hasPassword: doc.password !== null && doc.password !== undefined && doc.password !== '',
  balance: doc.balance,
  requestedAmount: doc.requestedAmount ?? null,
  requestedAt: doc.requestedAt?.toISOString() ?? null,
  lastChargedAt: doc.lastChargedAt?.toISOString() ?? null,
  image:
    doc.image == null
      ? null
      : {
          fileId: String(doc.image.fileId),
          fileName: doc.image.fileName,
          mime: doc.image.mime,
          size: doc.image.size,
          uploadedAt: doc.image.uploadedAt.toISOString(),
        },
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

export const toFuelMovementDto = (
  doc: FleetFuelCardMovementDoc,
  counterpartNumber: string | null,
): FleetFuelCardMovementDto => ({
  id: String(doc._id),
  cardId: String(doc.cardId),
  kind: doc.kind,
  amount: doc.amount,
  balanceAfter: doc.balanceAfter,
  counterpartCardId: doc.counterpartCardId == null ? null : String(doc.counterpartCardId),
  counterpartNumber,
  at: doc.at.toISOString(),
  createdAt: doc.createdAt.toISOString(),
});

/** The password never enters the audit trail. */
const snapshot = (doc: FleetFuelCardDoc) => ({
  vehicleId: doc.vehicleId == null ? null : String(doc.vehicleId),
  label: doc.label ?? null,
  company: doc.company,
  name: doc.name,
  number: doc.number,
  expiresAt: doc.expiresAt?.toISOString() ?? null,
  hasPassword: doc.password !== null && doc.password !== '',
});

class FleetFuelCardService {
  private async codesFor(docs: readonly FleetFuelCardDoc[]): Promise<Map<string, string>> {
    return fleetVehicleRepository.codesByIds([
      ...new Set(docs.flatMap((doc) => (doc.vehicleId == null ? [] : [String(doc.vehicleId)]))),
    ]);
  }

  async withCode(doc: FleetFuelCardDoc): Promise<FuelCardWithCode> {
    const codes = await this.codesFor([doc]);
    return { doc, vehicleCode: codes.get(String(doc.vehicleId)) ?? null };
  }

  private async filterFor(
    query: FleetFuelCardSummaryQuery,
  ): Promise<FilterQuery<FleetFuelCardDoc>> {
    return fleetFuelCardRepository.cardFilter({
      vehicleIds:
        query.vehicleCodes === undefined
          ? undefined
          : await fleetVehicleRepository.idsByCodes(query.vehicleCodes),
      company: query.company,
      number: query.number,
      expiresBefore: query.expiresBefore,
      requested: query.requested,
      balanceBelow: query.balanceBelow,
    });
  }

  async list(
    query: ListFleetFuelCardsQuery,
  ): Promise<Paginated<FleetFuelCardDoc> & { codes: Map<string, string> }> {
    const page = await fleetFuelCardRepository.listCards({
      filter: await this.filterFor(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'vehicleCode',
      sortDir: query.sortDir ?? 'asc',
      sorts: parseFleetSort(query.sort),
    });
    return { ...page, codes: await this.codesFor(page.items) };
  }

  async summary(query: FleetFuelCardSummaryQuery): Promise<FleetFuelCardTotalsDto> {
    return fleetFuelCardRepository.totals(await this.filterFor(query), new Date());
  }

  async get(id: string): Promise<FuelCardWithCode> {
    return this.withCode(await fleetFuelCardRepository.getById(id));
  }

  /** The password, for a reader holding the grant — nothing else is returned with it. */
  async reveal(id: string): Promise<string | null> {
    const doc = await fleetFuelCardRepository.getById(id);
    return doc.password === undefined || doc.password === '' ? null : doc.password;
  }

  private async assertVehicle(vehicleId: string): Promise<void> {
    const vehicle = await fleetVehicleRepository.getById(vehicleId);
    if (!isVehicleWritable(vehicle.status)) {
      throw new ConflictError('a disposed vehicle cannot hold a fuel card');
    }
  }

  async create(input: CreateFleetFuelCard, by: string): Promise<FuelCardWithCode> {
    if (input.vehicleId !== null) await this.assertVehicle(input.vehicleId);
    const doc = await fleetFuelCardRepository.create(
      {
        vehicleId: input.vehicleId === null ? null : new Types.ObjectId(input.vehicleId),
        // A card on a car is named by the car; the label is only for a card on none.
        label: input.vehicleId === null ? (input.label ?? null) : null,
        company: input.company,
        name: input.name,
        number: input.number,
        expiresAt: input.expiresAt,
        password: input.password ?? null,
        balance: 0,
        requestedAmount: null,
        requestedAt: null,
        lastChargedAt: null,
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return this.withCode(doc);
  }

  async update(id: string, input: UpdateFleetFuelCard, by: string): Promise<FuelCardWithCode> {
    const before = await fleetFuelCardRepository.getById(id);
    if (input.vehicleId !== undefined && input.vehicleId !== null) {
      await this.assertVehicle(input.vehicleId);
    }
    const set: Partial<FleetFuelCardDoc> = {};
    if (input.vehicleId !== undefined) {
      set.vehicleId = input.vehicleId === null ? null : new Types.ObjectId(input.vehicleId);
    }
    // A card on no car is known by its label; a card on a car is named by the car and keeps none.
    const onNoCar =
      input.vehicleId === undefined ? before.vehicleId == null : input.vehicleId === null;
    if (onNoCar) {
      const label = input.label === undefined ? (before.label ?? null) : (input.label ?? null);
      if (label === null || label === '') throw new ConflictError('a card on no car needs a label');
      set.label = label;
    } else {
      set.label = null;
    }
    if (input.company !== undefined) set.company = input.company;
    if (input.name !== undefined) set.name = input.name;
    if (input.number !== undefined) set.number = input.number;
    if (input.expiresAt !== undefined) set.expiresAt = input.expiresAt;
    if (input.password !== undefined) set.password = input.password ?? null;
    const updated = await fleetFuelCardRepository.updateById(id, set, {
      by,
      version: input.version,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return this.withCode(updated);
  }

  async remove(id: string, by: string): Promise<void> {
    const before = await fleetFuelCardRepository.getById(id);
    if (before.balance > 0) {
      throw new ConflictError(
        'a card that still holds a balance cannot be deleted — transfer it first',
      );
    }
    await fleetFuelCardRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
  }

  // ── Charging ─────────────────────────────────────────────────────────────

  /** «طلب رصيد» — written on the row; `null` takes it back. */
  async request(id: string, input: RequestFleetFuelCharge, by: string): Promise<FuelCardWithCode> {
    const before = await fleetFuelCardRepository.getById(id);
    const updated = await fleetFuelCardRepository.updateById(
      id,
      {
        requestedAmount: input.amount,
        requestedAt: input.amount === null ? null : new Date(),
      },
      { by, version: input.version },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        {
          field: 'requestedAmount',
          old: before.requestedAmount == null ? null : String(before.requestedAmount),
          new: input.amount === null ? null : String(input.amount),
        },
      ],
    });
    return this.withCode(updated);
  }

  /** The ✓ — the request becomes balance, with its movement, in one transaction. */
  async approve(id: string, input: ApproveFleetFuelCharge, by: string): Promise<FuelCardWithCode> {
    const { updated, amount } = await unitOfWork(async (session) => {
      const card = await fleetFuelCardRepository.findLive(id, session);
      if (card === null) throw new NotFoundError();
      if (card.requestedAmount == null) throw new ConflictError('this card has no charge request');
      const amount = card.requestedAmount;
      const balanceAfter = (piastres(card.balance) + piastres(amount)) / 100;
      const now = new Date();
      const updated = await fleetFuelCardRepository.updateById(
        id,
        { balance: balanceAfter, requestedAmount: null, requestedAt: null, lastChargedAt: now },
        { by, version: input.version, session },
      );
      await this.movement(card, 'charge', amount, balanceAfter, null, null, now, by, session);
      return { updated, amount };
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        { field: 'balance', old: String(updated.balance - amount), new: String(updated.balance) },
      ],
    });
    return this.withCode(updated);
  }

  private async movement(
    card: FleetFuelCardDoc,
    kind: FleetFuelCardMovementDoc['kind'],
    amount: number,
    balanceAfter: number,
    counterpartCardId: Types.ObjectId | null,
    receiptId: Types.ObjectId | null,
    at: Date,
    by: string,
    session: ClientSession,
  ): Promise<void> {
    await fleetFuelCardMovementRepository.create(
      { cardId: card._id, kind, amount, balanceAfter, counterpartCardId, receiptId, at },
      { by, session },
    );
  }

  /** «تحويل رصيد بين كارتين» — out of one, into the other, both inside one transaction. */
  async transfer(input: TransferFleetFuelBalance, by: string): Promise<FleetFuelTransferResultDto> {
    const { from, to } = await unitOfWork(async (session) => {
      const [from, to] = await Promise.all([
        fleetFuelCardRepository.findLive(input.fromCardId, session),
        fleetFuelCardRepository.findLive(input.toCardId, session),
      ]);
      if (from === null || to === null) throw new NotFoundError('card not found');
      if (piastres(from.balance) < piastres(input.amount)) {
        throw new ValidationError([
          {
            field: 'body.amount',
            code: 'INVALID',
            message: `the card holds only ${from.balance} — it cannot give ${input.amount}`,
          },
        ]);
      }
      const now = new Date();
      const fromAfter = (piastres(from.balance) - piastres(input.amount)) / 100;
      const toAfter = (piastres(to.balance) + piastres(input.amount)) / 100;
      const fromUpdated = await fleetFuelCardRepository.updateById(
        String(from._id),
        { balance: fromAfter },
        { by, version: from.__v, session },
      );
      const toUpdated = await fleetFuelCardRepository.updateById(
        String(to._id),
        { balance: toAfter },
        { by, version: to.__v, session },
      );
      await this.movement(
        from,
        'transferOut',
        -input.amount,
        fromAfter,
        to._id,
        null,
        now,
        by,
        session,
      );
      await this.movement(
        to,
        'transferIn',
        input.amount,
        toAfter,
        from._id,
        null,
        now,
        by,
        session,
      );
      return { from: fromUpdated, to: toUpdated };
    });
    await auditService.record({
      entityRef: entityRef(String(from._id)),
      action: 'transfer',
      changes: [
        {
          field: 'balance',
          old: String(round(from.balance + input.amount)),
          new: String(from.balance),
        },
      ],
    });
    await auditService.record({
      entityRef: entityRef(String(to._id)),
      action: 'transfer',
      changes: [
        {
          field: 'balance',
          old: String(round(to.balance - input.amount)),
          new: String(to.balance),
        },
      ],
    });
    const codes = await this.codesFor([from, to]);
    return {
      from: toFuelCardDto({ doc: from, vehicleCode: codes.get(String(from.vehicleId)) ?? null }),
      to: toFuelCardDto({ doc: to, vehicleCode: codes.get(String(to.vehicleId)) ?? null }),
      amount: input.amount,
    };
  }

  /**
   * Take a fuel receipt's amount off the card — the receipts screen's door. Inside the caller's
   * transaction, so the receipt and the balance are one write. Refuses more than the card holds.
   */
  async debit(
    cardId: string,
    amount: number,
    receiptId: Types.ObjectId,
    at: Date,
    by: string,
    session: ClientSession,
  ): Promise<FleetFuelCardDoc> {
    const card = await fleetFuelCardRepository.findLive(cardId, session);
    if (card === null) throw new NotFoundError('card not found');
    if (piastres(card.balance) < piastres(amount)) {
      throw new ValidationError([
        {
          field: 'body.amount',
          code: 'INVALID',
          message: `the card holds only ${card.balance} — the receipt cannot take ${amount}`,
        },
      ]);
    }
    const after = (piastres(card.balance) - piastres(amount)) / 100;
    const updated = await fleetFuelCardRepository.updateById(
      cardId,
      { balance: after },
      { by, version: card.__v, session },
    );
    await this.movement(card, 'receipt', -amount, after, null, receiptId, at, by, session);
    return updated;
  }

  /** Give a receipt's amount back — when the receipt is deleted or re-pointed. */
  async credit(
    cardId: string,
    amount: number,
    receiptId: Types.ObjectId,
    at: Date,
    by: string,
    session: ClientSession,
  ): Promise<void> {
    const card = await fleetFuelCardRepository.findLive(cardId, session);
    if (card === null) return;
    const after = (piastres(card.balance) + piastres(amount)) / 100;
    await fleetFuelCardRepository.updateById(
      cardId,
      { balance: after },
      { by, version: card.__v, session },
    );
    await this.movement(card, 'receipt', amount, after, null, receiptId, at, by, session);
  }

  async movements(
    query: ListFleetFuelCardMovementsQuery,
  ): Promise<Paginated<FleetFuelCardMovementDoc> & { numbers: Map<string, string> }> {
    const page = await fleetFuelCardMovementRepository.list({
      filter: { cardId: new Types.ObjectId(query.cardId) },
      page: query.page,
      pageSize: query.pageSize,
      sortBy: 'at',
      sortDir: 'desc',
      sortableFields: ['at', 'createdAt'],
    });
    const counterparts = [
      ...new Set(
        page.items.flatMap((doc) =>
          doc.counterpartCardId == null ? [] : [String(doc.counterpartCardId)],
        ),
      ),
    ];
    const cards = await fleetFuelCardRepository.findByIdsSystem(counterparts);
    return { ...page, numbers: new Map(cards.map((card) => [String(card._id), card.number])) };
  }

  // ── The photo (Files owns the bytes, the card owns the link) ──────────────

  /** «صوره كل فيزا» — the first upload creates the file, a later one adds a version of it. */
  async setImage(ctx: AuthContext, id: string, binary: UploadedBinary): Promise<FuelCardWithCode> {
    const before = await fleetFuelCardRepository.getById(id);
    const current = before.image ?? null;
    const isFirst = current === null;
    let file: FileDoc;
    if (current === null) {
      file = await fileService.upload(
        ctx,
        {
          moduleId: 'fleet',
          entityType: 'fuelCard',
          entityId: id,
          categoryId: await resolveFuelCardDocsCategoryId(),
          displayName: `fuel card ${before.number}`,
          visibility: 'private',
          tags: [],
        },
        binary,
      );
    } else {
      file = await fileService.replace(ctx, String(current.fileId), binary);
    }
    let updated: FleetFuelCardDoc;
    try {
      updated = await fleetFuelCardRepository.updateById(
        id,
        {
          image: {
            fileId: file._id,
            fileName: file.originalName,
            mime: file.mime,
            size: file.size,
            uploadedAt: new Date(),
          },
        },
        { by: ctx.userId, version: before.__v },
      );
    } catch (error) {
      // A first upload the card never came to point at is an orphan — withdrawn. A replace added
      // a version to the group the card already points at, which is history, not an orphan.
      if (isFirst) await fileService.softDelete(ctx, String(file._id)).catch(() => undefined);
      throw error;
    }
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        {
          field: 'image',
          old: current === null ? null : String(current.fileId),
          new: String(file._id),
        },
      ],
    });
    return this.withCode(updated);
  }

  async readImage(
    ctx: AuthContext,
    id: string,
  ): Promise<{ buffer: Buffer; mime: string; fileName: string }> {
    const card = await fleetFuelCardRepository.getById(id);
    if (card.image == null) throw new NotFoundError('this card has no photo');
    const { doc, buffer } = await fileService.readEntityOwnedBuffer(ctx, String(card.image.fileId));
    return { buffer, mime: doc.mime, fileName: doc.originalName };
  }

  async deleteImage(ctx: AuthContext, id: string): Promise<FuelCardWithCode> {
    const before = await fleetFuelCardRepository.getById(id);
    if (before.image == null) throw new ConflictError('this card has no photo to delete');
    const fileId = String(before.image.fileId);
    const updated = await fleetFuelCardRepository.updateById(
      id,
      { image: null },
      { by: ctx.userId, version: before.__v },
    );
    // After the card write, so a failed detach never leaves the card pointing at a deleted file.
    await fileService.softDelete(ctx, fileId).catch(() => undefined);
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'image', old: fileId, new: null }],
    });
    return this.withCode(updated);
  }
}

export const fleetFuelCardService = new FleetFuelCardService();
