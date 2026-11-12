// The Operations reports — the legacy /ops_report (by captain) and /ops_bank_report (by bank), and
// the vault roll-up /vault1_reports (by bank, over the vault's receipts: see `vaultReport`).
//
// WHAT THE FIRST TWO REPORT, precisely (discovery §D): COMPLETED shipments in a date range, where
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
  type OperationsVaultHeldReportDto,
  type OperationsVaultReportDto,
} from '@ecms/contracts';
import { fromMinorUnits, ymdToUtcDate } from '@ecms/contracts';
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
  vaultReceiptRange,
  type ReportInputRow,
} from './report-aggregation';

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
   * The legacy `/vault1_reports` + `/vault1` aggregations, rolled up by bank (B6) — over the
   * period the owner gave the screen's dates: «يجيب اللى اتسلم واللى متسلمش ويجيب البداية كل اول شهر».
   *
   * WHICH SHIPMENTS. Every custody the vault TOOK in the period, judged on the receipt's Cairo day
   * (`vaultReceiptRange`), whatever happened to it since — still held, released on dispatch, the
   * shipment delivered and completed. "Delivered or not" is the point: a month's roll-up of what
   * came into the vault must not shrink each time a van leaves. A CANCELLED receipt is not in it:
   * the cancel voids the custody and soft-deletes it in one write, and `receivedBetween` reads live
   * custody only — so a shipment received again counts once, on its new receipt's day, with that
   * receipt's packages. A deleted shipment is not in it either (`findByIds` reads live rows), as
   * in the other two reports.
   *
   * It goes through the SAME `bankReportRows` the bank report uses. That is the point: the legacy
   * pair computed package counts two different ways over overlapping sets — the vault screen per
   * document, the bank report per currency line (Q26) — so the two screens disagreed about the
   * same shipments. One code path cannot.
   */
  async vaultReport(
    query: OperationsReportQuery,
    now: Date = new Date(),
  ): Promise<OperationsVaultReportDto> {
    const range = vaultReceiptRange(query, now);
    // One custody per shipment at most: `ux_shipment` allows a single live custody, so a shipment
    // cannot appear twice however many times it was received and cancelled.
    const received = await vaultCustody().receivedBetween(range.start, range.endExclusive);
    const shipments = await operationsShipmentRepository.findByIds(
      received.map((custody) => custody.shipmentId),
    );
    const byId = new Map(shipments.map((doc) => [String(doc._id), doc]));

    const currencies = (
      await operationsCurrencyRepository.list({ filter: {}, page: 1, pageSize: 500 })
    ).items;
    const currencyName = new Map(currencies.map((c) => [String(c._id), c.name]));
    const bankNames = new Map<string, string>();

    const rows: ReportInputRow[] = [];
    for (const custody of received) {
      const shipment = byId.get(custody.shipmentId);
      // No live shipment: deleted (the other reports leave those out too), or a broken reference —
      // which is visible as a count lower than the receipts', rather than a row with no money.
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
      // The days asked for, stored the date-only way (UTC midnight) as the other reports send
      // theirs — not the Cairo instants the query used, which a header would read as the day before.
      from: ymdToUtcDate(range.from).toISOString(),
      to: ymdToUtcDate(range.to).toISOString(),
      rows: built,
      grandTotal,
    };
  }

  /**
   * «تقرير الخزينة» (Round 12) — what the vault HOLDS NOW, per bank: «نفس الداتا اللى فى بيان الشحنات
   * لكل بنك ونفس الشكل وكل حاجه بس مفيش فتر من الى هيكون لحظى على ف الخزينة».
   *
   * WHICH SHIPMENTS: every secured shipment whose status is `inVault` — the very set «محصنات الخزينة»
   * lists (`securedInVault`, the dispatch board without a day), so the report on top of «سجل الخزينة»
   * and the list one row below it in the menu can never disagree. A dispatched shipment has left the
   * vault; a cancelled receipt put it back to draft; neither is held. Deleted shipments are out.
   *
   * Not `listHeld` (the treasury's custody inventory): that answers in pages, and the shipment's own
   * status is the fact every Operations screen reads — the custody and the status move in ONE
   * transaction (receive, dispatch, cancel), so the two sets are the same, and this one is the one the
   * neighbouring screen shows. The custody is read for the packages only, counted once per shipment.
   *
   * Through `bankReportRows`, like the roll-up and the bank report: one code path, one answer.
   */
  async vaultHeldReport(now: Date = new Date()): Promise<OperationsVaultHeldReportDto> {
    const shipments = await operationsShipmentRepository.securedInVault();
    const custody = await vaultCustody().findMany(shipments.map((doc) => String(doc._id)));

    const currencies = (
      await operationsCurrencyRepository.list({ filter: {}, page: 1, pageSize: 500 })
    ).items;
    const currencyName = new Map(currencies.map((c) => [String(c._id), c.name]));
    // The banks named in ONE read — what the vault holds is a few dozen banks at most.
    const banks = await operationsBankRepository.findByIdsSystem([
      ...new Set(shipments.map((doc) => String(doc.mainBankId))),
    ]);
    const bankName = new Map(banks.map((b) => [String(b._id), b.opsName]));

    const rows: ReportInputRow[] = shipments.map((shipment) => {
      const shipmentId = String(shipment._id);
      const held = custody.get(shipmentId);
      const bankId = String(shipment.mainBankId);
      return {
        shipmentId,
        // Like the roll-up, keyed on the bank: custody is the treasury's, not a route's.
        captainEmployeeId: null,
        captainName: '',
        bankId,
        bankName: bankName.get(bankId) ?? '',
        bagCount: held?.bagCount ?? 0,
        cartonCount: held?.cartonCount ?? 0,
        boxCount: held?.boxCount ?? 0,
        lines: shipment.lines.map((line: OperationsShipmentLine) => ({
          currencyId: String(line.currencyId),
          currencyName: currencyName.get(String(line.currencyId)) ?? '',
          amount: fromMinorUnits(line.amountMinor),
        })),
      };
    });

    const { rows: built, grandTotal } = bankReportRows(rows);
    return { asOf: now.toISOString(), rows: built, grandTotal };
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
