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
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MAX_PAGE_SIZE, type OperationsVaultHeldReportDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { formatAmount } from '../../../shared/lib/format';
import { CloseIcon } from '../../../shared/ui/icons';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { useAppSelector } from '../../../store';
import {
  CAIRO,
  CARD,
  SCROLLBAR,
  custodyTrapFocus,
} from '../../fleet/components/custody-dashboard-parts';
import { BoardIcon, NUM } from '../../fleet/components/FuelCardBoard';
import {
  useOperationsBanks,
  useOperationsCurrencies,
  useVaultHeldReport,
} from '../api/operations-queries';
import {
  reportCurrencyLookup,
  reportOtherCards,
  reportTableLines,
  type ReportBoardRow,
} from '../lib/report-board';
import { cairoStampText, ltrIsolate } from '../lib/shipment-log';
import {
  focusScope,
  heldReportFace,
  heldReportRows,
  heldReportTiles,
  isTopDialog,
  type HeldReportFace,
} from '../lib/vault-held-report';
import { OtherCurrenciesDialog } from './BoardFigures';
import { ReportExportPair, ReportTable } from './ReportBoard';
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
  return (
    <h2
      id={id}
      className={cn(
        'flex min-w-0 items-center gap-2 text-base font-bold text-slate-900 sm:text-lg dark:text-white',
        CAIRO,
      )}
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 dark:bg-emerald-400"
      />
      {t('operations.vaultHistory.held')}
    </h2>
  );
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
 * The custody dashboard's tile (`CustodyDashboard.tsx`'s `TILE`, `TILE_ICON`): its card, an icon in
 * a bordered square, the label over the figure — a size down on a phone, where two share a row.
 */
const TILE = cn(CARD, 'flex min-w-0 items-center gap-2.5 rounded-xl p-3 sm:gap-3 sm:p-3.5');
const TILE_ICON =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border sm:h-10 sm:w-10';
/**
 * The boards' tones for what each figure counts (`FIGURE_TONE`) — the count in the site's purple,
 * the pound green, the dollar sky, «عملات أخرى» amber — in the custody tile's bordered square. The
 * packages are counts of things, not money: slate, so the money reads first.
 */
const TONE = {
  count:
    'border-brand-200 bg-brand-50 text-brand-600 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-300',
  pound:
    'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400',
  dollar:
    'border-sky-200 bg-sky-50 text-sky-600 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-400',
  others:
    'border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400',
  packages:
    'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-600/40 dark:bg-slate-500/10 dark:text-slate-300',
} as const;

/**
 * Two rows on a computer — the money and its count across the first (a quarter each), the three
 * packages across the second (a third each) — so the figures read as two sentences. Seven in one
 * row would leave a figure of nine digits too little room at 1440px. On a phone each money figure
 * takes the row (a nine-digit pound in half of 390px broke over two lines) and the three packages
 * share one, their tiles without the drawing; between the two, the money two to a row.
 */
const TILE_GRID = 'grid shrink-0 grid-cols-6 gap-3 lg:grid-cols-12 lg:gap-3.5';
const MONEY_SPAN = 'col-span-6 sm:col-span-3';
const PACKAGE_SPAN = 'col-span-2 lg:col-span-4';

/** A tile's label and figure — the boards' digits, the unit after it, a zero dimmed as the table's. */
const TileBody = ({
  icon,
  tone,
  label,
  value,
  unit,
  compact = false,
}: {
  icon: readonly string[];
  tone: string;
  label: string;
  value: number | null;
  unit?: string | undefined;
  /** A third of a phone's row: the label and the count alone, the drawing left out there. */
  compact?: boolean;
}): JSX.Element => {
  const locale = useAppSelector((state) => state.locale.locale);
  return (
    <>
      <span className={cn(TILE_ICON, tone, compact && 'max-sm:hidden')}>
        <BoardIcon d={[...icon]} className="h-4 w-4 sm:h-5 sm:w-5" />
      </span>
      <span className="min-w-0 text-start">
        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{label}</span>
        {value === null ? (
          // The money is split by the catalog; until it is in, a figure would be a guess.
          <Skeleton className="mt-1 h-5 w-20" />
        ) : (
          <span className="flex flex-wrap items-baseline gap-x-1">
            <span
              dir="ltr"
              className={cn(
                'text-base font-bold [overflow-wrap:anywhere] sm:text-lg',
                value === 0
                  ? 'text-slate-400 dark:text-slate-500'
                  : 'text-slate-900 dark:text-white',
                NUM,
              )}
            >
              {formatAmount(value, locale)}
            </span>
            {unit !== undefined && (
              <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500">
                {unit}
              </span>
            )}
          </span>
        )}
      </span>
    </>
  );
};

const HeldTiles = ({ data }: { data: OperationsVaultHeldReportDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  // The boards' own query, so the catalog is one cache across them: the money is split by it.
  const currencies = useOperationsCurrencies({ page: 1, pageSize: MAX_PAGE_SIZE });
  const catalog = currencies.data?.items ?? [];
  const ready = currencies.data !== undefined;
  const tiles = heldReportTiles(data.grandTotal, catalog);
  const [othersOpen, setOthersOpen] = useState(false);
  const money = (value: number): number | null => (ready ? value : null);
  // When the breakdown closes, the focus goes back to the tile that opened it, as the report hands
  // it back to «تقرير الخزينة». The boards' dialog hands back nothing, so the focus would otherwise
  // drop to the page's <body>. This runs after the breakdown has left the page, so the report's
  // trap counts the tile as its own again.
  const othersTile = useRef<HTMLButtonElement>(null);
  const othersWasOpen = useRef(false);
  useEffect(() => {
    if (othersWasOpen.current && !othersOpen) othersTile.current?.focus();
    othersWasOpen.current = othersOpen;
  }, [othersOpen]);

  return (
    <section
      className={TILE_GRID}
      aria-label={t('operations.vaultHistory.figures')}
      data-vault-held-tiles="true"
    >
      <div data-vault-held-tile="count" className={cn(TILE, MONEY_SPAN)}>
        <TileBody
          icon={SHIPMENT_PATH.shipment}
          tone={TONE.count}
          label={t('operations.vaultReport.securedCount')}
          value={tiles.count}
        />
      </div>
      <div data-vault-held-tile="egp" className={cn(TILE, MONEY_SPAN)}>
        <TileBody
          icon={SHIPMENT_PATH.money}
          tone={TONE.pound}
          label={t('operations.reportBoard.pound')}
          value={money(tiles.money.egp)}
          unit="EGP"
        />
      </div>
      <div data-vault-held-tile="usd" className={cn(TILE, MONEY_SPAN)}>
        <TileBody
          icon={SHIPMENT_PATH.money}
          tone={TONE.dollar}
          label={t('operations.reportBoard.dollar')}
          value={money(tiles.money.usd)}
          unit="USD"
        />
      </div>
      {/* A sum of DIFFERENT currencies, so a click lists each one apart — the boards' «عملات أخرى»
          pill and its dialog, over the same total as the table's «الإجمالي». */}
      <button
        ref={othersTile}
        type="button"
        data-vault-held-tile="others"
        aria-haspopup="dialog"
        title={t('operations.board.figures.otherCurrenciesHint')}
        disabled={!ready}
        onClick={() => setOthersOpen(true)}
        className={cn(
          TILE,
          MONEY_SPAN,
          'cursor-pointer hover:border-amber-400/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 disabled:cursor-default dark:hover:border-amber-400/40',
        )}
      >
        <TileBody
          icon={SHIPMENT_PATH.money}
          tone={TONE.others}
          label={t('operations.board.figures.otherCurrencies')}
          value={money(tiles.money.othersSum)}
        />
        {/* It opens something — the boards' «عملات أخرى» says so the same way, by its amber edge on
            hover; here a chevron too, as a tile otherwise reads as a figure only. */}
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className="ms-auto h-4 w-4 shrink-0 text-amber-500 rtl:-scale-x-100 dark:text-amber-400"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div data-vault-held-tile="bags" className={cn(TILE, PACKAGE_SPAN)}>
        <TileBody
          icon={SHIPMENT_PATH.bag}
          tone={TONE.packages}
          label={t('operations.reportBoard.bags')}
          value={tiles.bags}
          compact
        />
      </div>
      <div data-vault-held-tile="cartons" className={cn(TILE, PACKAGE_SPAN)}>
        <TileBody
          icon={SHIPMENT_PATH.shipment}
          tone={TONE.packages}
          label={t('operations.vaultHistory.tiles.cartons')}
          value={tiles.cartons}
          compact
        />
      </div>
      <div data-vault-held-tile="boxes" className={cn(TILE, PACKAGE_SPAN)}>
        <TileBody
          icon={SHIPMENT_PATH.cube}
          tone={TONE.packages}
          label={t('operations.vaultHistory.tiles.boxes')}
          value={tiles.boxes}
          compact
        />
      </div>

      <OtherCurrenciesDialog
        open={othersOpen}
        onClose={() => setOthersOpen(false)}
        cards={reportOtherCards(tiles.money)}
        sum={tiles.money.othersSum}
        currencyOf={reportCurrencyLookup(catalog, tiles.money.others)}
        locale={locale}
        // The same words the table's «الإجمالي» row gives its own «عملات أخرى».
        subtitle={t('operations.reportBoard.othersOf', {
          name: t('operations.reportBoard.total'),
        })}
      />
    </section>
  );
};

/** The tiles while the answer is on its way — their frames, at their height. */
const TilesSkeleton = (): JSX.Element => (
  <div className={TILE_GRID} data-vault-held-loading="true" aria-busy="true">
    {[0, 1, 2, 3].map((i) => (
      <Skeleton key={i} className={cn('h-[62px] rounded-xl sm:h-[74px]', MONEY_SPAN)} />
    ))}
    {[0, 1, 2].map((i) => (
      <Skeleton key={i} className={cn('h-[62px] rounded-xl sm:h-[74px]', PACKAGE_SPAN)} />
    ))}
  </div>
);

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
      {data === undefined ? <TilesSkeleton /> : <HeldTiles data={data} />}
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

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The modal while it is up — mounted only then, so the report is read only then. */
const HeldReportModal = ({ onClose }: { onClose: () => void }): JSX.Element => {
  const t = useT();
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  // The latest `onClose` without re-running the effect: a new arrow each render must not re-take
  // the focus or forget who opened the modal.
  const close = useRef(onClose);
  close.current = onClose;
  const { held, rows, face } = useHeldReport(true);

  // The custody dashboard's keyboard and focus (`CustodyDashboard.tsx`), and one thing more: the
  // breakdown of «عملات أخرى» opens OVER this modal. Escape is then the breakdown's alone
  // (`isTopDialog`): it closes, and the report stays. Tab still never leaves the two: the breakdown
  // keeps no focus of its own, so the trap moves onto it while it is up (`focusScope`). Switched
  // off instead, it let Tab walk out of both into the history behind.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const roots = (): Element[] => Array.from(document.querySelectorAll('[data-dialog-root]'));
    const onTop = (): boolean => isTopDialog(roots(), rootRef.current);
    // The panel Tab goes round: the report's own, or the dialog it opened over itself.
    const scope = (): Element | null => {
      const root = focusScope(roots(), rootRef.current);
      if (root === null || root === rootRef.current) return panelRef.current;
      return root.querySelector('[role="dialog"]') ?? root;
    };
    const stops = (box: Element | null): HTMLElement[] =>
      Array.from(box?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
    // Which way Tab was last pressed — where focus that slipped out comes back in.
    let back = false;
    const trap = (active: Element | null, preventDefault?: () => void): void => {
      const box = scope();
      const list = stops(box);
      const first = list[0];
      const last = list[list.length - 1];
      if (first === undefined || last === undefined) return;
      const inside = active !== null && box?.contains(active) === true;
      const target = custodyTrapFocus<Element>({ back, active, first, last, inside });
      if (!(target instanceof HTMLElement)) return;
      preventDefault?.();
      target.focus();
    };
    // On the document, not the panel: after a click on plain text the focus sits on <body>, and a
    // key pressed there never reaches the panel's own handler.
    const onKey = (e: KeyboardEvent): void => {
      // A control inside that takes its own Escape first (and says so) keeps the report open, and
      // so does the breakdown over it, which closes alone.
      if (e.key === 'Escape' && !e.defaultPrevented) {
        if (!onTop()) return;
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      back = e.shiftKey;
      // On <body> the browser moves from where the click landed; `focusin` catches it if it leaves.
      if (document.activeElement === document.body) return;
      trap(document.activeElement, () => e.preventDefault());
    };
    // Nothing behind the modal takes the focus while it is up — it comes straight back in.
    const onFocusIn = (e: FocusEvent): void => {
      if (e.target instanceof Node && scope()?.contains(e.target) === false) {
        trap(e.target instanceof Element ? e.target : null);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
      document.body.style.overflow = previous;
      opener?.focus();
    };
  }, []);

  return (
    <div
      ref={rootRef}
      data-dialog-root=""
      className="fixed inset-0 z-[90]"
      data-vault-held-dialog="true"
    >
      <div className="absolute inset-0 animate-fade-in bg-slate-900/50" aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full w-full animate-pop-in flex-col bg-[#f8fafc] text-slate-800 antialiased selection:bg-emerald-600 selection:text-white dark:bg-[#0b0f19] dark:text-slate-200"
      >
        <header className="shrink-0 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-md lg:px-8 lg:py-3.5 dark:border-[#1c263b] dark:bg-[#0c111e]/95">
          <HeadRow
            titleId={titleId}
            data={held.data}
            rows={rows}
            close={
              <button
                ref={closeButton}
                type="button"
                onClick={() => close.current()}
                aria-label={t('common.close')}
                title={t('common.close')}
                data-vault-held-close="true"
                className="-me-1 shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <CloseIcon />
              </button>
            }
          />
        </header>
        {/* The modal scrolls inside itself; a refetch holds the last answer, dimmed. From a computer
            up the body is the screen's height (at least a laptop's), so the table takes what the
            tiles leave and only its rows scroll. */}
        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain',
            SCROLLBAR,
            held.isFetching && face === 'ready' && 'opacity-60 transition-opacity',
          )}
          data-vault-held-scroll="true"
        >
          <div
            className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-5 lg:h-full lg:min-h-[34rem] lg:px-8 lg:py-6"
            data-vault-held-body="true"
          >
            <VaultHeldReportBody
              face={face}
              data={held.data}
              rows={rows}
              error={held.error}
              onRetry={() => void held.refetch()}
            />
          </div>
        </div>
      </div>
    </div>
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
