// «تقرير الخزينة» on «سجل الخزينة» (`pages/VaultInventoryPage.tsx`) — what the vault holds NOW.
//
// THE OWNER: «سجل الخزينه لما اوس على تقرير يفتح ززى موديل زى لوحة التحكم اللى عملنها فى العهدة». The
// report no longer sits as a band over the history, taking a third of the screen from it (and
// folding away to give it back): it is a button in the history's toolbar, beside «إخفاء الإحصائيات»,
// that opens a modal over the whole screen built as Fleet's custody dashboard is
// (`fleet/components/CustodyDashboard.tsx`) — the portal, the header with its title and ×, Escape
// to close, the focus kept inside and handed back, the page behind held still, its own scroll, its
// dark and light surfaces, its figure tiles.
//
// WHAT IT HOLDS, top to bottom («نفس الداتا اللى فى بيان الشحنات لكل بنك ونفس الشكل وكل حاجه … هيكون
// لحظى على ف الخزينة»):
//   · the header: «تقرير الخزينة — الموجود الآن», when it was read («حتى …», the Cairo clock), and
//     «Excel | PDF» — the period report's own files (`ReportExportPair`, lib/report-export.ts) over
//     this answer, its panel as the second sheet and page;
//   · the figure tiles, in the custody dashboard's tile: «عدد المحصنات», «المصري», «الدولار», «عملات
//     أخرى» (opening the boards' breakdown of what that sum adds together), «الحقائب», «الكراتين»,
//     «الصناديق» — read off the server's grand total (`heldReportTiles`), never the rows added up;
//   · «بيان الشحنات لكل بنك» — the very `ReportTable` «تجميع الخزينة» draws, its head and «الإجمالي»
//     pinned while the banks scroll between them — and beside it «إجمالي قيمة الشحنات» over the same
//     total, stacking under it on a narrow screen.
//
// NO CHART. The custody dashboard's charts are drawn from Fleet's own answer (a car's spend split by
// kind, a month's columns) and do not take a bank's row; and a vault holds several currencies, so a
// "share" by bank must first pick ONE measure — the count, or the pound alone — while the table
// beside it already lists every bank with every measure. A third drawing of the same rows would add
// a picture, not a fact.
//
// READ ONLY WHILE OPEN. The modal's body — and with it the query — is mounted only while the modal
// is up: nothing is read for a report nobody is looking at, and every secured act and the vault's
// custody topic, which stale the roll-up's cache (the report rides it), refresh it while it is.
//
// A TREASURER WHO MAY NOT READ THE HISTORY (no `operationsShipment.view`) has no toolbar to open it
// from: the page shows him the same body inline, at the screen's height (`VaultHeldReportInline`).
//
// ROUND 16 — ONE WINDOW FOR TWO REPORTS. «محصنات الخزينة» got its own «لوحة تحكم» in this very
// window («دلوقتي محصنات الخزينة أنا عايز يكون فيها لوحة تحكم اللي هي داشبورد جنب الإحصائيات»), so
// the window (its portal frame, keyboard, focus and surfaces) and the seven figure tiles moved to
// `ReportModal.tsx`, written once for both. What stays here is what this report holds.
import { useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MAX_PAGE_SIZE, type OperationsVaultHeldReportDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { CARD } from '../../fleet/components/custody-dashboard-parts';
import { NUM } from '../../fleet/components/FuelCardBoard';
import {
  useOperationsBanks,
  useOperationsCurrencies,
  useVaultHeldReport,
} from '../api/operations-queries';
import { reportTableLines, type ReportBoardRow } from '../lib/report-board';
import { cairoStampText, ltrIsolate } from '../lib/shipment-log';
import {
  heldReportFace,
  heldReportRows,
  heldReportTiles,
  type HeldReportFace,
} from '../lib/vault-held-report';
import { ReportExportPair, ReportTable } from './ReportBoard';
import {
  ReportFigureTiles,
  ReportModalFrame,
  ReportModalTitle,
  ReportTilesSkeleton,
} from './ReportModal';
import { SHIPMENT_PATH } from './shipment-icons';
import { VaultValuePanel } from './VaultValuePanel';

/** The report, read while `enabled`, its rows in the banks' reference order. */
const useHeldReport = (
  enabled: boolean,
): {
  held: ReturnType<typeof useVaultHeldReport>;
  rows: ReportBoardRow[];
  face: HeldReportFace;
} => {
  const held = useVaultHeldReport(enabled);
  // The boards' own query (the same parameters), so the catalog is one cache across them.
  const banks = useOperationsBanks({
    page: 1,
    pageSize: MAX_PAGE_SIZE,
    sortBy: 'code',
    sortDir: 'asc',
  });
  return {
    held,
    rows: heldReportRows(held.data?.rows ?? [], banks.data?.items ?? []),
    face: heldReportFace(held),
  };
};

// ── The header's end: when it was read, and the files ─────────────────────────────────────────

/** «حتى 2026-11-12 14:09» — Latin figures, the Cairo clock, kept in their own order. */
const AsOf = ({ data }: { data: OperationsVaultHeldReportDto | undefined }): JSX.Element | null => {
  const t = useT();
  if (data === undefined) return null;
  return (
    <span
      data-vault-held-as-of="true"
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600 dark:border-[#223048] dark:bg-[#0a0e17] dark:text-slate-300',
        NUM,
      )}
    >
      {/* Live, not a period («لحظى»): the custody dashboard's emerald dot. */}
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      {t('operations.vaultHistory.heldAsOf', { at: ltrIsolate(cairoStampText(data.asOf)) })}
    </span>
  );
};

/** «Excel | PDF» — the period report's files over this answer, its panel included. */
const HeldExports = ({
  data,
  rows,
}: {
  data: OperationsVaultHeldReportDto | undefined;
  rows: readonly ReportBoardRow[];
}): JSX.Element => {
  const t = useT();
  return (
    <ReportExportPair
      title={t('operations.vaultReport.table')}
      keyHeader={t('operations.reports.bank')}
      countHeader={t('operations.vaultReport.securedCount')}
      lines={reportTableLines(rows, data?.grandTotal)}
      total={data?.grandTotal}
      exportSpec={{
        name: t('operations.vaultHistory.open'),
        // No period: the paper says when the vault was read, as the screen does.
        subtitle:
          data === undefined
            ? ''
            : t('operations.vaultHistory.heldAsOf', { at: ltrIsolate(cairoStampText(data.asOf)) }),
        withValuePanel: true,
      }}
    />
  );
};

/** The title with its live dot — the custody dashboard's header title. */
const HeldTitle = ({ id }: { id: string }): JSX.Element => {
  const t = useT();
  return <ReportModalTitle id={id}>{t('operations.vaultHistory.held')}</ReportModalTitle>;
};

/**
 * The header: the title, when it was read beside it and the files at the far end (and ×, in the
 * modal). On a phone the title takes its own line and «حتى …» and the files share the next.
 */
const HeadRow = ({
  titleId,
  data,
  rows,
  close,
}: {
  titleId: string;
  data: OperationsVaultHeldReportDto | undefined;
  rows: readonly ReportBoardRow[];
  close?: ReactNode;
}): JSX.Element => (
  <div className="flex items-start gap-3">
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
      <HeldTitle id={titleId} />
      <div className="flex flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <AsOf data={data} />
        <HeldExports data={data} rows={rows} />
      </div>
    </div>
    {close}
  </div>
);

// ── The figure tiles ──────────────────────────────────────────────────────────────────────────

/**
 * The seven tiles (`ReportFigureTiles`, shared with «محصنات الخزينة»'s dashboard), read off the
 * server's GRAND TOTAL alone — never the rows added up (Q27) — and split by the boards' classifier.
 */
const HeldTiles = ({ data }: { data: OperationsVaultHeldReportDto }): JSX.Element => {
  const t = useT();
  // The boards' own query, so the catalog is one cache across them: the money is split by it.
  const currencies = useOperationsCurrencies({ page: 1, pageSize: MAX_PAGE_SIZE });
  const catalog = currencies.data?.items ?? [];
  const tiles = heldReportTiles(data.grandTotal, catalog);
  return (
    <ReportFigureTiles
      mark="vault-held"
      label={t('operations.vaultHistory.figures')}
      tiles={tiles}
    />
  );
};

// ── The body — the modal's, and the vault-only reader's page ──────────────────────────────────

/**
 * Every section for each face of the query: the tiles, the table and its panel — at zero with the
 * table's line when the vault holds nothing (the custody dashboard's rule: the frames stay); their
 * frames shimmering while the answer is on its way; one card with the error and its retry when it
 * never came.
 */
export const VaultHeldReportBody = ({
  face,
  data,
  rows,
  error,
  onRetry,
}: {
  face: HeldReportFace;
  data: OperationsVaultHeldReportDto | undefined;
  rows: readonly ReportBoardRow[];
  error: unknown;
  onRetry: () => void;
}): JSX.Element => {
  const t = useT();
  if (face === 'error') {
    return (
      <div className={cn(CARD, 'rounded-2xl')} data-vault-held-error="true">
        <ErrorState error={error} onRetry={onRetry} />
      </div>
    );
  }
  return (
    <>
      {data === undefined ? <ReportTilesSkeleton mark="vault-held" /> : <HeldTiles data={data} />}
      {/* A computer: the table and the panel side by side, as tall as what is left of the screen —
          the banks scroll between the table's head and «الإجمالي». A phone: stacked, each capped,
          the whole scrolling. */}
      <div
        className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row lg:items-stretch"
        data-vault-held-row="true"
      >
        <ReportTable
          title={t('operations.vaultReport.table')}
          titleIcon={SHIPMENT_PATH.bank}
          keyHeader={t('operations.reports.bank')}
          countHeader={t('operations.vaultReport.securedCount')}
          rows={rows}
          total={data?.grandTotal}
          loading={face === 'loading'}
          // A failed refetch keeps the last answer (dimmed by the modal); a report that never
          // answered is the error face above.
          error={null}
          onRetry={onRetry}
          empty={t('operations.vaultHistory.heldEmpty')}
          className="max-lg:max-h-[70vh] lg:min-h-0 lg:flex-1"
        />
        <VaultValuePanel
          grandTotal={data?.grandTotal}
          loading={face === 'loading'}
          className="max-lg:max-h-[60vh] lg:w-80 lg:shrink-0 xl:w-[22rem]"
        />
      </div>
    </>
  );
};

// ── The modal ─────────────────────────────────────────────────────────────────────────────────

/**
 * The modal while it is up — mounted only then, so the report is read only then. The window is the
 * vault reports' one (`ReportModalFrame`): the custody dashboard's keyboard and focus, with the
 * «عملات أخرى» breakdown over it answering Escape alone and Tab kept inside the two.
 */
const HeldReportModal = ({ onClose }: { onClose: () => void }): JSX.Element => {
  const titleId = useId();
  const { held, rows, face } = useHeldReport(true);
  return (
    <ReportModalFrame
      mark="vault-held"
      titleId={titleId}
      onClose={onClose}
      // A refetch holds the last answer, dimmed. From a computer up the body is the screen's height
      // (at least a laptop's), so the table takes what the tiles leave and only its rows scroll.
      dimmed={held.isFetching && face === 'ready'}
      head={(close) => <HeadRow titleId={titleId} data={held.data} rows={rows} close={close} />}
    >
      <VaultHeldReportBody
        face={face}
        data={held.data}
        rows={rows}
        error={held.error}
        onRetry={() => void held.refetch()}
      />
    </ReportModalFrame>
  );
};

/**
 * «تقرير الخزينة» over the whole screen, in a portal: Escape or × closes it, Tab stays inside, the
 * page behind does not scroll, and the focus goes back to the button on the way out. Nothing is
 * mounted — and nothing read — while it is closed.
 */
export const VaultHeldReportDialog = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element | null =>
  open ? createPortal(<HeldReportModal onClose={onClose} />, document.body) : null;

/**
 * The same report on the page itself, at the screen's height — for a treasurer holding the vault's
 * grants alone, who has no history and so no toolbar to open it from. Its header is the modal's
 * without ×, on a card of its own.
 */
export const VaultHeldReportInline = (): JSX.Element => {
  const titleId = useId();
  const { held, rows, face } = useHeldReport(true);
  return (
    <section
      aria-labelledby={titleId}
      data-vault-held="true"
      className={cn(
        'flex flex-col gap-4 lg:min-h-0 lg:flex-1',
        held.isFetching && face === 'ready' && '[&>*:not(:first-child)]:opacity-60',
      )}
    >
      <div className={cn(CARD, 'shrink-0 rounded-2xl px-4 py-3')} data-vault-held-head="true">
        <HeadRow titleId={titleId} data={held.data} rows={rows} />
      </div>
      <VaultHeldReportBody
        face={face}
        data={held.data}
        rows={rows}
        error={held.error}
        onRetry={() => void held.refetch()}
      />
    </section>
  );
};
