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
