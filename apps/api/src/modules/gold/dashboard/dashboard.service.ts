// لوحة التحكم — the vault dashboard (gold `controllers/dashboard.controller.js`).
//
// Every number here is computed from the CURRENT inventory (`status: in_vault`) or from CONFIRMED
// documents. Drafts never appear on the dashboard, which is the gold rule and the reason the board
// can be read as a statement of what is in the building right now.
//
// The `$lookup`s below join this module's own collections (gold_receiving_receipts → gold_bars).
// That is inside the module boundary; nothing here reaches another module's data.
import {
  type GoldCompanyMetalRowDto,
  type GoldDashboardChartsDto,
  type GoldDashboardStatsDto,
  type GoldMetalTotalDto,
  type GoldMonthlyCountDto,
  type GoldMonthlyMetalFlowDto,
  type GoldPurityWeightDto,
} from '@ecms/contracts';
import { type FilterQuery, type Model, type PipelineStage } from 'mongoose';
import { type ScopeSelector } from '../../../shared/types';
import { scopeClause } from '../shared/scope-clause';
import { goldBarRepository } from '../bars/bar.repository';
import { GoldBarModel, type GoldBarDoc } from '../bars/bar.model';
import { goldCompanyRepository } from '../companies/company.repository';
import { goldDrawerRepository } from '../vaults/drawer.repository';
import { goldVaultRepository } from '../vaults/vault.repository';
import { GoldReceivingReceiptModel } from '../receiving/receiving-receipt.model';
import { GoldDeliveryReceiptModel } from '../delivery/delivery-receipt.model';
import { GoldTransferModel } from '../transfers/transfer.model';

/** Documents of one kind per month for the last 12 months — the three trend series. */
const monthlyTrend = async <T>(
  model: Model<T>,
  dateField: string,
  branch: Record<string, unknown>,
): Promise<GoldMonthlyCountDto[]> => {
  const since = new Date();
  since.setMonth(since.getMonth() - 11);
  since.setDate(1);
  return model
    .aggregate<GoldMonthlyCountDto>([
      { $match: { isDeleted: false, ...branch, [dateField]: { $gte: since } } },
      {
        $group: {
          _id: { y: { $year: `$${dateField}` }, m: { $month: `$${dateField}` } },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.y': 1, '_id.m': 1 } },
      { $project: { _id: 0, year: '$_id.y', month: '$_id.m', count: 1 } },
    ])
    .exec();
};

/** Weight in / out per metal per month, from CONFIRMED documents only. */
const monthlyMetalFlow = async <T>(
  model: Model<T>,
  dateField: string,
  branch: Record<string, unknown>,
): Promise<GoldMonthlyMetalFlowDto[]> => {
  const since = new Date();
  since.setMonth(since.getMonth() - 11);
  since.setDate(1);
  return model
    .aggregate<GoldMonthlyMetalFlowDto>([
      {
        $match: { isDeleted: false, status: 'confirmed', ...branch, [dateField]: { $gte: since } },
      },
      { $lookup: { from: 'gold_bars', localField: 'barIds', foreignField: '_id', as: 'b' } },
      { $unwind: '$b' },
      {
        $group: {
          _id: {
            y: { $year: `$${dateField}` },
            m: { $month: `$${dateField}` },
            metal: '$b.metalType',
          },
          weight: { $sum: '$b.weight' },
        },
      },
      { $project: { _id: 0, year: '$_id.y', month: '$_id.m', metal: '$_id.metal', weight: 1 } },
    ])
    .exec();
};

class GoldDashboardService {
  async stats(scope: ScopeSelector): Promise<GoldDashboardStatsDto> {
    const inVault = { status: 'in_vault' } as FilterQuery<GoldBarDoc>;
    const [totalVaults, totalDrawers, totalBars, weightAgg, byMetalAgg, totalCompanies] =
      await Promise.all([
        goldVaultRepository.count({}, scope),
        goldDrawerRepository.countInScope(scope),
        goldBarRepository.count(inVault, scope),
        goldBarRepository.aggregateRaw<{ w: number }>([
          { $match: goldBarRepository.scopedMatch(scope, inVault) },
          { $group: { _id: null, w: { $sum: '$weight' } } },
        ]),
        goldBarRepository.aggregateRaw<{ _id: string; w: number; c: number }>([
          { $match: goldBarRepository.scopedMatch(scope, inVault) },
          { $group: { _id: '$metalType', w: { $sum: '$weight' }, c: { $sum: 1 } } },
        ]),
        goldCompanyRepository.count(),
      ]);
    const byMetal: Record<string, GoldMetalTotalDto> = Object.fromEntries(
      byMetalAgg.map((row) => [row._id, { weight: row.w, count: row.c }]),
    );
    return {
      totalVaults,
      totalDrawers,
      totalBars,
      totalCompanies,
      totalWeight: weightAgg[0]?.w ?? 0,
      goldWeight: byMetal.gold?.weight ?? 0,
      silverWeight: byMetal.silver?.weight ?? 0,
      byMetal,
    };
  }

  async charts(scope: ScopeSelector): Promise<GoldDashboardChartsDto> {
    const inVault = { status: 'in_vault' } as FilterQuery<GoldBarDoc>;
    const match = goldBarRepository.scopedMatch(scope, inVault) as PipelineStage.Match['$match'];
    const branch = scopeClause(scope);

    const [
      companyMetalAgg,
      weightByPurity,
      receivingTrend,
      deliveryTrend,
      transferTrend,
      inFlow,
      outFlow,
      ownerTypeAgg,
    ] = await Promise.all([
      GoldBarModel.aggregate<{
        _id: string;
        name?: string;
        metals: { metal: string; weight: number }[];
        total: number;
        count: number;
      }>([
        { $match: { ...match, companyId: { $ne: null } } },
        {
          $group: {
            _id: { c: '$companyId', metal: '$metalType' },
            weight: { $sum: '$weight' },
            count: { $sum: 1 },
          },
        },
        {
          $group: {
            _id: '$_id.c',
            metals: { $push: { metal: '$_id.metal', weight: '$weight' } },
            total: { $sum: '$weight' },
            count: { $sum: '$count' },
          },
        },
        { $lookup: { from: 'gold_companies', localField: '_id', foreignField: '_id', as: 'c' } },
        { $unwind: { path: '$c', preserveNullAndEmptyArrays: true } },
        { $project: { name: '$c.name', metals: 1, total: 1, count: 1 } },
        { $sort: { total: -1 } },
      ]).exec(),
      GoldBarModel.aggregate<GoldPurityWeightDto>([
        { $match: match },
        { $group: { _id: '$purity', weight: { $sum: '$weight' } } },
        { $sort: { weight: -1 } },
        { $project: { _id: 0, purity: '$_id', weight: 1 } },
      ]).exec(),
      monthlyTrend(GoldReceivingReceiptModel, 'receiptDate', branch),
      monthlyTrend(GoldDeliveryReceiptModel, 'receiptDate', branch),
      monthlyTrend(GoldTransferModel, 'transferDate', branch),
      monthlyMetalFlow(GoldReceivingReceiptModel, 'receiptDate', branch),
      monthlyMetalFlow(GoldDeliveryReceiptModel, 'receiptDate', branch),
      GoldBarModel.aggregate<{ _id: string | null; weight: number }>([
        { $match: match },
        { $group: { _id: '$companyId', weight: { $sum: '$weight' } } },
        { $lookup: { from: 'gold_companies', localField: '_id', foreignField: '_id', as: 'c' } },
        { $unwind: { path: '$c', preserveNullAndEmptyArrays: true } },
        { $group: { _id: '$c.type', weight: { $sum: '$weight' } } },
      ]).exec(),
    ]);

    const metalOf = (metals: { metal: string; weight: number }[], want: string): number =>
      metals.find((m) => m.metal === want)?.weight ?? 0;
    const barsByCompany: GoldCompanyMetalRowDto[] = companyMetalAgg.map((row) => ({
      companyId: String(row._id),
      name: row.name ?? '—',
      gold: metalOf(row.metals, 'gold'),
      silver: metalOf(row.metals, 'silver'),
      weight: row.total,
      count: row.count,
    }));
    const ownerTypeWeight: Record<string, number> = Object.fromEntries(
      ownerTypeAgg.map((row) => [row._id ?? 'company', row.weight]),
    );

    return {
      barsByCompany,
      weightByPurity,
      receivingTrend,
      deliveryTrend,
      transferTrend,
      inFlow,
      outFlow,
      ownerTypeWeight,
    };
  }
}

export const goldDashboardService = new GoldDashboardService();
