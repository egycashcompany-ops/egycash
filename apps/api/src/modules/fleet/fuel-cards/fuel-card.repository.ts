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

  /**
   * The cards' totals over `filter` — one `$group` — and «شُحن اليوم» beside them.
   *
   * «شُحن اليوم» is the CAIRO day (his «اليوم»), from its midnight; a charge the company's sheet
   * cancelled («أُلغي بشيت الشركة») is in the card's log only, and not counted. It follows the cards
   * `chargedOver` names (`filter` when none is given; the service passes the query's card-identity
   * part — company, cars, branch, number — never its state filter): under a non-empty one only the
   * charges of the matched cards count, a card deleted since included (its charge stays in the
   * day, as the company view counts it) — one `distinct` more; with none, every charge of the day,
   * as it always was. `charged: false` skips it (0) for a caller that reads only the counts — the
   * fleet dashboard asks it once, of the summary that shows it.
   */
  async totals(
    filter: FilterQuery<FleetFuelCardDoc>,
    now: Date,
    opts: { charged?: boolean; chargedOver?: FilterQuery<FleetFuelCardDoc> } = {},
  ): Promise<FleetFuelCardTotalsDto> {
    const match = this.baseFilter(undefined, filter);
    const pipeline: PipelineStage[] = [
      { $match: match },
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
          // The cards of each company, and the cards on no car («سفر»، «اسبير») with their balance —
          // in the same pass, never a second read.
          wataniyaCards: { $sum: { $cond: [{ $eq: ['$company', 'wataniya'] }, 1, 0] } },
          chilloutCards: { $sum: { $cond: [{ $eq: ['$company', 'chillout'] }, 1, 0] } },
          noCarCards: {
            $sum: { $cond: [{ $eq: [{ $ifNull: ['$vehicleId', null] }, null] }, 1, 0] },
          },
          noCarBalance: {
            $sum: {
              $cond: [{ $eq: [{ $ifNull: ['$vehicleId', null] }, null] }, '$balance', 0],
            },
          },
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
        wataniyaCards: number;
        chilloutCards: number;
        noCarCards: number;
        noCarBalance: number;
      }>(pipeline)
      .exec();
    const round = (value: number): number => Math.round(value * 100) / 100;
    return {
      cardCount: row?.cardCount ?? 0,
      wataniyaBalance: round(row?.wataniyaBalance ?? 0),
      chilloutBalance: round(row?.chilloutBalance ?? 0),
      requestedCount: row?.requestedCount ?? 0,
      requestedAmount: round(row?.requestedAmount ?? 0),
      chargedTodayAmount:
        opts.charged === false ? 0 : await this.chargedToday(opts.chargedOver ?? filter, now),
      wataniyaCards: row?.wataniyaCards ?? 0,
      chilloutCards: row?.chilloutCards ?? 0,
      noCarCards: row?.noCarCards ?? 0,
      noCarBalance: round(row?.noCarBalance ?? 0),
    };
  }

  /** «شُحن اليوم» over the cards `filter` matches (every card when it is empty) — see `totals`. */
  private async chargedToday(filter: FilterQuery<FleetFuelCardDoc>, now: Date): Promise<number> {
    const today = cairoDayRange(cairoDayOf(now));
    const narrowed = Object.keys(filter).length > 0;
    const cardIds = narrowed ? await this.idsOfAny(filter) : null;
    if (cardIds !== null && cardIds.length === 0) return 0;
    const [charged] = await FleetFuelCardMovementModel.aggregate<{ amount: number }>([
      {
        $match: {
          kind: 'charge',
          at: { $gte: today.start, $lt: today.end },
          isDeleted: false,
          cancelledBySheet: null,
          ...(cardIds === null ? {} : { cardId: { $in: cardIds } }),
        },
      },
      { $group: { _id: null, amount: { $sum: '$amount' } } },
    ]).exec();
    return Math.round((charged?.amount ?? 0) * 100) / 100;
  }

  /**
   * Every card `filter` matches, by id — a DELETED card too (no soft-delete clause): what a card
   * left behind (today's charges, a stored sheet's lines) is history and still counts by its car.
   */
  async idsOfAny(filter: FilterQuery<FleetFuelCardDoc>): Promise<Types.ObjectId[]> {
    return this.model.distinct('_id', filter).exec() as Promise<Types.ObjectId[]>;
  }

  /**
   * «أقربها» — the live card `filter` matches with the EARLIEST expiry (the window is the caller's
   * `expiresFrom` / `expiresBefore`), through `ix_fuel_card_expires`; `null` when none.
   */
  async nearestExpiry(filter: FilterQuery<FleetFuelCardDoc>): Promise<Date | null> {
    const card = await this.model
      .findOne(this.baseFilter(undefined, filter))
      .sort({ expiresAt: 1, _id: 1 })
      .select({ expiresAt: 1 })
      .lean<{ expiresAt: Date | null }>()
      .exec();
    return card?.expiresAt ?? null;
  }

  /**
   * «كروت تحتاج متابعة» — every live card `filter` matches that is flagged ANY way: expired (on or
   * before `expiredBefore`), expiring (in `expiringFrom` … `expiringBefore`), a balance below the
   * red or the yellow line, or a «طلب رصيد» waiting. The states and the order are the service's;
   * this only reads the flagged set (a fleet holds some 150 cards).
   */
  async flagged(
    filter: FilterQuery<FleetFuelCardDoc>,
    rules: {
      expiredBefore: Date;
      expiringFrom: Date;
      expiringBefore: Date;
      yellowAt: number;
      redAt: number;
    },
  ): Promise<FleetFuelCardDoc[]> {
    const flaggedAnyWay: FilterQuery<FleetFuelCardDoc> = {
      $or: [
        { expiresAt: { $lte: rules.expiredBefore } },
        { expiresAt: { $gte: rules.expiringFrom, $lte: rules.expiringBefore } },
        { balance: { $lt: Math.max(rules.yellowAt, rules.redAt) } },
        { requestedAmount: { $ne: null } },
      ],
    };
    return this.model
      .find(this.baseFilter(undefined, { $and: [filter, flaggedAnyWay] }))
      .lean<FleetFuelCardDoc[]>()
      .exec();
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
