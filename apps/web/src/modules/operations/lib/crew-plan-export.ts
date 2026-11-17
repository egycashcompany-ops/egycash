// «حفظ ك Excel» — the crew plan as the legacy board exported it: one sheet, the table's columns in
// the table's order, a person per line inside a cell.
//
// EXACTLY WHAT IS SHOWN: the rows the type filter left, in the screen's order, from the DRAFT — an
// operator who exports before saving gets what is on screen, which is what they are looking at
// when they press the button. The workbook goes through the app's one `.xlsx` writer, as every
// export does.
import { type OperationsCrewMemberDto } from '@ecms/contracts';
import { type XlsxSheet } from '../../../shared/lib/xlsx-writer';
import { CREW_SLOTS, type PlanRow } from './crew-plan';

export type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The sheet's columns, after «م» — the table's, without its colour and bin. */
export const crewPlanExportHeader = (t: Translate): string[] => [
  t('operations.crewPlan.columns.vehicle'),
  t('operations.crewPlan.columns.captain'),
  t('operations.crewPlan.columns.specialist1'),
  t('operations.crewPlan.columns.specialist2'),
  t('operations.crewPlan.columns.direction'),
  t('operations.crewPlan.columns.time'),
  t('operations.crewPlan.columns.type'),
  t('operations.crewPlan.columns.notes'),
];

/**
 * The rows as the sheet holds them. A person the roster no longer names reads as «—»; the type by
 * its name in «أنواع التشغيل» (`typeName`), as the row shows it — blank for a row with none.
 */
export const crewPlanSheet = (
  t: Translate,
  rows: readonly PlanRow[],
  memberOf: (employeeId: string) => OperationsCrewMemberDto | undefined,
  typeName: (shiftTypeId: string) => string,
): XlsxSheet => ({
  name: t('operations.crewPlan.title'),
  serialHeader: t('operations.reportBoard.serial'),
  header: crewPlanExportHeader(t),
  rows: rows.map((row) => [
    row.vehicleCode ?? t('operations.crewPlan.noVehicle'),
    ...CREW_SLOTS.map((slot) =>
      row.slots[slot].map((id) => memberOf(id)?.fullNameAr ?? '—').join(' / '),
    ),
    row.direction ?? '',
    row.plannedTime ?? '',
    row.shiftTypeId === null ? '' : typeName(row.shiftTypeId),
    row.notes ?? '',
  ]),
});
