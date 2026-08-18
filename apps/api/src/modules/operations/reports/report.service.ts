// The two Operations reports — the legacy /ops_report (by captain) and /ops_bank_report (by bank).
//
// WHAT IS BEING REPORTED, precisely (discovery §D): COMPLETED shipments in a date range, where
// daily shipments are attributed by their COLLECTION date and secured ones by their DELIVERY date.
// That two-date split is not a detail — it is the same distinction the day board turns on, and
// getting it wrong moves money between months.
//
// THE CAPTAIN COMES FROM THE ASSIGNMENT. Legacy read `leader1` for the daily facet and `leader2`
// for the secured one (contad_app.js:4894/4935) — two fields on the shipment. The approved SPLIT
// moved both onto the assignment entity as `leg: 'pickup' | 'delivery'`, so this reads the
// matching leg. A shipment with no assignment has no captain and is reported under an unassigned
// bucket rather than dropped, which is what legacy effectively did to secured shipments completed
// without a leg-2 assignment (quirk Q30's visible symptom: rows under a blank leader).
//
// PACKAGES COME FROM CUSTODY. Legacy kept bag/carton/box on the transaction itself; the vault
// slice moved them to the custody record, which only secured shipments have. A daily shipment
// therefore contributes zero packages — exactly as in legacy, where those fields were null and
// `$ifNull`'d to 0.
import {
  type OperationsBankReportDto,
  type OperationsCaptainReportDto,
  type OperationsReportQuery,
  type OperationsVaultReportDto,
} from '@ecms/contracts';
import { fromMinorUnits } from '@ecms/contracts';
import { getDirectoryEmployee } from '../../../platform/directory';
import { operationsBankRepository } from '../banks/bank.repository';
import { operationsCurrencyRepository } from '../currencies/currency.repository';
import { operationsShipmentRepository } from '../shipments/shipment.repository';
import { type OperationsShipmentLine } from '../shipments/shipment.model';
import { operationsShipmentAssignmentRepository } from '../shipments/shipment-assignment.repository';
import { vaultCustody } from '../treasury-boundary';
import {
  bankReportRows,
  captainReportRows,
  defaultReportRange,
  explicitReportRange,
  type ReportInputRow,
} from './report-aggregation';

/**
 * ECMS's domestic currency. It is `EGP` everywhere else in the platform — `MoneyCurrencySchema`
 * defaults to it and every money value object does — so the vault roll-up names the same one
 * instead of reproducing the legacy screen's literal synonym list (contad_app.js:1409).
 */
const BASE_CURRENCY_CODE = 'EGP';

const resolveRange = (query: OperationsReportQuery): { from: Date; toExclusive: Date } =>
  query.from !== undefined && query.to !== undefined
    ? explicitReportRange(query.from, query.to)
    : defaultReportRange(new Date());

class OperationsReportService {
  /**
   * Gather one range's completed shipments and flatten them into report rows.
   *
   * Names are resolved ONCE per distinct id rather than per shipment — a month's report would
   * otherwise make the same directory call dozens of times for the same captain.
   */
  private async collect(query: OperationsReportQuery): Promise<{
    rows: ReportInputRow[];
    from: Date;
    toExclusive: Date;
  }> {
    const { from, toExclusive } = resolveRange(query);
    const shipments = await operationsShipmentRepository.completedInRange(from, toExclusive);

    const currencies = (
      await operationsCurrencyRepository.list({ filter: {}, page: 1, pageSize: 500 })
    ).items;
    const currencyName = new Map(currencies.map((c) => [String(c._id), c.name]));
    const bankNames = new Map<string, string>();
    const captainNames = new Map<string, string>();

    // Assignments and custody are fetched for the WHOLE range in one round trip each. A month is
    // hundreds of shipments, and a per-shipment lookup would make a report a few thousand queries.
    const shipmentIds = shipments.map((s) => String(s._id));
    const assignments = await operationsShipmentAssignmentRepository.findByShipments(shipmentIds);
    const byShipmentLeg = new Map(
      assignments.map((a) => [`${String(a.shipmentId)}:${a.leg}`, a]),
    );
    const custodyByShipment = await vaultCustody().findMany(shipmentIds);

    const rows: ReportInputRow[] = [];
    for (const shipment of shipments) {
      const shipmentId = String(shipment._id);

      // The leg that carries this type's captain — the legacy leader1/leader2 split, normalized.
      const leg = shipment.shipmentType === 'daily' ? 'pickup' : 'delivery';
      const assignment = byShipmentLeg.get(`${shipmentId}:${leg}`) ?? null;
      const captainEmployeeId =
        assignment === null ? null : String(assignment.captainEmployeeId);
      if (captainEmployeeId !== null && !captainNames.has(captainEmployeeId)) {
        const employee = await getDirectoryEmployee(captainEmployeeId);
        captainNames.set(captainEmployeeId, employee?.fullNameAr ?? '');
      }

      const bankId = String(shipment.mainBankId);
      if (!bankNames.has(bankId)) {
        const bank = await operationsBankRepository.findById(bankId);
        bankNames.set(bankId, bank?.opsName ?? '');
      }

      // Only secured shipments are ever in custody; a daily one contributes no packages.
      const custody = custodyByShipment.get(shipmentId) ?? null;

      rows.push({
        shipmentId,
        captainEmployeeId,
        captainName: captainEmployeeId === null ? '' : (captainNames.get(captainEmployeeId) ?? ''),
        bankId,
        bankName: bankNames.get(bankId) ?? '',
        bagCount: custody?.bagCount ?? 0,
        cartonCount: custody?.cartonCount ?? 0,
        boxCount: custody?.boxCount ?? 0,
        lines: shipment.lines.map((line: OperationsShipmentLine) => ({
          currencyId: String(line.currencyId),
          currencyName: currencyName.get(String(line.currencyId)) ?? '',
          amount: fromMinorUnits(line.amountMinor),
        })),
      });
    }

    return { rows, from, toExclusive };
  }

  /** The legacy `/ops_report` — one row per captain. */
  async captainReport(query: OperationsReportQuery): Promise<OperationsCaptainReportDto> {
    const { rows, from, toExclusive } = await this.collect(query);
    const { rows: built, grandTotal } = captainReportRows(rows);
    return {
      from: from.toISOString(),
      // Reported as the INCLUSIVE last day, which is what the caller asked for and what a header
      // should read — the exclusive bound is an implementation detail of the query.
      to: new Date(toExclusive.getTime() - 86_400_000).toISOString(),
      rows: built,
      grandTotal,
    };
  }

  /**
   * The legacy `/vault1_reports` + `/vault1` aggregations — everything the treasury holds NOW,
   * rolled up by bank (B6).
   *
   * It goes through the SAME `bankReportRows` the bank report uses. That is the point: the legacy
   * pair computed package counts two different ways over overlapping sets — the vault screen per
   * document, the bank report per currency line (Q26) — so the two screens disagreed about the
   * same shipments. One code path cannot.
   *
   * NO date range (Q32 PRESERVE): the legacy picker's filters were commented out in BOTH
   * aggregations, and "what is in the vault" is a question about now.
   */
  async vaultReport(): Promise<OperationsVaultReportDto> {
    const held = await vaultCustody().allHeld();
    const shipments = await operationsShipmentRepository.findByIds(
      held.map((custody) => custody.shipmentId),
    );
    const byId = new Map(shipments.map((doc) => [String(doc._id), doc]));

    const currencies = (
      await operationsCurrencyRepository.list({ filter: {}, page: 1, pageSize: 500 })
    ).items;
    const currencyName = new Map(currencies.map((c) => [String(c._id), c.name]));
    const baseCurrencyIds = new Set(
      currencies.filter((c) => c.code === BASE_CURRENCY_CODE).map((c) => String(c._id)),
    );
    const bankNames = new Map<string, string>();

    const rows: ReportInputRow[] = [];
    for (const custody of held) {
      const shipment = byId.get(custody.shipmentId);
      // Custody with no readable shipment is a broken reference, not a zero. Skipping it makes the
      // roll-up's count differ from the inventory's — which is visible — rather than quietly
      // emitting a row with no money.
      if (shipment === undefined) continue;

      const bankId = String(shipment.mainBankId);
      if (!bankNames.has(bankId)) {
        const bank = await operationsBankRepository.findById(bankId);
        bankNames.set(bankId, bank?.opsName ?? '');
      }

      rows.push({
        shipmentId: custody.shipmentId,
        // The vault roll-up is not keyed on a captain; custody is the treasury's, not a route's.
        captainEmployeeId: null,
        captainName: '',
        bankId,
        bankName: bankNames.get(bankId) ?? '',
        // Packages come from CUSTODY, counted once per shipment — the same fix as the reports.
        bagCount: custody.bagCount,
        cartonCount: custody.cartonCount,
        boxCount: custody.boxCount,
        lines: shipment.lines.map((line: OperationsShipmentLine) => ({
          currencyId: String(line.currencyId),
          currencyName: currencyName.get(String(line.currencyId)) ?? '',
          amount: fromMinorUnits(line.amountMinor),
        })),
      });
    }

    const { rows: built, grandTotal } = bankReportRows(rows);
    return {
      rows: built,
      grandTotal,
      baseCurrencyCode: BASE_CURRENCY_CODE,
      // The legacy SECOND aggregation, as a view of the first rather than a second query. Matched
      // on the currency's CODE, not on its Arabic display name — which is what the legacy synonym
      // list was working around.
      foreignCurrencies: grandTotal.currencies.filter(
        (line) => line.currencyId === null || !baseCurrencyIds.has(line.currencyId),
      ),
    };
  }

  /** The legacy `/ops_bank_report` — one row per bank. */
  async bankReport(query: OperationsReportQuery): Promise<OperationsBankReportDto> {
    const { rows, from, toExclusive } = await this.collect(query);
    const { rows: built, grandTotal } = bankReportRows(rows);
    return {
      from: from.toISOString(),
      to: new Date(toExclusive.getTime() - 86_400_000).toISOString(),
      rows: built,
      grandTotal,
    };
  }
}

export const operationsReportService = new OperationsReportService();
