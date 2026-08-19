// Every database query the customer portal makes — all of them, and nothing else.
//
// The rule this file exists to make checkable: a portal query is confined to ONE customer, and the
// confinement cannot be widened by anything the caller sends. Two mechanics enforce it, and both
// are worth stating because either alone would be weaker:
//
//   · the company arrives as a `PortalCompany`, which only `requireGoldPortal` can mint — so the
//     value can never have come from the request;
//   · it is composed with `$and`, never spread. Spread-last is only correct while the ordering
//     discipline holds; `$and` cannot be widened from either side. That matters here because
//     `gold_bars.companyId` is nullable and Mongoose drops `undefined` from a query, so a filter
//     that went wrong in the wrong way would match EVERY row rather than none.
//
// Status: the customer sees CONFIRMED documents only. A draft is work the vault has not committed
// to, and gold's own portal showing them is the one behaviour deliberately not carried across.
import { type FilterQuery, type PipelineStage, type Types } from 'mongoose';
import {
  type GoldPortalBarsQuery,
  type GoldPortalListQuery,
} from '@ecms/contracts';
import { GoldBarModel, type GoldBarDoc } from '../bars/bar.model';
import { GoldDeliveryReceiptModel } from '../delivery/delivery-receipt.model';
import { GoldKeyHandoverModel } from '../keys/key-handover.model';
import { GoldReceivingReceiptModel } from '../receiving/receiving-receipt.model';
import { GoldRepresentativeModel } from '../representatives/representative.model';
import { GoldTransferModel } from '../transfers/transfer.model';
import { portalCompanyId, type PortalCompany } from './portal-scope';

/** Live rows belonging to this customer, and nothing the caller can add may widen it. */
const mine = <T>(company: PortalCompany, extra: FilterQuery<T> = {}): FilterQuery<T> =>
  ({
    $and: [{ isDeleted: false, companyId: portalCompanyId(company) }, extra],
  }) as FilterQuery<T>;

/** The confirmed-document clause, shared by receiving, delivery and transfers. */
const CONFIRMED = { status: 'confirmed' } as const;

const paging = (query: { page: number; pageSize: number }) => ({
  skip: (Math.max(1, query.page) - 1) * query.pageSize,
  limit: query.pageSize,
});

export interface PortalPage<T> {
  items: T[];
  totalItems: number;
}

// ── Bars ───────────────────────────────────────────────────────────────────

export const portalBars = async (
  company: PortalCompany,
  query: GoldPortalBarsQuery,
): Promise<PortalPage<GoldBarDoc>> => {
  const extra: FilterQuery<GoldBarDoc> = {};
  if (query.metalType !== undefined) extra.metalType = query.metalType;
  if (query.search !== undefined && query.search !== '') {
    extra.serialNumber = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
  const filter = mine<GoldBarDoc>(company, extra);
  const { skip, limit } = paging(query);
  const [items, totalItems] = await Promise.all([
    GoldBarModel.find(filter).sort({ serialNumber: 1 }).skip(skip).limit(limit).lean<GoldBarDoc[]>().exec(),
    GoldBarModel.countDocuments(filter).exec(),
  ]);
  return { items, totalItems };
};

// ── Drawers ────────────────────────────────────────────────────────────────

export interface PortalDrawerRow {
  drawerId: Types.ObjectId;
  number: number;
  label: string;
  vaultName: string | null;
  myBarsCount: number;
  myWeight: number;
}

/**
 * The drawers this customer's metal is sitting in, with THEIR counts.
 *
 * A drawer can hold several owners' bars; the aggregation starts from the customer's own bars, so
 * the totals are theirs alone and another owner's share is never visible or even summed.
 */
export const portalDrawers = async (company: PortalCompany): Promise<PortalDrawerRow[]> => {
  const pipeline: PipelineStage[] = [
    {
      $match: {
        isDeleted: false,
        companyId: portalCompanyId(company),
        status: 'in_vault',
        currentDrawerId: { $ne: null },
      },
    },
    { $group: { _id: '$currentDrawerId', myBarsCount: { $sum: 1 }, myWeight: { $sum: '$weight' } } },
    { $lookup: { from: 'gold_drawers', localField: '_id', foreignField: '_id', as: 'drawer' } },
    { $unwind: '$drawer' },
    { $lookup: { from: 'gold_vaults', localField: 'drawer.vaultId', foreignField: '_id', as: 'vault' } },
    { $unwind: { path: '$vault', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        drawerId: '$_id',
        number: '$drawer.number',
        label: '$drawer.label',
        vaultName: '$vault.name',
        myBarsCount: 1,
        myWeight: 1,
      },
    },
    { $sort: { number: 1 } },
  ];
  return GoldBarModel.aggregate<PortalDrawerRow>(pipeline).exec();
};

// ── Documents ──────────────────────────────────────────────────────────────

/**
 * Receiving and delivery are read identically; they are written twice rather than through one
 * helper because Mongoose's `Model` type does not survive being widened to a union of two models,
 * and the shared version cost more in casts than the duplication costs in lines.
 */
export const portalReceiving = async <T>(
  company: PortalCompany,
  query: GoldPortalListQuery,
): Promise<PortalPage<T>> => {
  const filter = mine(company, CONFIRMED);
  const { skip, limit } = paging(query);
  const [items, totalItems] = await Promise.all([
    GoldReceivingReceiptModel.find(filter)
      .sort({ receiptDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<T[]>()
      .exec(),
    GoldReceivingReceiptModel.countDocuments(filter).exec(),
  ]);
  return { items, totalItems };
};

export const portalDelivery = async <T>(
  company: PortalCompany,
  query: GoldPortalListQuery,
): Promise<PortalPage<T>> => {
  const filter = mine(company, CONFIRMED);
  const { skip, limit } = paging(query);
  const [items, totalItems] = await Promise.all([
    GoldDeliveryReceiptModel.find(filter)
      .sort({ receiptDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<T[]>()
      .exec(),
    GoldDeliveryReceiptModel.countDocuments(filter).exec(),
  ]);
  return { items, totalItems };
};

/**
 * Transfers touch a customer from EITHER side, so this is the one read whose clause is not a plain
 * `companyId` equality. The `$or` sits inside the `$and`, which is exactly why `$and` composition
 * matters: spread would have let a stray `companyId` key sit beside it and match everything.
 */
export const portalTransfers = async <T>(
  company: PortalCompany,
  query: GoldPortalListQuery,
): Promise<PortalPage<T>> => {
  const id = portalCompanyId(company);
  const filter = {
    $and: [
      { isDeleted: false },
      CONFIRMED,
      { $or: [{ currentOwnerId: id }, { newOwnerId: id }] },
    ],
  };
  const { skip, limit } = paging(query);
  const [items, totalItems] = await Promise.all([
    GoldTransferModel.find(filter)
      .sort({ transferDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<T[]>()
      .exec(),
    GoldTransferModel.countDocuments(filter).exec(),
  ]);
  return { items, totalItems };
};

// ── Keys and delegates ─────────────────────────────────────────────────────

export const portalKeys = async <T>(
  company: PortalCompany,
  query: GoldPortalListQuery,
): Promise<PortalPage<T>> => {
  const filter = mine(company);
  const { skip, limit } = paging(query);
  const [items, totalItems] = await Promise.all([
    GoldKeyHandoverModel.find(filter)
      .sort({ handoverDate: -1 })
      .skip(skip)
      .limit(limit)
      .lean<T[]>()
      .exec(),
    GoldKeyHandoverModel.countDocuments(filter).exec(),
  ]);
  return { items, totalItems };
};

export const portalRepresentatives = async <T>(
  company: PortalCompany,
  query: GoldPortalListQuery,
): Promise<PortalPage<T>> => {
  const filter = mine(company);
  const { skip, limit } = paging(query);
  const [items, totalItems] = await Promise.all([
    GoldRepresentativeModel.find(filter)
      .sort({ fullName: 1 })
      .skip(skip)
      .limit(limit)
      .lean<T[]>()
      .exec(),
    GoldRepresentativeModel.countDocuments(filter).exec(),
  ]);
  return { items, totalItems };
};

// ── Overview ───────────────────────────────────────────────────────────────

export interface PortalTotals {
  inVaultCount: number;
  inVaultWeight: number;
  byMetal: { metalType: string; count: number; weight: number }[];
  drawerCount: number;
  receivingCount: number;
  deliveryCount: number;
  transferCount: number;
  keysCount: number;
  representativesCount: number;
}

export const portalTotals = async (company: PortalCompany): Promise<PortalTotals> => {
  const id = portalCompanyId(company);
  const inVault = { isDeleted: false, companyId: id, status: 'in_vault' };
  const [totals, byMetal, drawerIds, receivingCount, deliveryCount, transferCount, keysCount, repsCount] =
    await Promise.all([
      GoldBarModel.aggregate<{ count: number; weight: number }>([
        { $match: inVault },
        { $group: { _id: null, count: { $sum: 1 }, weight: { $sum: '$weight' } } },
      ]).exec(),
      GoldBarModel.aggregate<{ _id: string; count: number; weight: number }>([
        { $match: inVault },
        { $group: { _id: '$metalType', count: { $sum: 1 }, weight: { $sum: '$weight' } } },
      ]).exec(),
      GoldBarModel.distinct('currentDrawerId', inVault).exec(),
      GoldReceivingReceiptModel.countDocuments(mine(company, CONFIRMED)).exec(),
      GoldDeliveryReceiptModel.countDocuments(mine(company, CONFIRMED)).exec(),
      GoldTransferModel.countDocuments({
        $and: [{ isDeleted: false }, CONFIRMED, { $or: [{ currentOwnerId: id }, { newOwnerId: id }] }],
      }).exec(),
      GoldKeyHandoverModel.countDocuments(mine(company)).exec(),
      GoldRepresentativeModel.countDocuments(mine(company)).exec(),
    ]);
  return {
    inVaultCount: totals[0]?.count ?? 0,
    inVaultWeight: totals[0]?.weight ?? 0,
    byMetal: byMetal.map((row) => ({ metalType: row._id, count: row.count, weight: row.weight })),
    drawerCount: drawerIds.filter((value) => value !== null && value !== undefined).length,
    receivingCount,
    deliveryCount,
    transferCount,
    keysCount,
    representativesCount: repsCount,
  };
};
