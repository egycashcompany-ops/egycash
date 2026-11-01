import { Types, type FilterQuery, type PipelineStage } from 'mongoose';
import {
  FLEET_SUPPLY_ALARM_RED_DAYS,
  FLEET_SUPPLY_ALARM_YELLOW_DAYS,
  type FleetSupplyAlarmLevel,
  type FleetVehicleContractTotalsDto,
  type Paginated,
} from '@ecms/contracts';
import {
  BaseRepository,
  type ListParams,
  type SortDerivedField,
} from '../../../shared/base/base.repository';
import { StaleDocumentError } from '../../../shared/errors';
import {
  FleetVehicleContractModel,
  type FleetVehicleContractDeliveryDoc,
  type FleetVehicleContractDoc,
  type FleetVehicleContractFileLinkDoc,
} from './vehicle-contract.model';
import { fromPiastres } from './vehicle-contract.figures';

// The list's arrows, «إنذار التوريد» and «الإحصائيات» read figures a contract never stores. Each is
// spelled ONCE here, as an aggregation expression over the stored document — the same rules as
// `figuresOf` / `alarmOf` (vehicle-contract.figures.ts) — and used to order the table before the
// page is cut, to filter it, and to sum the whole filtered set.

const DAY_MS = 86_400_000;

/** The live deliveries. */
const LIVE = {
  $filter: {
    input: { $ifNull: ['$deliveries', []] },
    cond: { $ne: ['$$this.isDeleted', true] },
  },
};
/** Cars contracted. */
export const CONTRACTED = { $sum: { $ifNull: ['$lines.count', []] } };
/** Cars received by the live deliveries. */
export const RECEIVED = {
  $reduce: {
    input: LIVE,
    initialValue: 0,
    in: { $add: ['$$value', { $sum: { $ifNull: ['$$this.counts.count', []] } }] },
  },
};
/** Cars still owed. */
export const REMAINING = { $subtract: [CONTRACTED, RECEIVED] };
/** Σ count × unit price, in whole piastres — a line without a price counts 0. */
export const TOTAL_PIASTRES = {
  $reduce: {
    input: { $ifNull: ['$lines', []] },
    initialValue: 0,
    in: {
      $add: [
        '$$value',
        {
          $multiply: [
            { $round: [{ $multiply: [{ $ifNull: ['$$this.unitPrice', 0] }, 100] }, 0] },
            '$$this.count',
          ],
        },
      ],
    },
  },
};
/** Received out of contracted — «المستلم من المتعاقد عليه». */
const RECEIVED_SHARE = {
  $cond: [{ $gt: [CONTRACTED, 0] }, { $divide: [RECEIVED, CONTRACTED] }, 0],
};

/**
 * «إنذار التوريد» as one orderable number: red above yellow, and within a level the nearest (or the
 * most overdue) deadline first when sorted descending. `null` — no alarm — sorts last whichever way
 * the arrow points (the base repository's missing-value rule).
 */
const alarmRank = (today: Date) => {
  const days = { $divide: [{ $subtract: ['$deadline', today] }, DAY_MS] };
  return {
    $cond: [
      {
        $and: [
          { $gt: [REMAINING, 0] },
          { $ne: [{ $ifNull: ['$deadline', null] }, null] },
          { $lte: [days, FLEET_SUPPLY_ALARM_YELLOW_DAYS] },
        ],
      },
      {
        $subtract: [
          { $cond: [{ $lte: [days, FLEET_SUPPLY_ALARM_RED_DAYS] }, 200_000, 100_000] },
          days,
        ],
      },
      null,
    ],
  };
};

/** The table's computed sort keys, built per call with the server's today. */
const contractSorts = (today: Date): SortDerivedField[] => [
  { key: 'total', expression: TOTAL_PIASTRES },
  { key: 'receivedShare', expression: RECEIVED_SHARE },
  { key: 'remaining', expression: REMAINING },
  { key: 'alarmRank', expression: alarmRank(today) },
];

/**
 * Contracts whose alarm is at one of `levels` on `today` (UTC midnight): something still owed, and
 * the deadline within 7 days or past it (red), or 8 to 30 days away (yellow).
 */
export const alarmClause = (
  levels: readonly FleetSupplyAlarmLevel[],
  today: Date,
): FilterQuery<FleetVehicleContractDoc> => {
  const red = new Date(today.getTime() + FLEET_SUPPLY_ALARM_RED_DAYS * DAY_MS);
  const yellow = new Date(today.getTime() + FLEET_SUPPLY_ALARM_YELLOW_DAYS * DAY_MS);
  const windows: FilterQuery<FleetVehicleContractDoc>[] = [];
  if (levels.includes('red')) windows.push({ deadline: { $ne: null, $lte: red } });
  if (levels.includes('yellow')) windows.push({ deadline: { $gt: red, $lte: yellow } });
  return { $and: [{ $or: windows }, { $expr: { $gt: [REMAINING, 0] } }] };
};

interface TotalsRow {
  count: number;
  piastres: number;
  contracted: number;
  received: number;
}

class FleetVehicleContractRepository extends BaseRepository<FleetVehicleContractDoc> {
  constructor() {
    // No org placement: a contract is the department's paperwork, read by its grants alone.
    super(FleetVehicleContractModel, {});
  }

  async listContracts(
    params: ListParams<FleetVehicleContractDoc>,
    today: Date,
  ): Promise<Paginated<FleetVehicleContractDoc>> {
    const derived = contractSorts(today);
    return this.list({
      ...params,
      sortableFields: ['date', 'no', 'supplier', 'deadline', ...derived.map((f) => f.key)],
      sortDerived: derived,
    });
  }

  /** «الإحصائيات» over EVERY contract `filter` matches — never over a page. */
  async totals(
    filter: FilterQuery<FleetVehicleContractDoc>,
  ): Promise<FleetVehicleContractTotalsDto> {
    const pipeline: PipelineStage[] = [
      { $match: this.baseFilter(undefined, filter) },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          piastres: { $sum: TOTAL_PIASTRES },
          contracted: { $sum: CONTRACTED },
          received: { $sum: RECEIVED },
        },
      },
    ];
    const [row] = await this.model.aggregate<TotalsRow>(pipeline).exec();
    return {
      count: row?.count ?? 0,
      value: fromPiastres(row?.piastres ?? 0),
      contracted: row?.contracted ?? 0,
      received: row?.received ?? 0,
    };
  }

  /** The suppliers the live contracts name, in Arabic order — the «المورد» filter's options. */
  async suppliers(): Promise<string[]> {
    const names = (await this.model
      .distinct('supplier', { isDeleted: false, supplier: { $ne: '' } })
      .exec()) as unknown[];
    return names
      .filter((name): name is string => typeof name === 'string' && name !== '')
      .sort((a, b) => a.localeCompare(b, 'ar'));
  }

  /** The highest number ever handed out — deleted contracts included, since none is reused. */
  async maxNo(): Promise<number> {
    const top = await this.model
      .findOne({})
      .sort({ no: -1 })
      .select({ no: 1 })
      .lean<{ no: number }>()
      .exec();
    return top?.no ?? 0;
  }

  /**
   * Write a delivery list change under the contract's version — a new delivery, or one replaced —
   * so «أكثر من المتبقي», checked on the version read, still holds when it lands. 409 when someone
   * wrote the contract in between; 404 when it is gone.
   */
  private async versioned(
    id: string,
    version: number,
    extra: FilterQuery<FleetVehicleContractDoc>,
    update: Record<string, unknown>,
  ): Promise<FleetVehicleContractDoc> {
    const updated = await this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), isDeleted: false, __v: version, ...extra },
        { ...update, $inc: { __v: 1 } },
        { new: true },
      )
      .lean<FleetVehicleContractDoc>()
      .exec();
    if (updated !== null) return updated;
    await this.getById(id); // 404 when the contract is gone
    throw new StaleDocumentError();
  }

  async pushDelivery(
    id: string,
    version: number,
    delivery: FleetVehicleContractDeliveryDoc,
    by: string,
  ): Promise<FleetVehicleContractDoc> {
    return this.versioned(
      id,
      version,
      {},
      { $push: { deliveries: delivery }, $set: { updatedBy: new Types.ObjectId(by) } },
    );
  }

  async replaceDelivery(
    id: string,
    version: number,
    deliveryId: string,
    change: Pick<FleetVehicleContractDeliveryDoc, 'date' | 'counts' | 'updatedAt' | 'updatedBy'>,
    by: string,
  ): Promise<FleetVehicleContractDoc> {
    return this.versioned(
      id,
      version,
      { deliveries: { $elemMatch: { _id: new Types.ObjectId(deliveryId), isDeleted: false } } },
      {
        $set: {
          'deliveries.$.date': change.date,
          'deliveries.$.counts': change.counts,
          'deliveries.$.updatedAt': change.updatedAt,
          'deliveries.$.updatedBy': change.updatedBy,
          updatedBy: new Types.ObjectId(by),
        },
      },
    );
  }

  /**
   * Hide one delivery; its cars return to «المتبقي». Bumps the version — a dialog opened before it
   * re-reads — but needs none: taking cars away can never push a line past its count.
   */
  async softDeleteDelivery(
    id: string,
    deliveryId: string,
    by: string,
  ): Promise<FleetVehicleContractDoc | null> {
    const who = new Types.ObjectId(by);
    return this.model
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          isDeleted: false,
          deliveries: { $elemMatch: { _id: new Types.ObjectId(deliveryId), isDeleted: false } },
        },
        {
          $set: {
            'deliveries.$.isDeleted': true,
            'deliveries.$.deletedAt': new Date(),
            'deliveries.$.deletedBy': who,
            updatedBy: who,
          },
          $inc: { __v: 1 },
        },
        { new: true },
      )
      .lean<FleetVehicleContractDoc>()
      .exec();
  }

  // ── Attachments: never bump the version, so an upload never makes an open editor stale ────────

  /** Link an uploaded file at the end. `false` when the contract is gone. */
  async pushFile(id: string, link: FleetVehicleContractFileLinkDoc): Promise<boolean> {
    const result = await this.model
      .updateOne({ _id: new Types.ObjectId(id), isDeleted: false }, { $push: { files: link } })
      .exec();
    return result.matchedCount === 1;
  }

  /** Hide one live attachment link. `false` when there was none to hide. */
  async softDeleteFile(id: string, fileId: string, by: string): Promise<boolean> {
    const result = await this.model
      .updateOne(
        {
          _id: new Types.ObjectId(id),
          isDeleted: false,
          files: { $elemMatch: { fileId: new Types.ObjectId(fileId), isDeleted: false } },
        },
        {
          $set: {
            'files.$.isDeleted': true,
            'files.$.deletedAt': new Date(),
            'files.$.deletedBy': new Types.ObjectId(by),
          },
        },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  /**
   * Write the attachments' new order: the live links as asked, then the hidden ones as they were.
   * Only while the live set is still exactly the one the order was built from — `false` when an
   * upload or a removal landed in between.
   */
  async reorderFiles(
    id: string,
    live: readonly FleetVehicleContractFileLinkDoc[],
    hidden: readonly FleetVehicleContractFileLinkDoc[],
  ): Promise<boolean> {
    const liveIds = live.map((link) => link.fileId);
    const result = await this.model
      .updateOne(
        {
          _id: new Types.ObjectId(id),
          isDeleted: false,
          $expr: {
            $and: [
              {
                $setEquals: [
                  {
                    $map: {
                      input: {
                        $filter: {
                          input: { $ifNull: ['$files', []] },
                          cond: { $ne: ['$$this.isDeleted', true] },
                        },
                      },
                      in: '$$this.fileId',
                    },
                  },
                  liveIds,
                ],
              },
              { $eq: [{ $size: { $ifNull: ['$files', []] } }, live.length + hidden.length] },
            ],
          },
        },
        { $set: { files: [...live, ...hidden] } },
      )
      .exec();
    return result.matchedCount === 1;
  }
}

export const fleetVehicleContractRepository = new FleetVehicleContractRepository();
