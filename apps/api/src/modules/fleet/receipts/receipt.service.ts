// The receipts screen (خصم الإيصالات): what the driver brought back, and what paid for it.
//
// A fuel receipt taken off a card is a `receipt` movement on that card, written WITH the receipt
// in one transaction, so the card's balance and the receipts never disagree. Changing a receipt
// gives the old card its money back and takes the new amount off the new card, the same way.
//
// «لما اختار عربيه اعملى ان هل تريد تسجيل كارت اخر حتى لو العربيه عليها كروت»: the card is any
// live card in the system — the car's own, another car's, or one on no car («سفر 1», «اسبير»).
// The money goes to and comes back from whichever card the receipt names; nothing here reads the
// card as «this car's».
import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import {
  FLEET_FUEL_PRICE_KEY,
  type CreateFleetReceipt,
  type FleetFuelCardCompany,
  type FleetFuelType,
  type FleetReceiptDto,
  type FleetReceiptMemoLinkDto,
  type FleetReceiptSummaryQuery,
  type FleetReceiptTotalsDto,
  type ListFleetReceiptsQuery,
  type Paginated,
  type UpdateFleetReceipt,
  parseFleetSort,
} from '@ecms/contracts';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { fileService, type FileDoc, type UploadedBinary } from '../../../platform/files';
import { settingsService } from '../../../platform/settings';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { type AuthContext } from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { drivingSeatRoster } from '../driver-profiles/driving-seat-roster';
import { fleetFuelCardRepository } from '../fuel-cards/fuel-card.repository';
import { fleetFuelCardService } from '../fuel-cards/fuel-card.service';
import { type FleetFuelCardDoc } from '../fuel-cards/fuel-card.model';
import { fleetCustodyMemoRepository } from '../custody/custody-memo.repository';
import { assertReceiptChangeAllowed, assertReceiptRemovable } from '../custody/custody-memo-guard';
import { fleetReceiptRepository } from './receipt.repository';
import { resolveReceiptDocsCategoryId } from './receipt-files';
import { type FleetReceiptDoc } from './receipt.model';

const entityRef = (id: string) => ({ moduleId: 'fleet', entityType: 'receipt', entityId: id });
const invalid = (field: string, message: string): ValidationError =>
  new ValidationError([{ field: `body.${field}`, code: 'INVALID', message }]);
const stringOrNull = (value: Types.ObjectId | null | undefined): string | null =>
  value === null || value === undefined ? null : String(value);
const round = (value: number): number => Math.round(value * 100) / 100;

export interface ReceiptWithJoins {
  doc: FleetReceiptDoc;
  vehicleCode: string | null;
  card: Pick<FleetFuelCardDoc, 'company' | 'number' | 'vehicleId' | 'label'> | null;
  /** The code of the car the card is on — which may be another car than the receipt's. */
  cardVehicleCode: string | null;
  /** The custody memo it is a line of («المذكرات»); absent or `null` while it is on none. */
  memo?: FleetReceiptMemoLinkDto | null;
}

export const toReceiptDto = ({
  doc,
  vehicleCode,
  card,
  cardVehicleCode,
  memo,
}: ReceiptWithJoins): FleetReceiptDto => ({
  id: String(doc._id),
  date: doc.date.toISOString(),
  vehicleId: String(doc.vehicleId),
  vehicleCode,
  driverEmployeeId: stringOrNull(doc.driverEmployeeId),
  driverName: doc.driverName ?? null,
  kind: doc.kind,
  source: doc.source,
  cardId: stringOrNull(doc.cardId),
  cardCompany: card?.company ?? null,
  cardNumber: card?.number ?? null,
  cardVehicleId: stringOrNull(card?.vehicleId),
  cardVehicleCode: card?.vehicleId == null ? null : cardVehicleCode,
  cardLabel: card == null || card.vehicleId != null ? null : (card.label ?? null),
  fuelType: doc.fuelType ?? null,
  pricePerLitre: doc.pricePerLitre ?? null,
  litres: doc.litres ?? null,
  amount: doc.amount,
  odometer: doc.odometer ?? null,
  company: doc.company ?? null,
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
  memo: memo ?? null,
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

const snapshot = (doc: FleetReceiptDoc) => ({
  date: doc.date.toISOString(),
  vehicleId: String(doc.vehicleId),
  driverEmployeeId: stringOrNull(doc.driverEmployeeId),
  driverName: doc.driverName ?? null,
  kind: doc.kind,
  source: doc.source,
  cardId: stringOrNull(doc.cardId),
  fuelType: doc.fuelType ?? null,
  litres: doc.litres ?? null,
  amount: doc.amount,
  odometer: doc.odometer ?? null,
  company: doc.company ?? null,
});

/** The facts a receipt is written from — a create's whole body, or an edit merged over the row. */
interface ReceiptFacts {
  date: Date;
  vehicleId: string;
  driverEmployeeId: string | null;
  driverName: string | null;
  kind: FleetReceiptDoc['kind'];
  cardId: string | null;
  fuelType: FleetFuelType | null;
  amount: number;
  odometer: number | null;
  company: FleetFuelCardCompany | null;
}

class FleetReceiptService {
  // ── Reading ───────────────────────────────────────────────────────────────

  private async filterFor(query: FleetReceiptSummaryQuery): Promise<FilterQuery<FleetReceiptDoc>> {
    return fleetReceiptRepository.receiptFilter({
      vehicleIds:
        query.vehicleCodes === undefined
          ? undefined
          : await fleetVehicleRepository.idsByCodes(query.vehicleCodes),
      kind: query.kind,
      source: query.source,
      driver: query.driver,
      from: query.from,
      to: query.to,
    });
  }

  async list(
    query: ListFleetReceiptsQuery,
  ): Promise<Paginated<FleetReceiptDoc> & { joins: Map<string, ReceiptWithJoins> }> {
    const page = await fleetReceiptRepository.listReceipts({
      filter: await this.filterFor(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'date',
      sortDir: query.sortDir ?? 'desc',
      sorts: parseFleetSort(query.sort),
    });
    return { ...page, joins: await this.joinsFor(page.items) };
  }

  async summary(query: FleetReceiptSummaryQuery): Promise<FleetReceiptTotalsDto> {
    return fleetReceiptRepository.totals(await this.filterFor(query));
  }

  /**
   * The codes and the cards for exactly the rows on the page — the cards first, then ONE lookup of
   * codes for the receipts' cars and the cards' cars together: a card may sit on another car.
   */
  async joinsFor(docs: readonly FleetReceiptDoc[]): Promise<Map<string, ReceiptWithJoins>> {
    const cardIds = [
      ...new Set(docs.flatMap((doc) => (doc.cardId == null ? [] : [String(doc.cardId)]))),
    ];
    const cards = await fleetFuelCardRepository.findByIdsSystem(cardIds);
    const byCard = new Map(cards.map((card) => [String(card._id), card]));
    const vehicleIds = [
      ...new Set([
        ...docs.map((doc) => String(doc.vehicleId)),
        ...cards.flatMap((card) => (card.vehicleId == null ? [] : [String(card.vehicleId)])),
      ]),
    ];
    const codes = await fleetVehicleRepository.codesByIds(vehicleIds);
    // «مذكرة … رقم N» for the rows on a memo — one read for the page.
    const memos = await fleetCustodyMemoRepository.linksByIds(
      docs.flatMap((doc) => (doc.memoId == null ? [] : [String(doc.memoId)])),
    );
    return new Map(
      docs.map((doc) => {
        const card = doc.cardId == null ? null : (byCard.get(String(doc.cardId)) ?? null);
        return [
          String(doc._id),
          {
            doc,
            vehicleCode: codes.get(String(doc.vehicleId)) ?? null,
            card,
            cardVehicleCode:
              card?.vehicleId == null ? null : (codes.get(String(card.vehicleId)) ?? null),
            memo: doc.memoId == null ? null : (memos.get(String(doc.memoId)) ?? null),
          },
        ];
      }),
    );
  }

  async get(id: string): Promise<ReceiptWithJoins> {
    const doc = await fleetReceiptRepository.getById(id);
    const joins = await this.joinsFor([doc]);
    return joins.get(id) as ReceiptWithJoins;
  }

  // ── Writing ───────────────────────────────────────────────────────────────

  /**
   * The checks a receipt's facts have to pass, and the litres they price to. The card must be a
   * live card — ANY card, «حتى لو العربيه عليها كروت»: another car's or one on no car pays as well
   * as the car's own; whether it holds enough is `debit`'s, inside the transaction. The driver,
   * when an employee, is one of Fleet's people (a snapshot of their name is kept so the list and
   * the filter never need HR).
   */
  private async prepare(facts: ReceiptFacts): Promise<Partial<FleetReceiptDoc>> {
    // «الشركة» is a fund-paid fuel paper's: a card already names its company.
    if (facts.company !== null && (facts.kind !== 'fuel' || facts.cardId !== null)) {
      throw invalid('company', 'only a fuel receipt paid from the custody fund names its company');
    }
    await fleetVehicleRepository.getById(facts.vehicleId);
    if (facts.cardId !== null) {
      const card = await fleetFuelCardRepository.findById(facts.cardId);
      if (card === null) throw invalid('cardId', 'unknown fuel card');
    }
    let driverName = facts.driverName;
    if (facts.driverEmployeeId !== null) {
      const roster = await drivingSeatRoster({ includeExited: true });
      const driver = roster.find((employee) => employee.employeeId === facts.driverEmployeeId);
      if (driver === undefined) {
        throw invalid('driverEmployeeId', 'this employee does not hold a driving seat (FR-11)');
      }
      driverName = driver.fullNameAr;
    }
    let pricePerLitre: number | null = null;
    let litres: number | null = null;
    if (facts.kind === 'fuel' && facts.fuelType !== null) {
      pricePerLitre = await settingsService.resolve<number>(FLEET_FUEL_PRICE_KEY[facts.fuelType], {
        userId: null,
        branchId: null,
      });
      litres = pricePerLitre > 0 ? round(facts.amount / pricePerLitre) : null;
    }
    return {
      date: facts.date,
      vehicleId: new Types.ObjectId(facts.vehicleId),
      driverEmployeeId:
        facts.driverEmployeeId === null ? null : new Types.ObjectId(facts.driverEmployeeId),
      driverName,
      kind: facts.kind,
      source: facts.cardId === null ? 'custody' : 'card',
      cardId: facts.cardId === null ? null : new Types.ObjectId(facts.cardId),
      fuelType: facts.kind === 'fuel' ? facts.fuelType : null,
      pricePerLitre,
      litres,
      amount: facts.amount,
      // «كم» belongs to a fuel paper; a receipt that is not fuel carries none.
      odometer: facts.kind === 'fuel' ? facts.odometer : null,
      company: facts.kind === 'fuel' && facts.cardId === null ? facts.company : null,
    };
  }

  async create(input: CreateFleetReceipt, by: string): Promise<ReceiptWithJoins> {
    const set = await this.prepare({
      date: input.date,
      vehicleId: input.vehicleId,
      driverEmployeeId: input.driverEmployeeId ?? null,
      driverName: input.driverName ?? null,
      kind: input.kind,
      cardId: input.kind === 'fuel' ? (input.cardId ?? null) : null,
      fuelType: input.fuelType ?? null,
      amount: input.amount,
      odometer: input.kind === 'fuel' ? (input.odometer ?? null) : null,
      company: input.company ?? null,
    });
    const doc = await unitOfWork(async (session) => {
      const created = await fleetReceiptRepository.create({ ...set, image: null }, { by, session });
      if (created.cardId !== null) {
        await fleetFuelCardService.debit(
          String(created.cardId),
          created.amount,
          created._id,
          created.date,
          by,
          session,
        );
      }
      return created;
    });
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return this.get(String(doc._id));
  }

  async update(id: string, input: UpdateFleetReceipt, by: string): Promise<ReceiptWithJoins> {
    const before = await fleetReceiptRepository.getById(id);
    const kind = input.kind;
    const cardId =
      kind !== 'fuel'
        ? null
        : input.cardId === undefined
          ? stringOrNull(before.cardId)
          : input.cardId;
    const set = await this.prepare({
      date: input.date ?? before.date,
      vehicleId: input.vehicleId ?? String(before.vehicleId),
      driverEmployeeId:
        input.driverEmployeeId === undefined
          ? stringOrNull(before.driverEmployeeId)
          : input.driverEmployeeId,
      driverName: input.driverName === undefined ? (before.driverName ?? null) : input.driverName,
      kind,
      cardId,
      fuelType:
        kind !== 'fuel'
          ? null
          : input.fuelType === undefined
            ? (before.fuelType ?? null)
            : input.fuelType,
      amount: input.amount ?? before.amount,
      odometer:
        kind !== 'fuel'
          ? null
          : input.odometer === undefined
            ? (before.odometer ?? null)
            : input.odometer,
      // Kept while the receipt stays fuel from the fund; one that moves onto a card or off fuel
      // drops it — a company the clerk names on a card receipt is refused in `prepare`.
      company:
        input.company !== undefined
          ? input.company
          : kind === 'fuel' && cardId === null
            ? (before.company ?? null)
            : null,
    });
    const moneyMoved =
      stringOrNull(before.cardId) !== stringOrNull(set.cardId ?? null) ||
      before.amount !== set.amount ||
      before.date.getTime() !== (set.date as Date).getTime();
    const updated = await unitOfWork(async (session) => {
      const live = await fleetReceiptRepository.findLive(id, session);
      if (live === null) throw new NotFoundError();
      // On a custody memo, the memo decides what may still change (`custody-memo-guard.ts`).
      await assertReceiptChangeAllowed(
        live,
        {
          date: set.date as Date,
          vehicleId: set.vehicleId,
          kind: set.kind as FleetReceiptDoc['kind'],
          source: set.source as FleetReceiptDoc['source'],
          cardId: set.cardId ?? null,
          amount: set.amount as number,
        },
        session,
      );
      // The old card gets its money back before the new one is charged — one transaction.
      if (moneyMoved && live.cardId !== null) {
        await this.giveBack(live, by, session);
      }
      const next = await fleetReceiptRepository.updateById(id, set, {
        by,
        version: input.version,
        session,
      });
      if (moneyMoved && next.cardId !== null) {
        await fleetFuelCardService.debit(
          String(next.cardId),
          next.amount,
          next._id,
          next.date,
          by,
          session,
        );
      }
      return next;
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return this.get(id);
  }

  private async giveBack(doc: FleetReceiptDoc, by: string, session: ClientSession): Promise<void> {
    if (doc.cardId === null) return;
    await fleetFuelCardService.credit(
      String(doc.cardId),
      doc.amount,
      doc._id,
      new Date(),
      by,
      session,
    );
  }

  /** Taking a receipt away gives the card its money back — the row stays, soft-deleted. */
  async remove(id: string, by: string): Promise<void> {
    const before = await fleetReceiptRepository.getById(id);
    await unitOfWork(async (session) => {
      const live = await fleetReceiptRepository.findLive(id, session);
      if (live === null) throw new NotFoundError();
      // A receipt on a custody memo stays until it is taken off the memo.
      await assertReceiptRemovable(live, session);
      await this.giveBack(live, by, session);
      await fleetReceiptRepository.softDeleteById(id, { by, session });
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'delete',
      changes: diffChanges(snapshot(before), {}),
    });
  }

  // ── The photo (Files owns the bytes, the row owns the link) ───────────────

  async setImage(ctx: AuthContext, id: string, binary: UploadedBinary): Promise<ReceiptWithJoins> {
    const before = await fleetReceiptRepository.getById(id);
    const current = before.image ?? null;
    const isFirst = current === null;
    let file: FileDoc;
    if (current === null) {
      file = await fileService.upload(
        ctx,
        {
          moduleId: 'fleet',
          entityType: 'receipt',
          entityId: id,
          categoryId: await resolveReceiptDocsCategoryId(),
          displayName: `${before.kind} receipt — ${before.date.toISOString().slice(0, 10)}`,
          visibility: 'private',
          tags: [],
        },
        binary,
      );
    } else {
      file = await fileService.replace(ctx, String(current.fileId), binary);
    }
    try {
      await fleetReceiptRepository.updateById(
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
      if (isFirst) await fileService.softDelete(ctx, String(file._id)).catch(() => undefined);
      throw error;
    }
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        {
          field: 'image',
          old: before.image == null ? null : String(before.image.fileId),
          new: String(file._id),
        },
      ],
    });
    return this.get(id);
  }

  async readImage(
    ctx: AuthContext,
    id: string,
  ): Promise<{ buffer: Buffer; mime: string; fileName: string }> {
    const row = await fleetReceiptRepository.getById(id);
    if (row.image == null) throw new NotFoundError('this receipt has no image');
    const { doc, buffer } = await fileService.readEntityOwnedBuffer(ctx, String(row.image.fileId));
    return { buffer, mime: doc.mime, fileName: doc.originalName };
  }

  async deleteImage(ctx: AuthContext, id: string): Promise<ReceiptWithJoins> {
    const before = await fleetReceiptRepository.getById(id);
    if (before.image == null) throw new ConflictError('this receipt has no image to delete');
    const fileId = String(before.image.fileId);
    await fleetReceiptRepository.updateById(
      id,
      { image: null },
      { by: ctx.userId, version: before.__v },
    );
    await fileService.softDelete(ctx, fileId).catch(() => undefined);
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'image', old: fileId, new: null }],
    });
    return this.get(id);
  }
}

export const fleetReceiptService = new FleetReceiptService();
