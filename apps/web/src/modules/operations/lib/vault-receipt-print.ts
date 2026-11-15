// Round 18 — «إيصال» on the receive form: «إيصال» PRINTS the vault's receipt.
//
// ONE FORM. The company's report form (`fleet/lib/fleet-report-print.ts` — letterhead, title, rule,
// the table with its «م», figures under it), as every printed paper of the app is, opened through
// `shared/lib/print-window`. The receipt is a two-column table — «البيان» / «القيمة» — of what the
// form holds: the shipment's data (as the vault corrected it), the receipt number, the packages,
// the seals with the legacy summary line, «سيريال», the notes counted of each denomination with
// their total, and under the table who received it and when.
//
// USABLE BEFORE AND AFTER. Before «استلام» it is a DRAFT — titled «مسودة», nobody named, no time:
// nothing has been received yet, and a paper that looked final could be mistaken for proof. After
// it, the server's answer (`OperationsVaultReceiptDto`) names the receiver — the signed-in user —
// and the time. The seals are always the FORM's: the server keeps them behind the treasury
// boundary and never hands them back, and the form holds exactly what it stored (`sealsToSend` —
// trimmed, blanks dropped, the server's own rule).
//
// No signature block: nobody has said who signs this paper (the van load sheet's rule — two empty
// «التوقيع /» lines would read as a form somebody forgot to fill in).
import { type OperationsVaultDenominationCountDto } from '@ecms/contracts';
import { type FleetReport } from '../../fleet/lib/fleet-report-print';
import {
  denominationLabel,
  denominationsTotal,
  sealSummary,
  sealSummaryText,
} from './vault-receipt';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface VaultReceiptPrintInput {
  t: Translate;
  /** The shipment's data as the form shows it, already named (banks, branches, currencies). */
  shipment: {
    mainBank: string;
    origin: string;
    originBank: string;
    destination: string;
    destinationBank: string;
    area: string;
    lines: readonly { currency: string; amount: number }[];
    captain: string;
    vehicle: string;
    /** 'YYYY-MM-DD', '' for none. */
    collectionDate: string;
    deliveryDate: string;
    notes: string;
    serialTracked: boolean;
  };
  /** The receipt as typed — the seals already as sent (`sealsToSend`). */
  receipt: {
    receiptNumber: string;
    bagCount: number;
    cartonCount: number;
    boxCount: number;
    bagSealsPerBag: number;
    bagSeals: readonly string[];
    boxSeals: readonly string[];
    denominations: readonly OperationsVaultDenominationCountDto[];
  };
  /** The server's answer once received; null while it is a draft. */
  taken: { receivedAt: string; receivedByName: string | null; receiptNumber: string | null } | null;
  /** Money and counts as the screen writes them; an instant as the reader's Cairo time. */
  amount: (value: number) => string;
  count: (value: number) => string;
  when: (iso: string) => string;
}

const orDash = (value: string): string => (value.trim() === '' ? '—' : value);

/** A seal list's printed value: the legacy summary, its count, and a seal typed twice named. */
const sealsCell = (
  t: Translate,
  seals: readonly string[],
  count: (n: number) => string,
): string => {
  if (seals.length === 0) return '—';
  const summary = sealSummary(seals);
  const line = `${sealSummaryText(summary)} (${t('operations.secured.receive.print.sealCount', {
    count: count(seals.length),
  })})`;
  return summary.duplicates.length === 0
    ? line
    : `${line} — ${t('operations.secured.receive.duplicates', { seals: summary.duplicates.join('، ') })}`;
};

/** The receipt on the company's report form — one page. */
export const vaultReceiptReport = ({
  t,
  shipment,
  receipt,
  taken,
  amount,
  count,
  when,
}: VaultReceiptPrintInput): FleetReport => {
  const draft = taken === null;
  // After the receipt, the number AS STORED (trimmed; none is none); before it, as typed.
  const number = draft ? receipt.receiptNumber.trim() : (taken.receiptNumber ?? '');
  const row = (key: string, value: string): string[] => [t(key), orDash(value)];
  const side = (branch: string, bank: string): string =>
    branch.trim() === '' ? '' : bank.trim() === '' ? branch : `${branch} — ${bank}`;

  const rows: string[][] = [
    row('operations.secured.receive.receiptNumber', number),
    row('operations.shipment.form.mainBank', shipment.mainBank),
    row('operations.shipment.origin', side(shipment.origin, shipment.originBank)),
    row('operations.shipment.destination', side(shipment.destination, shipment.destinationBank)),
    row('operations.shipment.area', shipment.area),
    ...(shipment.lines.length === 0
      ? [row('operations.shipment.form.amount', '')]
      : shipment.lines.map((line) => [
          t('operations.secured.receive.print.line', { currency: line.currency }),
          amount(line.amount),
        ])),
    row('operations.shipment.form.captain', shipment.captain),
    row('operations.shipment.form.vehicle', shipment.vehicle),
    row('operations.board.collectedOn', shipment.collectionDate),
    row('operations.shipment.deliveryDate', shipment.deliveryDate),
    row('operations.shipment.notes', shipment.notes),
    [
      t('operations.secured.receive.serial'),
      t(shipment.serialTracked ? 'common.yes' : 'common.no'),
    ],
    [
      t('operations.secured.receive.bags'),
      receipt.bagCount === 0
        ? count(0)
        : t('operations.secured.receive.print.bags', {
            count: count(receipt.bagCount),
            per: count(receipt.bagSealsPerBag),
          }),
    ],
    [t('operations.secured.receive.boxes'), count(receipt.boxCount)],
    [t('operations.secured.receive.cartons'), count(receipt.cartonCount)],
    [t('operations.secured.receive.bagSeals'), sealsCell(t, receipt.bagSeals, count)],
    [t('operations.secured.receive.boxSeals'), sealsCell(t, receipt.boxSeals, count)],
    ...receipt.denominations.map((line) => [
      t('operations.secured.receive.print.denomination', { value: denominationLabel(line.value) }),
      t('operations.secured.receive.print.notes', {
        count: count(line.count),
        amount: amount(denominationsTotal([line])),
      }),
    ]),
  ];

  return {
    title: draft
      ? t('operations.secured.receive.print.titleDraft')
      : t('operations.secured.receive.print.title'),
    department: t('operations.secured.receive.print.department'),
    subtitle: draft
      ? t('operations.secured.receive.print.draftNote')
      : t('operations.secured.receive.print.takenNote', {
          at: when(taken.receivedAt),
          name: taken.receivedByName ?? '—',
        }),
    header: [
      t('operations.secured.receive.print.item'),
      t('operations.secured.receive.print.value'),
    ],
    rows,
    totals: draft
      ? []
      : [
          {
            label: t('operations.secured.receive.print.receivedBy'),
            value: taken.receivedByName ?? '—',
          },
          {
            label: t('operations.secured.receive.print.receivedAt'),
            value: when(taken.receivedAt),
          },
        ],
    // «عدد الورق من كل فئة» adds up to this — the bottom line of the table, as the reports print
    // theirs. Left out when no note was counted: a total of nothing is not a figure.
    ...(receipt.denominations.length === 0
      ? {}
      : {
          totalRow: {
            label: t('operations.secured.receive.denominationsTotal'),
            value: amount(denominationsTotal(receipt.denominations)),
          },
        }),
    serialHeader: t('operations.reportBoard.serial'),
    emptyLabel: '—',
    orientation: 'portrait',
  };
};
