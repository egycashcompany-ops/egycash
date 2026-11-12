// «طباعة» on a van of «تسليم المحصنات» (Round 12) — the van's load on the company's report form.
//
// PROVISIONAL CONTENT. The owner: «هيكون فوق كل عربيه تسليم وطباعه اللى هيطبع هقولك عليه بعدين ايه هو»
// — what this sheet says is his to decide, later. Until he does, it prints what the screen shows of
// the van (the van, its captains and specialists, its direction and time, then every shipment on it
// with its bank, branches, money and packages, and the totals), so the button is useful from the
// first day and nothing on it is invented. When he says what the paper is, THIS file is what changes
// — the button, the form and the print window stay.
//
// ONE FORM. The company's report form (`fleet/lib/fleet-report-print.ts` — letterhead, title, rule,
// the table with its «م», figures under it), as every printed list of the app is; no signature block
// (nobody has said who signs a load sheet yet — two empty «التوقيع /» lines would read as a form
// someone forgot to fill in).
import {
  type OperationsCurrencyDto,
  type OperationsDayBoardPersonDto,
  type OperationsDayBoardVehicleCrewDto,
  type OperationsSecuredDistributionRowDto,
} from '@ecms/contracts';
import { type FleetReport } from '../../fleet/lib/fleet-report-print';
import { boardFigures } from './day-board';
import { loadFigures, personName, type Packaging } from './secured-distribution';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface VanLoadSheetInput {
  t: Translate;
  /** The day handed over, 'YYYY-MM-DD'. */
  day: string;
  van: Pick<
    OperationsDayBoardVehicleCrewDto,
    'vehicleCode' | 'captains' | 'specialist1' | 'specialist2' | 'direction' | 'plannedTime'
  >;
  /**
   * Whether the reader may read the crew plan (`crewPlanVisible`): without it the server sends no
   * specialist, and the sheet leaves their lines out rather than print «—» for someone who rides.
   */
  crewPlanVisible: boolean;
  /** The shipments on the van, in the screen's order. */
  rows: readonly OperationsSecuredDistributionRowDto[];
  bankNameOf: (bankId: string) => string;
  currencyOf: (
    currencyId: string,
  ) => Pick<OperationsCurrencyDto, 'code' | 'name' | 'sortOrder' | 'legacyAliases'> | undefined;
  packagingOf: (shipmentId: string) => Packaging | undefined;
  /** Money and counts as the screen writes them (the page's locale). */
  amount: (value: number) => string;
  count: (value: number) => string;
}

const joinNames = (people: readonly OperationsDayBoardPersonDto[]): string =>
  people.map(personName).join('، ');

/** One shipment's packages on paper — «3 / 1 / 0» (bags / cartons / boxes), «—» before the vault counted them. */
const packagesCell = (packages: Packaging | undefined, count: (value: number) => string): string =>
  packages === undefined
    ? '—'
    : `${count(packages.bags)} / ${count(packages.cartons)} / ${count(packages.boxes)}`;

/** The van's load sheet — one page of the company's report form. */
export const vanLoadSheet = ({
  t,
  day,
  van,
  crewPlanVisible,
  rows,
  bankNameOf,
  currencyOf,
  packagingOf,
  amount,
  count,
}: VanLoadSheetInput): FleetReport => {
  const code = van.vehicleCode ?? '…';
  const subtitle = [
    t('operations.handover.sheet.day', { day }),
    van.captains.length === 0
      ? null
      : t('operations.handover.sheet.captains', { names: joinNames(van.captains) }),
    crewPlanVisible && van.specialist1.length > 0
      ? `${t('operations.crew.slot.specialist1')}: ${joinNames(van.specialist1)}`
      : null,
    crewPlanVisible && van.specialist2.length > 0
      ? `${t('operations.crew.slot.specialist2')}: ${joinNames(van.specialist2)}`
      : null,
    van.direction === null || van.direction.trim() === ''
      ? null
      : `${t('operations.crew.direction')}: ${van.direction}`,
    van.plannedTime === null || van.plannedTime === ''
      ? null
      : `${t('operations.crew.plannedTime')}: ${van.plannedTime}`,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  const total = loadFigures(rows, currencyOf, packagingOf);
  const totals = [
    { label: t('operations.handover.sheet.count'), value: count(total.count) },
    { label: t('operations.reportBoard.pound'), value: amount(total.egp) },
    { label: t('operations.reportBoard.dollar'), value: amount(total.usd) },
    { label: t('operations.board.figures.otherCurrencies'), value: amount(total.othersSum) },
  ];
  if (total.packages !== null) {
    totals.push(
      { label: t('operations.reportBoard.bags'), value: count(total.packages.bags) },
      { label: t('operations.reportBoard.cartons'), value: count(total.packages.cartons) },
      { label: t('operations.reportBoard.boxes'), value: count(total.packages.boxes) },
    );
  }

  return {
    title: t('operations.handover.sheet.title', { code }),
    department: t('operations.handover.sheet.department'),
    subtitle,
    header: [
      t('operations.board.bank'),
      t('operations.shipment.origin'),
      t('operations.shipment.destination'),
      t('operations.shipment.area'),
      t('operations.common.status'),
      t('operations.reportBoard.pound'),
      t('operations.reportBoard.dollar'),
      t('operations.board.figures.otherCurrencies'),
      t('operations.handover.sheet.packages'),
    ],
    rows: rows.map((row) => {
      const money = boardFigures([row], currencyOf);
      return [
        bankNameOf(row.mainBankId) || '…',
        row.origin?.name ?? '…',
        row.destination?.name ?? '…',
        row.areaName ?? '—',
        row.securedStage === null ? '—' : t(`operations.board.stage.${row.securedStage}`),
        amount(money.egp),
        amount(money.usd),
        amount(money.othersSum),
        packagesCell(packagingOf(row.id), count),
      ];
    }),
    totals,
    serialHeader: t('operations.reportBoard.serial'),
    emptyLabel: t('operations.handover.sheet.empty'),
    orientation: 'landscape',
  };
};
