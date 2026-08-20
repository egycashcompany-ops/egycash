// The customer portal's service — reads only, one customer at a time.
//
// It resolves display names in batches like every other gold list, and it reuses the ported report
// service rather than reimplementing it: gold's own portal did exactly that (`withFund` forced the
// company into the query and called the staff controller), and the ported reports are business
// logic this work is not allowed to touch. What is added here is a second filter over the returned
// rows, so a report that ever stopped honouring `funds` still could not hand a customer somebody
// else's numbers.
import {
  type GoldFundClosingDto,
  type GoldFundMovementDto,
  type GoldPortalBarDto,
  type GoldPortalBarsQuery,
  type GoldPortalClosingQuery,
  type GoldPortalDrawerDto,
  type GoldPortalKeyDto,
  type GoldPortalListQuery,
  type GoldPortalMeDto,
  type GoldPortalMovementQuery,
  type GoldPortalOverviewDto,
  type GoldPortalReceiptDto,
  type GoldPortalRepresentativeDto,
  type GoldPortalTransferDto,
  type GoldMetalTotalDto,
} from '@ecms/contracts';
import { type Types } from 'mongoose';
import { NotFoundError } from '../../../shared/errors';
import { goldCompanyRepository } from '../companies/company.repository';
import { goldRepresentativeRepository } from '../representatives/representative.repository';
import { GoldDrawerModel } from '../vaults/drawer.model';
import { GoldVaultModel } from '../vaults/vault.model';
import { goldReportsService } from '../reports/reports.service';
import { type GoldBarDoc } from '../bars/bar.model';
import { type GoldDeliveryReceiptDoc } from '../delivery/delivery-receipt.model';
import { type GoldKeyHandoverDoc } from '../keys/key-handover.model';
import { type GoldReceivingReceiptDoc } from '../receiving/receiving-receipt.model';
import { type GoldRepresentativeDoc } from '../representatives/representative.model';
import { type GoldTransferDoc } from '../transfers/transfer.model';
import {
  portalBars,
  portalDelivery,
  portalDrawers,
  portalKeys,
  portalReceiving,
  portalRepresentatives,
  portalTotals,
  portalTransfers,
  type PortalPage,
} from './portal.reads';
import {
  toPortalBar,
  toPortalDrawer,
  toPortalKey,
  toPortalReceipt,
  toPortalRepresentative,
  toPortalTransfer,
  type PortalLabels,
} from './portal.mappers';
import { type PortalCompany } from './portal-scope';

/**
 * The portal reads reports through an ORGANIZATION scope on purpose.
 *
 * The customer has no branch and no placement — they are not in the org tree at all — so a branch
 * or own scope would match nothing. The confinement that matters is the company, and that is
 * applied by `funds` and re-checked on the way out.
 */
const REPORT_SCOPE = {
  scope: 'organization' as const,
  userId: '',
  branchId: null,
  departmentId: null,
  sectionId: null,
};

const ids = (values: readonly (Types.ObjectId | null | undefined)[]): string[] => [
  ...new Set(values.filter((v): v is Types.ObjectId => v !== null && v !== undefined).map(String)),
];

const vaultNames = async (values: readonly (Types.ObjectId | null | undefined)[]) => {
  const list = ids(values);
  if (list.length === 0) return new Map<string, string>();
  const docs = await GoldVaultModel.find({ _id: { $in: list } })
    .select('name')
    .lean<{ _id: Types.ObjectId; name: string }[]>()
    .exec();
  return new Map(docs.map((d) => [String(d._id), d.name]));
};

const drawerCells = async (values: readonly (Types.ObjectId | null | undefined)[]) => {
  const list = ids(values);
  if (list.length === 0) return new Map<string, { number: number; label: string }>();
  const docs = await GoldDrawerModel.find({ _id: { $in: list } })
    .select('number label')
    .lean<{ _id: Types.ObjectId; number: number; label: string }[]>()
    .exec();
  return new Map(docs.map((d) => [String(d._id), { number: d.number, label: d.label }]));
};

const emptyLabels = (): PortalLabels => ({
  vaults: new Map(),
  drawers: new Map(),
  representatives: new Map(),
  companies: new Map(),
});

class GoldPortalService {
  async me(company: PortalCompany, accountName: string): Promise<GoldPortalMeDto> {
    const doc = await goldCompanyRepository.findById(String(company));
    if (doc === null) throw new NotFoundError();
    return {
      companyId: String(doc._id),
      companyName: doc.name,
      companyType: doc.type,
      logoFileId: doc.logoFileId === null ? null : String(doc.logoFileId),
      accountName,
    };
  }

  async overview(company: PortalCompany): Promise<GoldPortalOverviewDto> {
    const totals = await portalTotals(company);
    const byMetal: Record<string, GoldMetalTotalDto> = {};
    for (const row of totals.byMetal) byMetal[row.metalType] = { count: row.count, weight: row.weight };
    return {
      totalBars: totals.inVaultCount,
      totalWeight: totals.inVaultWeight,
      goldWeight: byMetal.gold?.weight ?? 0,
      silverWeight: byMetal.silver?.weight ?? 0,
      totalDrawers: totals.drawerCount,
      receivingCount: totals.receivingCount,
      deliveryCount: totals.deliveryCount,
      transferCount: totals.transferCount,
      keysCount: totals.keysCount,
      representativesCount: totals.representativesCount,
      byMetal,
    };
  }

  async bars(
    company: PortalCompany,
    query: GoldPortalBarsQuery,
  ): Promise<PortalPage<GoldPortalBarDto>> {
    const page = await portalBars(company, query);
    const [vaults, drawers] = await Promise.all([
      vaultNames(page.items.map((b) => b.currentVaultId)),
      drawerCells(page.items.map((b) => b.currentDrawerId)),
    ]);
    const labels: PortalLabels = { ...emptyLabels(), vaults, drawers };
    return { items: page.items.map((doc: GoldBarDoc) => toPortalBar(doc, labels)), totalItems: page.totalItems };
  }

  async drawers(company: PortalCompany): Promise<GoldPortalDrawerDto[]> {
    const rows = await portalDrawers(company);
    return rows.map(toPortalDrawer);
  }

  async receiving(
    company: PortalCompany,
    query: GoldPortalListQuery,
  ): Promise<PortalPage<GoldPortalReceiptDto>> {
    const page = await portalReceiving<GoldReceivingReceiptDoc>(company, query);
    const labels = await this.receiptLabels(page.items.map((r) => r.representativeId));
    return { items: page.items.map((doc) => toPortalReceipt(doc, labels)), totalItems: page.totalItems };
  }

  async delivery(
    company: PortalCompany,
    query: GoldPortalListQuery,
  ): Promise<PortalPage<GoldPortalReceiptDto>> {
    const page = await portalDelivery<GoldDeliveryReceiptDoc>(company, query);
    const labels = await this.receiptLabels(page.items.map((r) => r.representativeId));
    return { items: page.items.map((doc) => toPortalReceipt(doc, labels)), totalItems: page.totalItems };
  }

  async transfers(
    company: PortalCompany,
    query: GoldPortalListQuery,
  ): Promise<PortalPage<GoldPortalTransferDto>> {
    const page = await portalTransfers<GoldTransferDoc>(company, query);
    const companies = await goldCompanyRepository.namesOf(
      ids(page.items.flatMap((t) => [t.currentOwnerId, t.newOwnerId])),
    );
    const labels: PortalLabels = { ...emptyLabels(), companies };
    return {
      items: page.items.map((doc) => toPortalTransfer(doc, String(company), labels)),
      totalItems: page.totalItems,
    };
  }

  async keys(
    company: PortalCompany,
    query: GoldPortalListQuery,
  ): Promise<PortalPage<GoldPortalKeyDto>> {
    const page = await portalKeys<GoldKeyHandoverDoc>(company, query);
    const [vaults, drawers, representatives] = await Promise.all([
      vaultNames(page.items.map((k) => k.vaultId)),
      drawerCells(page.items.map((k) => k.drawerId)),
      goldRepresentativeRepository.namesOf(ids(page.items.map((k) => k.representativeId))),
    ]);
    const labels: PortalLabels = { ...emptyLabels(), vaults, drawers, representatives };
    return { items: page.items.map((doc) => toPortalKey(doc, labels)), totalItems: page.totalItems };
  }

  async representatives(
    company: PortalCompany,
    query: GoldPortalListQuery,
  ): Promise<PortalPage<GoldPortalRepresentativeDto>> {
    const page = await portalRepresentatives<GoldRepresentativeDoc>(company, query);
    return { items: page.items.map(toPortalRepresentative), totalItems: page.totalItems };
  }

  /**
   * معدل الحركة الشهرى, for this customer alone.
   *
   * The ported service is called unmodified — including its rule that these two reports are about
   * FUNDS, so a customer registered as a company or an institution gets no rows. That rule is
   * gold's, and the portal says so on screen rather than editing it.
   */
  async movement(
    company: PortalCompany,
    query: GoldPortalMovementQuery,
  ): Promise<GoldFundMovementDto> {
    const report = await goldReportsService.fundMovement(
      { ...query, funds: [String(company)] },
      REPORT_SCOPE,
    );
    return { ...report, rows: report.rows.filter((row) => row.companyId === String(company)) };
  }

  async closing(
    company: PortalCompany,
    query: GoldPortalClosingQuery,
  ): Promise<GoldFundClosingDto> {
    const report = await goldReportsService.fundClosing(
      { ...query, funds: [String(company)] },
      REPORT_SCOPE,
    );
    return { ...report, funds: report.funds.filter((fund) => fund.companyId === String(company)) };
  }

  private async receiptLabels(
    representativeIds: readonly (Types.ObjectId | null | undefined)[],
  ): Promise<PortalLabels> {
    const representatives = await goldRepresentativeRepository.namesOf(ids(representativeIds));
    return { ...emptyLabels(), representatives };
  }
}

export const goldPortalService = new GoldPortalService();
