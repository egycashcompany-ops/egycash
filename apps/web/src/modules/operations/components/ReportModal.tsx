// The full-screen window the vault's two live reports open in — «تقرير الخزينة» on «سجل الخزينة»
// (`VaultHeldReportDialog.tsx`, Round 12) and «لوحة تحكم» on «محصنات الخزينة»
// (`SecuredDispatchDashboard.tsx`, Round 16) — and the figure tiles both lead with.
//
// WHY ONE FRAME. The owner asked for the second as he asked for the first, after the same model:
// «سجل الخزينه لما اوس على تقرير يفتح ززى موديل زى لوحة التحكم اللى عملنها فى العهدة», then
// «دلوقتي محصنات الخزينة أنا عايز يكون فيها لوحة تحكم اللي هي داشبورد جنب الإحصائيات». Both are
// Fleet's custody dashboard (`fleet/components/CustodyDashboard.tsx`): the portal over the whole
// screen, the header with its title and ×, Escape to close, the focus kept inside and handed back,
// the page behind held still, its own scroll, its dark and light surfaces, its figure tiles. Two
// copies of that would drift the first time one of them is fixed — the keyboard most of all, which
// took a round of its own to get right on «تقرير الخزينة» (the «عملات أخرى» breakdown over it). So
// the window is written once, here, and each report brings only what it holds.
//
// The `mark` names each report's `data-*` hooks (`data-vault-held-close`, `data-dispatch-dashboard-
// close`, …), which the specs and the screenshots find it by.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MAX_PAGE_SIZE } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { formatAmount } from '../../../shared/lib/format';
import { CloseIcon } from '../../../shared/ui/icons';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { useAppSelector } from '../../../store';
import {
  CAIRO,
  CARD,
  SCROLLBAR,
  custodyTrapFocus,
} from '../../fleet/components/custody-dashboard-parts';
import { BoardIcon, NUM } from '../../fleet/components/FuelCardBoard';
import { useOperationsCurrencies } from '../api/operations-queries';
import { reportCurrencyLookup, reportOtherCards } from '../lib/report-board';
import { focusScope, isTopDialog, type HeldReportTiles } from '../lib/vault-held-report';
import { OtherCurrenciesDialog } from './BoardFigures';
import { SHIPMENT_PATH } from './shipment-icons';

/** The `data-*` hooks a report's window and tiles carry — `data-<mark>-close`, and so on. */
const marked = (mark: string, part: string, value = 'true'): Record<string, string> => ({
  [`data-${mark}-${part}`]: value,
});

// ── The window ────────────────────────────────────────────────────────────────────────────────

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The window itself, mounted only while it is up (the report's query with it — nothing is read for
 * a report nobody is looking at). The caller portals it (`createPortal(…, document.body)`).
 *
 * The custody dashboard's keyboard and focus, and one thing more: a dialog the report opens OVER
 * itself — the boards' «عملات أخرى» breakdown — answers Escape alone (`isTopDialog`), and Tab still
 * never leaves the two: the breakdown keeps no focus of its own, so the trap moves onto it while it
 * is up (`focusScope`). Switched off instead, it let Tab walk out of both into the screen behind.
 */
export const ReportModalFrame = ({
  mark,
  titleId,
  head,
  dimmed,
  onClose,
  bodyClassName = 'mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-5 lg:h-full lg:min-h-[34rem] lg:px-8 lg:py-6',
  children,
}: {
  /** The report's name in its `data-*` hooks. */
  mark: string;
  /** The heading's id — what the dialog is named by. */
  titleId: string;
  /** The header's content, handed the × to place at its end. */
  head: (close: ReactNode) => ReactNode;
  /** A refetch is on its way over the answer shown: the body is dimmed until it lands. */
  dimmed: boolean;
  onClose: () => void;
  /** The body's frame inside the scroll — the held report's is the screen's height. */
  bodyClassName?: string;
  children: ReactNode;
}): JSX.Element => {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  // The latest `onClose` without re-running the effect: a new arrow each render must not re-take
  // the focus or forget who opened the modal.
  const close = useRef(onClose);
  close.current = onClose;

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
      {...marked(mark, 'dialog')}
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
          {head(
            <button
              ref={closeButton}
              type="button"
              onClick={() => close.current()}
              aria-label={t('common.close')}
              title={t('common.close')}
              {...marked(mark, 'close')}
              className="-me-1 shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <CloseIcon />
            </button>,
          )}
        </header>
        {/* The modal scrolls inside itself; a refetch holds the last answer, dimmed. */}
        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain',
            SCROLLBAR,
            dimmed && 'opacity-60 transition-opacity',
          )}
          {...marked(mark, 'scroll')}
        >
          <div className={bodyClassName} {...marked(mark, 'body')}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

/** The title with its live dot — the custody dashboard's header title. */
export const ReportModalTitle = ({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}): JSX.Element => (
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
    {children}
  </h2>
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
  /** Null while what it is read off is on its way; `missing` when it could not be read. */
  value: number | null | 'missing';
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
                value === 0 || value === 'missing'
                  ? 'text-slate-400 dark:text-slate-500'
                  : 'text-slate-900 dark:text-white',
                NUM,
              )}
            >
              {/* A count that could not be read is a dash, never a zero that reads as "none". */}
              {value === 'missing' ? '—' : formatAmount(value, locale)}
            </span>
            {unit !== undefined && value !== 'missing' && (
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

/**
 * The seven tiles, in the owner's order: «عدد المحصنات», «المصري», «الدولار», «عملات أخرى» (opening
 * the boards' breakdown of what that sum adds together), «الحقائب», «الكراتين», «الصناديق». Each
 * report hands in its own figures — the held report its server's grand total, the dashboard its
 * shown rows rolled up — split by the same classifier (`reportMoney`).
 */
export const ReportFigureTiles = ({
  mark,
  label,
  tiles,
  packages = 'ready',
}: {
  mark: string;
  /** The section's name, read to a screen reader. */
  label: string;
  tiles: HeldReportTiles;
  /** Whether the package counts are in yet — the dashboard reads them from the custody list. */
  packages?: 'loading' | 'missing' | 'ready';
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  // The boards' own query, so the catalog is one cache across them: the money is split by it.
  const currencies = useOperationsCurrencies({ page: 1, pageSize: MAX_PAGE_SIZE });
  const catalog = currencies.data?.items ?? [];
  const ready = currencies.data !== undefined;
  const [othersOpen, setOthersOpen] = useState(false);
  const money = (value: number): number | null => (ready ? value : null);
  const counted = (value: number): number | null | 'missing' =>
    packages === 'ready' ? value : packages === 'loading' ? null : 'missing';
  // When the breakdown closes, the focus goes back to the tile that opened it, as the report hands
  // it back to the button that opened the report. The boards' dialog hands back nothing, so the
  // focus would otherwise drop to the page's <body>. This runs after the breakdown has left the
  // page, so the report's trap counts the tile as its own again.
  const othersTile = useRef<HTMLButtonElement>(null);
  const othersWasOpen = useRef(false);
  useEffect(() => {
    if (othersWasOpen.current && !othersOpen) othersTile.current?.focus();
    othersWasOpen.current = othersOpen;
  }, [othersOpen]);

  return (
    <section className={TILE_GRID} aria-label={label} {...marked(mark, 'tiles')}>
      <div {...marked(mark, 'tile', 'count')} className={cn(TILE, MONEY_SPAN)}>
        <TileBody
          icon={SHIPMENT_PATH.shipment}
          tone={TONE.count}
          label={t('operations.vaultReport.securedCount')}
          value={tiles.count}
        />
      </div>
      <div {...marked(mark, 'tile', 'egp')} className={cn(TILE, MONEY_SPAN)}>
        <TileBody
          icon={SHIPMENT_PATH.money}
          tone={TONE.pound}
          label={t('operations.reportBoard.pound')}
          value={money(tiles.money.egp)}
          unit="EGP"
        />
      </div>
      <div {...marked(mark, 'tile', 'usd')} className={cn(TILE, MONEY_SPAN)}>
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
        {...marked(mark, 'tile', 'others')}
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
      <div {...marked(mark, 'tile', 'bags')} className={cn(TILE, PACKAGE_SPAN)}>
        <TileBody
          icon={SHIPMENT_PATH.bag}
          tone={TONE.packages}
          label={t('operations.reportBoard.bags')}
          value={counted(tiles.bags)}
          compact
        />
      </div>
      <div {...marked(mark, 'tile', 'cartons')} className={cn(TILE, PACKAGE_SPAN)}>
        <TileBody
          icon={SHIPMENT_PATH.shipment}
          tone={TONE.packages}
          label={t('operations.vaultHistory.tiles.cartons')}
          value={counted(tiles.cartons)}
          compact
        />
      </div>
      <div {...marked(mark, 'tile', 'boxes')} className={cn(TILE, PACKAGE_SPAN)}>
        <TileBody
          icon={SHIPMENT_PATH.cube}
          tone={TONE.packages}
          label={t('operations.vaultHistory.tiles.boxes')}
          value={counted(tiles.boxes)}
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
export const ReportTilesSkeleton = ({ mark }: { mark: string }): JSX.Element => (
  <div className={TILE_GRID} {...marked(mark, 'loading')} aria-busy="true">
    {[0, 1, 2, 3].map((i) => (
      <Skeleton key={i} className={cn('h-[62px] rounded-xl sm:h-[74px]', MONEY_SPAN)} />
    ))}
    {[0, 1, 2].map((i) => (
      <Skeleton key={i} className={cn('h-[62px] rounded-xl sm:h-[74px]', PACKAGE_SPAN)} />
    ))}
  </div>
);
