import { Types, type ClientSession, type FilterQuery, type PipelineStage } from 'mongoose';
import { type FleetFuelCardCompany, type FleetFuelCardTotalsDto } from '@ecms/contracts';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import { VEHICLE_CODE_SORT } from '../vehicles/vehicle.repository';
import {
  FleetFuelCardModel,
  FleetFuelCardMovementModel,
  type FleetFuelCardDoc,
  type FleetFuelCardMovementDoc,
} from './fuel-card.model';

const DAY_MS = 24 * 60 * 60 * 1000;

class FleetFuelCardRepository extends BaseRepository<FleetFuelCardDoc> {
  constructor() {
    super(FleetFuelCardModel, {});
  }

  cardFilter(query: {
    vehicleIds?: readonly string[] | undefined;
    company?: FleetFuelCardCompany | undefined;
    number?: string | undefined;
    expiresBefore?: Date | undefined;
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
    const since = new Date(now.getTime() - DAY_MS);
    const [charged] = await FleetFuelCardMovementModel.aggregate<{ amount: number }>([
      { $match: { kind: 'charge', at: { $gte: since }, isDeleted: false } },
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
}

export const fleetFuelCardMovementRepository = new FleetFuelCardMovementRepository();
