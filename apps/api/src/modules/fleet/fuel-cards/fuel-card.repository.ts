import { Types, type ClientSession, type FilterQuery, type PipelineStage } from 'mongoose';
import { type FleetFuelCardCompany, type FleetFuelCardTotalsDto } from '@ecms/contracts';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import { VEHICLE_CODE_SORT } from '../vehicles/vehicle.repository';
import { cairoDayOf, cairoDayRange } from '../fleet-cairo-day';
import {
  FleetFuelCardModel,
  FleetFuelCardMovementModel,
  type FleetFuelCardDoc,
  type FleetFuelCardMovementDoc,
} from './fuel-card.model';

class FleetFuelCardRepository extends BaseRepository<FleetFuelCardDoc> {
  constructor() {
    super(FleetFuelCardModel, {});
  }

  cardFilter(query: {
    vehicleIds?: readonly string[] | undefined;
    company?: FleetFuelCardCompany | undefined;
    number?: string | undefined;
    expiresBefore?: Date | undefined;
    expiresFrom?: Date | undefined;
    requested?: boolean | undefined;
    balanceBelow?: number | undefined;
  }): FilterQuery<FleetFuelCardDoc> {
    const clauses: FilterQuery<FleetFuelCardDoc>[] = [];
    if (query.vehicleIds !== undefined) {
      clauses.push({ vehicleId: { $in: query.vehicleIds.map((id) => new Types.ObjectId(id)) } });
    }
    if (query.company !== undefined) clauses.push({ company: query.company });
    if (query.number !== undefined) {
      const escaped = query.number.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      clauses.push({ number: { $regex: escaped.replace(/\s+/gu, '\\s*'), $options: 'i' } });
    }
    if (query.expiresBefore !== undefined)
      clauses.push({ expiresAt: { $lte: query.expiresBefore } });
    // The window's other bound — «تنتهي خلال 30 يومًا» must not count the cards already expired,
    // which `expiresBefore` alone does. `$gte`, the vehicles' naming; a card with no expiry on
    // file is in no window (`$gte` never matches null).
    if (query.expiresFrom !== undefined) clauses.push({ expiresAt: { $gte: query.expiresFrom } });
    if (query.requested !== undefined) {
      clauses.push({ requestedAmount: query.requested ? { $ne: null } : null });
    }
    if (query.balanceBelow !== undefined) clauses.push({ balance: { $lt: query.balanceBelow } });
    return clauses.length === 0 ? {} : { $and: clauses };
  }

  async listCards(params: ListParams<FleetFuelCardDoc>) {
    return this.list({
      ...params,
      sortableFields: [
        'expiresAt',
        'balance',
        'name',
        'number',
        'company',
        'createdAt',
        VEHICLE_CODE_SORT.key,
      ],
      sortDerived: [VEHICLE_CODE_SORT],
    });
  }

  /** One live card, read inside `session` — a balance is changed against what it IS right now. */
  async findLive(
    id: string | Types.ObjectId,
    session: ClientSession,
  ): Promise<FleetFuelCardDoc | null> {
    return this.model
      .findOne({ _id: new Types.ObjectId(String(id)), isDeleted: false })
      .session(session)
      .lean<FleetFuelCardDoc>()
      .exec();
  }

  /** Every live card of one company — what a company's sheet is compared with. */
  async liveOfCompany(company: FleetFuelCardCompany): Promise<FleetFuelCardDoc[]> {
    return this.model.find({ company, isDeleted: false }).lean<FleetFuelCardDoc[]>().exec();
  }

  /** The live cards among `ids`, read inside `session`; a deleted or unknown id is absent. */
  async liveByIds(ids: readonly string[], session: ClientSession): Promise<FleetFuelCardDoc[]> {
    if (ids.length === 0) return [];
    return this.model
      .find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) }, isDeleted: false })
      .session(session)
      .lean<FleetFuelCardDoc[]>()
      .exec();
  }

  async totals(filter: FilterQuery<FleetFuelCardDoc>, now: Date): Promise<FleetFuelCardTotalsDto> {
    const pipeline: PipelineStage[] = [
      { $match: this.baseFilter(undefined, filter) },
      {
        $group: {
          _id: null,
          cardCount: { $sum: 1 },
          wataniyaBalance: {
            $sum: { $cond: [{ $eq: ['$company', 'wataniya'] }, '$balance', 0] },
          },
          chilloutBalance: {
            $sum: { $cond: [{ $eq: ['$company', 'chillout'] }, '$balance', 0] },
          },
          requestedCount: { $sum: { $cond: [{ $ne: ['$requestedAmount', null] }, 1, 0] } },
          requestedAmount: { $sum: { $ifNull: ['$requestedAmount', 0] } },
        },
      },
    ];
    const [row] = await this.model
      .aggregate<{
        cardCount: number;
        wataniyaBalance: number;
        chilloutBalance: number;
        requestedCount: number;
        requestedAmount: number;
      }>(pipeline)
      .exec();
    // «شُحن اليوم» — the CAIRO day (his «اليوم»), from its midnight; a charge the company's sheet
    // cancelled («أُلغي بشيت الشركة») is in the card's log only, and not counted here.
    const today = cairoDayRange(cairoDayOf(now));
    const [charged] = await FleetFuelCardMovementModel.aggregate<{ amount: number }>([
      {
        $match: {
          kind: 'charge',
          at: { $gte: today.start, $lt: today.end },
          isDeleted: false,
          cancelledBySheet: null,
        },
      },
      { $group: { _id: null, amount: { $sum: '$amount' } } },
    ]).exec();
    const round = (value: number): number => Math.round(value * 100) / 100;
    return {
      cardCount: row?.cardCount ?? 0,
      wataniyaBalance: round(row?.wataniyaBalance ?? 0),
      chilloutBalance: round(row?.chilloutBalance ?? 0),
      requestedCount: row?.requestedCount ?? 0,
      requestedAmount: round(row?.requestedAmount ?? 0),
      chargedTodayAmount: round(charged?.amount ?? 0),
    };
  }
}

export const fleetFuelCardRepository = new FleetFuelCardRepository();

class FleetFuelCardMovementRepository extends BaseRepository<FleetFuelCardMovementDoc> {
  constructor() {
    super(FleetFuelCardMovementModel, {});
  }

  /**
   * The cards among `cardIds` whose log changed at or after `since` — a line written, edited or
   * removed (a removed line is still on file, so deleted lines count too), read inside `session`.
   * `updatedAt`, not `at`: a receipt line carries the receipt's own (past) day.
   *
   * Loosened on purpose (batch 3): a `sheetLink` line — the card moved car by a decision on the
   * same sheet — moves no money, and does not refuse the balance ✓ that follows it.
   */
  async cardsMovedSince(
    cardIds: readonly string[],
    since: Date,
    session: ClientSession,
  ): Promise<Set<string>> {
    if (cardIds.length === 0) return new Set();
    const moved = await this.model
      .distinct('cardId', {
        cardId: { $in: cardIds.map((id) => new Types.ObjectId(id)) },
        updatedAt: { $gte: since },
        kind: { $ne: 'sheetLink' },
      })
      .session(session)
      .exec();
    return new Set(moved.map((id) => String(id)));
  }
}

export const fleetFuelCardMovementRepository = new FleetFuelCardMovementRepository();
