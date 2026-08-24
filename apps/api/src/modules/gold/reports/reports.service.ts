// التقارير — the printed statements (gold `controllers/reports.controller.js`).
//
// The arithmetic in this file is the part of the gold system that an auditor reads, so it is
// carried across unchanged, including the one idea that makes it work:
//
//   A CLOSING BALANCE IS NOT SUMMED FORWARD — IT IS REWOUND BACKWARDS.
//
// The system stores what is in the vault RIGHT NOW, and every confirmed movement with a date. So
// the balance at the end of a period is the current balance minus everything that happened after
// it: `closing(end) = current − receivedAfter − transferInAfter + deliveredAfter + transferOutAfter`.
// Summing movements forward from zero would instead report a number that drifts from reality the
// moment any historical document is corrected. The monthly report applies the same rewind month by
// month, anchored on today's balance.
import {
  type GoldClientBalanceRowDto,
  type GoldClientBalancesDto,
  type GoldClientBalancesQuery,
  type GoldFundClosingDto,
  type GoldFundClosingMonthDto,
  type GoldFundMovementDto,
  type GoldFundMovementQuery,
  type GoldFundMovementRowDto,
} from '@ecms/contracts';
import { Types, type Model, type PipelineStage } from 'mongoose';
import { type ScopeSelector } from '../../../shared/types';
import { GoldBarModel } from '../bars/bar.model';
import { GoldCompanyModel } from '../companies/company.model';
import { GoldReceivingReceiptModel } from '../receiving/receiving-receipt.model';
import { GoldDeliveryReceiptModel } from '../delivery/delivery-receipt.model';
import { GoldTransferModel } from '../transfers/transfer.model';
import { scopeClause } from '../shared/scope-clause';

interface Totals {
  count: number;
  weight: number;
}
const ZERO: Totals = { count: 0, weight: 0 };

const toId = (value: string): Types.ObjectId => new Types.ObjectId(value);

/** Bars of one metal from CONFIRMED receipts in a window, grouped by the owning company. */
const receiptMove = async <T>(
  model: Model<T>,
  metalType: string,
  branch: Record<string, unknown>,
  dateCond: Record<string, unknown>,
): Promise<{ _id: Types.ObjectId | null; count: number; weight: number }[]> =>
  model
    .aggregate<{ _id: Types.ObjectId | null; count: number; weight: number }>([
      { $match: { status: 'confirmed', isDeleted: false, ...dateCond, ...branch } },
      { $lookup: { from: 'gold_bars', localField: 'barIds', foreignField: '_id', as: 'b' } },
      { $unwind: '$b' },
      { $match: { 'b.metalType': metalType } },
      { $group: { _id: '$companyId', count: { $sum: 1 }, weight: { $sum: '$b.weight' } } },
    ])
    .exec();

/**
 * Transfer totals of one metal grouped by one side of the deal.
 * `newOwnerId` = what a fund GAINED, `currentOwnerId` = what it LOST.
 */
const transferMove = async (
  metalType: string,
  branch: Record<string, unknown>,
  ownerField: 'newOwnerId' | 'currentOwnerId',
  dateCond: Record<string, unknown>,
): Promise<{ _id: Types.ObjectId | null; count: number; weight: number }[]> =>
  GoldTransferModel.aggregate<{ _id: Types.ObjectId | null; count: number; weight: number }>([
    { $match: { status: 'confirmed', isDeleted: false, metalType, ...dateCond, ...branch } },
    {
      $group: {
        _id: `$${ownerField}`,
        count: { $sum: { $ifNull: ['$barsCount', 0] } },
        weight: { $sum: { $ifNull: ['$totalWeight', 0] } },
      },
    },
  ]).exec();

const mapOf = (rows: { _id: Types.ObjectId | null; count: number; weight: number }[]) =>
  new Map(rows.map((r) => [String(r._id), { count: r.count, weight: r.weight }]));
const get = (map: Map<string, Totals>, id: string): Totals => map.get(id) ?? ZERO;

class GoldReportsService {
  /** اجمالى ارصدة العملاء — what every client currently holds, of one metal. */
  async clientBalances(
    query: GoldClientBalancesQuery,
    scope: ScopeSelector,
  ): Promise<GoldClientBalancesDto> {
    const match: Record<string, unknown> = {
      status: 'in_vault',
      isDeleted: false,
      companyId: { $ne: null },
      metalType: query.metalType,
      ...scopeClause(scope),
    };
    if (query.funds !== undefined) match.companyId = { $in: query.funds.map(toId) };

    const rows = await GoldBarModel.aggregate<GoldClientBalanceRowDto>([
      { $match: match },
      { $group: { _id: '$companyId', count: { $sum: 1 }, weight: { $sum: '$weight' } } },
      { $lookup: { from: 'gold_companies', localField: '_id', foreignField: '_id', as: 'c' } },
      { $unwind: '$c' },
      ...(query.ownerType === undefined
        ? []
        : [{ $match: { 'c.type': query.ownerType } } as PipelineStage]),
      {
        $project: {
          _id: 0,
          companyId: { $toString: '$_id' },
          name: '$c.name',
          type: '$c.type',
          count: 1,
          weight: 1,
        },
      },
      { $sort: { name: 1 } },
    ]).exec();

    const totals = rows.reduce(
      (acc, row) => ({ count: acc.count + row.count, weight: acc.weight + row.weight }),
      ZERO,
    );
    return { rows, totals, metalType: query.metalType };
  }

  /**
   * معدل الحركة الشهرى — movement inside a window, plus the accurate closing balance at its end.
   * Movement is summed inside the period; the balance is the rewind described at the top.
   */
  async fundMovement(
    query: GoldFundMovementQuery,
    scope: ScopeSelector,
  ): Promise<GoldFundMovementDto> {
    const metalType = query.metalType;
    const year = query.year ?? new Date().getFullYear();
    const fromMonth = Math.min(12, Math.max(1, query.fromMonth ?? 1));
    const toMonth = Math.min(12, Math.max(fromMonth, query.toMonth ?? fromMonth));
    const start = new Date(Date.UTC(year, fromMonth - 1, 1));
    const end = new Date(Date.UTC(year, toMonth, 1)); // exclusive end of toMonth
    const branch = scopeClause(scope);

    const period = { $gte: start, $lt: end };
    const after = { $gte: end };

    const [current, recvP, delivP, tInP, tOutP, recvA, delivA, tInA, tOutA] = await Promise.all([
      GoldBarModel.aggregate<{ _id: Types.ObjectId | null; count: number; weight: number }>([
        {
          $match: {
            status: 'in_vault',
            isDeleted: false,
            metalType,
            companyId: { $ne: null },
            ...branch,
          },
        },
        { $group: { _id: '$companyId', count: { $sum: 1 }, weight: { $sum: '$weight' } } },
      ]).exec(),
      receiptMove(GoldReceivingReceiptModel, metalType, branch, { receiptDate: period }),
      receiptMove(GoldDeliveryReceiptModel, metalType, branch, { receiptDate: period }),
      transferMove(metalType, branch, 'newOwnerId', { transferDate: period }),
      transferMove(metalType, branch, 'currentOwnerId', { transferDate: period }),
      receiptMove(GoldReceivingReceiptModel, metalType, branch, { receiptDate: after }),
      receiptMove(GoldDeliveryReceiptModel, metalType, branch, { receiptDate: after }),
      transferMove(metalType, branch, 'newOwnerId', { transferDate: after }),
      transferMove(metalType, branch, 'currentOwnerId', { transferDate: after }),
    ]);

    const cur = mapOf(current);
    const rP = mapOf(recvP);
    const dP = mapOf(delivP);
    const iP = mapOf(tInP);
    const oP = mapOf(tOutP);
    const rA = mapOf(recvA);
    const dA = mapOf(delivA);
    const iA = mapOf(tInA);
    const oA = mapOf(tOutA);

    const allIds = [
      ...new Set([cur, rP, dP, iP, oP, rA, dA, iA, oA].flatMap((map) => [...map.keys()])),
    ];
    const wanted =
      query.funds === undefined ? allIds : allIds.filter((id) => query.funds?.includes(id));
    const companies =
      wanted.length === 0
        ? []
        : await GoldCompanyModel.find({ _id: { $in: wanted.map(toId) }, type: 'fund' })
            .select('name')
            .lean<{ _id: Types.ObjectId; name: string }[]>()
            .exec();

    const rows: GoldFundMovementRowDto[] = companies
      .map((company) => {
        const id = String(company._id);
        const inCount = get(rP, id).count + get(iP, id).count;
        const inWeight = get(rP, id).weight + get(iP, id).weight;
        const outCount = get(dP, id).count + get(oP, id).count;
        const outWeight = get(dP, id).weight + get(oP, id).weight;
        // closing(end) = current − receivedAfter − transferInAfter + deliveredAfter + transferOutAfter
        const balanceCount =
          get(cur, id).count -
          get(rA, id).count -
          get(iA, id).count +
          get(dA, id).count +
          get(oA, id).count;
        const balanceWeight =
          get(cur, id).weight -
          get(rA, id).weight -
          get(iA, id).weight +
          get(dA, id).weight +
          get(oA, id).weight;
        return {
          companyId: id,
          name: company.name,
          inCount,
          outCount,
          inWeight,
          outWeight,
          netWeight: inWeight - outWeight,
          balanceCount,
          balanceWeight,
        };
      })
      .filter(
        (row) =>
          row.inCount !== 0 ||
          row.outCount !== 0 ||
          row.inWeight !== 0 ||
          row.outWeight !== 0 ||
          row.balanceCount !== 0 ||
          row.balanceWeight !== 0,
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));

    const totals = rows.reduce(
      (acc, row) => ({
        inCount: acc.inCount + row.inCount,
        outCount: acc.outCount + row.outCount,
        inWeight: acc.inWeight + row.inWeight,
        outWeight: acc.outWeight + row.outWeight,
        netWeight: acc.netWeight + row.netWeight,
        balanceCount: acc.balanceCount + row.balanceCount,
        balanceWeight: acc.balanceWeight + row.balanceWeight,
      }),
      {
        inCount: 0,
        outCount: 0,
        inWeight: 0,
        outWeight: 0,
        netWeight: 0,
        balanceCount: 0,
        balanceWeight: 0,
      },
    );

    return { rows, totals, metalType, year, fromMonth, toMonth };
  }

  /** تقرير الإقفال الشهرى — the whole ledger, month by month, one section per fund. */
  async fundClosing(
    query: GoldFundMovementQuery,
    scope: ScopeSelector,
  ): Promise<GoldFundClosingDto> {
    const metalType = query.metalType;
    const branch = scopeClause(scope);
    const hasRange =
      query.year !== undefined && query.fromMonth !== undefined && query.toMonth !== undefined;

    const byMonth = async <T>(
      model: Model<T>,
      dateField: string,
    ): Promise<
      { _id: { c: Types.ObjectId | null; y: number; m: number }; count: number; weight: number }[]
    > =>
      model
        .aggregate<{
          _id: { c: Types.ObjectId | null; y: number; m: number };
          count: number;
          weight: number;
        }>([
          { $match: { status: 'confirmed', isDeleted: false, ...branch } },
          { $lookup: { from: 'gold_bars', localField: 'barIds', foreignField: '_id', as: 'b' } },
          { $unwind: '$b' },
          { $match: { 'b.metalType': metalType } },
          {
            $group: {
              _id: {
                c: '$companyId',
                y: { $year: `$${dateField}` },
                m: { $month: `$${dateField}` },
              },
              count: { $sum: 1 },
              weight: { $sum: '$b.weight' },
            },
          },
        ])
        .exec();

    const transfersByMonth = async (
      ownerField: 'newOwnerId' | 'currentOwnerId',
    ): Promise<
      { _id: { c: Types.ObjectId | null; y: number; m: number }; count: number; weight: number }[]
    > =>
      GoldTransferModel.aggregate<{
        _id: { c: Types.ObjectId | null; y: number; m: number };
        count: number;
        weight: number;
      }>([
        { $match: { status: 'confirmed', isDeleted: false, metalType, ...branch } },
        {
          $group: {
            _id: {
              c: `$${ownerField}`,
              y: { $year: '$transferDate' },
              m: { $month: '$transferDate' },
            },
            count: { $sum: { $ifNull: ['$barsCount', 0] } },
            weight: { $sum: { $ifNull: ['$totalWeight', 0] } },
          },
        },
      ]).exec();

    const [current, recvA, delivA, tInA, tOutA] = await Promise.all([
      GoldBarModel.aggregate<{ _id: Types.ObjectId | null; count: number; weight: number }>([
        {
          $match: {
            status: 'in_vault',
            isDeleted: false,
            metalType,
            companyId: { $ne: null },
            ...branch,
          },
        },
        { $group: { _id: '$companyId', count: { $sum: 1 }, weight: { $sum: '$weight' } } },
      ]).exec(),
      byMonth(GoldReceivingReceiptModel, 'receiptDate'),
      byMonth(GoldDeliveryReceiptModel, 'receiptDate'),
      transfersByMonth('newOwnerId'),
      transfersByMonth('currentOwnerId'),
    ]);

    const cur = mapOf(current);
    const key = (row: { _id: { c: Types.ObjectId | null; y: number; m: number } }): string =>
      `${String(row._id.c)}|${String(row._id.y)}|${String(row._id.m)}`;
    const monthMap = (
      rows: {
        _id: { c: Types.ObjectId | null; y: number; m: number };
        count: number;
        weight: number;
      }[],
    ) => new Map(rows.map((row) => [key(row), { count: row.count, weight: row.weight }]));
    const rM = monthMap(recvA);
    const dM = monthMap(delivA);
    const iM = monthMap(tInA);
    const oM = monthMap(tOutA);

    // The timeline: earliest movement month → this month, capped at 48 months.
    const all = [...recvA, ...delivA, ...tInA, ...tOutA];
    const now = new Date();
    const currentYm = now.getUTCFullYear() * 12 + now.getUTCMonth();
    let minYm = currentYm;
    for (const row of all) {
      const ym = row._id.y * 12 + (row._id.m - 1);
      if (ym < minYm) minYm = ym;
    }
    if (currentYm - minYm > 47) minYm = currentYm - 47;
    if (minYm > currentYm) minYm = currentYm;
    const months: { y: number; m: number }[] = [];
    for (let ym = minYm; ym <= currentYm; ym += 1) {
      months.push({ y: Math.floor(ym / 12), m: (ym % 12) + 1 });
    }

    const idSet = new Set(
      [...cur.keys(), ...all.map((row) => String(row._id.c))].filter((id) => id !== 'null'),
    );
    let ids = [...idSet];
    if (query.funds !== undefined) ids = ids.filter((id) => query.funds?.includes(id));
    const companies =
      ids.length === 0
        ? []
        : await GoldCompanyModel.find({ _id: { $in: ids.map(toId) }, type: 'fund' })
            .select('name')
            .lean<{ _id: Types.ObjectId; name: string }[]>()
            .exec();

    const funds = companies
      .map((company) => {
        const id = String(company._id);
        const balance = cur.get(id) ?? ZERO;
        const net = months.map(({ y, m }) => {
          const k = `${id}|${String(y)}|${String(m)}`;
          const inC = (rM.get(k)?.count ?? 0) + (iM.get(k)?.count ?? 0);
          const inW = (rM.get(k)?.weight ?? 0) + (iM.get(k)?.weight ?? 0);
          const outC = (dM.get(k)?.count ?? 0) + (oM.get(k)?.count ?? 0);
          const outW = (dM.get(k)?.weight ?? 0) + (oM.get(k)?.weight ?? 0);
          return { y, m, inC, inW, outC, outW, netC: inC - outC, netW: inW - outW };
        });
        // Running closing, anchored on today's balance and rewound month by month.
        const closeC = new Array<number>(net.length);
        const closeW = new Array<number>(net.length);
        let afterC = 0;
        let afterW = 0;
        for (let i = net.length - 1; i >= 0; i -= 1) {
          const row = net[i];
          if (row === undefined) continue;
          closeC[i] = balance.count - afterC;
          closeW[i] = balance.weight - afterW;
          afterC += row.netC;
          afterW += row.netW;
        }
        let rows: GoldFundClosingMonthDto[] = net.map((n, i) => ({
          year: n.y,
          month: n.m,
          inCount: n.inC,
          outCount: n.outC,
          inWeight: n.inW,
          outWeight: n.outW,
          netWeight: n.netW,
          balanceCount: closeC[i] ?? 0,
          balanceWeight: closeW[i] ?? 0,
        }));
        if (hasRange) {
          rows = rows.filter(
            (row) =>
              row.year === query.year &&
              row.month >= (query.fromMonth ?? 1) &&
              row.month <= (query.toMonth ?? 12),
          );
        }
        return { companyId: id, name: company.name, rows };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));

    return { metalType, funds };
  }
}

export const goldReportsService = new GoldReportsService();
