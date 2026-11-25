// «البيانات المرجعية»'s kinds as a row of cards (Round 34 B) — «عاوز أغير اللي اوت بتاع بيانات
// المراجعة يكون بروفيشنال أكتر من كده». The plain underline tabs become the boards' cards: each kind's
// icon in its own colour, its name, and how many rows it holds («الفروع 1,340») in the boards'
// figure face (Latin digits, isolated left to right), the chosen one in the site's purple.
//
// STILL A TAB LIST, with every promise one makes: `role="tablist"` / `role="tab"` /
// `aria-selected`, one tab in the Tab order (the chosen one) and the arrows walking the row in the
// reading direction (`kindStep`) — choosing as they move, as the address bar's `?kind=` follows.
//
// A phone: the row scrolls sideways inside itself (the page never does), each card its own width.
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { BoardIcon, NUM } from '../../fleet/components/FuelCardBoard';
import { FILTER_ICON } from '../../fleet/components/FilterWithIcon';
import { kindStep, type CatalogKind } from '../lib/catalog-filters';
import { SHIPMENT_PATH } from './shipment-icons';

/** Each kind's picture and colour — the boards' tones, one a kind. */
const KIND_LOOK: Record<CatalogKind, { icon: readonly string[]; tone: string }> = {
  banks: {
    icon: SHIPMENT_PATH.bank,
    tone: 'bg-violet-500/15 text-violet-600 dark:text-violet-300',
  },
  branches: {
    icon: FILTER_ICON.branch,
    tone: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
  },
  currencies: {
    icon: SHIPMENT_PATH.money,
    tone: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  areas: {
    icon: FILTER_ICON.map,
    tone: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  shiftTypes: {
    icon: FILTER_ICON.make,
    tone: 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
  },
};

/** A count in the boards' figures: Latin digits grouped with a comma, in Arabic as in English. */
export const catalogFigure = (n: number): string => new Intl.NumberFormat('en-US').format(n);

/** The tab's id and its panel's — one screen of this kind is ever on a page. */
export const catalogTabId = (kind: CatalogKind): string => `catalog-tab-${kind}`;
export const CATALOG_PANEL_ID = 'catalog-panel';

export const CatalogKindCards = ({
  kinds,
  current,
  counts,
  dir,
  onSelect,
}: {
  kinds: readonly CatalogKind[];
  current: CatalogKind;
  /** Each kind's rows, or null while its count is on its way. */
  counts: Readonly<Record<CatalogKind, number | null>>;
  dir: 'rtl' | 'ltr';
  onSelect: (kind: CatalogKind) => void;
}): JSX.Element => {
  const t = useT();
  const refs = useRef<Partial<Record<CatalogKind, HTMLButtonElement | null>>>({});
  const list = useRef<HTMLDivElement | null>(null);
  // On a phone the row scrolls: the chosen card is brought into it (a link to «أنواع التشغيل»
  // opens with its card in view). The ROW is scrolled, by the card's overhang and no more —
  // never `scrollIntoView`, which also scrolls every scrolling box around it (the board's frame
  // among them). A delta, so it reads the same in a right-to-left row.
  useEffect(() => {
    const row = list.current;
    const card = refs.current[current];
    if (row === null || card === undefined || card === null) return;
    if (row.scrollWidth <= row.clientWidth) return;
    const r = row.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    if (c.left < r.left) row.scrollLeft -= r.left - c.left;
    else if (c.right > r.right) row.scrollLeft += c.right - r.right;
  }, [current]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    const next = kindStep(kinds, current, e.key, dir);
    if (next === null) return;
    e.preventDefault();
    onSelect(next);
    refs.current[next]?.focus();
  };

  return (
    <div
      ref={list}
      role="tablist"
      aria-label={t('operations.catalogs.kinds')}
      data-catalog-kinds="true"
      // A phone and a small tablet: one row that scrolls inside itself (no overhang past the
      // page's gutter — it would give the board's frame a sideways scroll). From `md` the five
      // share the row evenly.
      className="flex shrink-0 gap-2 overflow-x-auto pb-1 md:grid md:grid-cols-5 md:gap-3 md:overflow-visible md:pb-0"
    >
      {kinds.map((kind) => {
        const selected = kind === current;
        const count = counts[kind];
        const look = KIND_LOOK[kind];
        return (
          <button
            key={kind}
            ref={(el) => {
              refs.current[kind] = el;
            }}
            type="button"
            role="tab"
            id={catalogTabId(kind)}
            aria-selected={selected}
            aria-controls={CATALOG_PANEL_ID}
            tabIndex={selected ? 0 : -1}
            data-catalog-kind={kind}
            onClick={() => {
              if (!selected) onSelect(kind);
            }}
            onKeyDown={onKeyDown}
            className={cn(
              'group relative flex w-44 shrink-0 items-center gap-3 overflow-hidden rounded-xl border p-3 text-start transition md:w-auto',
              // Round 34 verifier — from `md` to `lg` the five share the row at 134–170px each: the
              // icon BESIDE the name left «أنواع التشغيل» 56px at 768 and cut it. There the icon
              // sits ABOVE the name, which gets the card's whole width; from `lg` beside it again.
              'md:flex-col md:items-start md:gap-2 lg:flex-row lg:items-center lg:gap-3',
              // Inset: the scrolling row would clip a ring drawn outside the card.
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/70',
              selected
                ? 'border-brand-500/70 bg-brand-50 shadow-sm shadow-brand-700/10 dark:border-brand-400/60 dark:bg-brand-500/10'
                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-[#111827] dark:hover:border-slate-700 dark:hover:bg-[#16203a]',
            )}
          >
            {/* The chosen card's edge, in the site's purple — read at a glance across the row. */}
            {selected && (
              <span
                aria-hidden
                className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-brand-500 dark:bg-brand-400"
              />
            )}
            <span
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                look.tone,
              )}
            >
              <BoardIcon d={[...look.icon]} className="h-5 w-5" />
            </span>
            <span className="flex min-w-0 max-w-full flex-col">
              <span
                className={cn(
                  'truncate text-[13px] font-bold',
                  selected
                    ? 'text-brand-700 dark:text-brand-200'
                    : 'text-slate-600 dark:text-slate-300',
                )}
              >
                {t(`operations.catalogs.tab.${kind}`)}
              </span>
              {/* The figure isolated left to right inside a line that keeps the page's own
                direction, so it starts where the name starts in either language. */}
              <span
                className={cn(
                  'text-xl font-black leading-7',
                  NUM,
                  count === null
                    ? 'text-slate-300 dark:text-slate-600'
                    : 'text-slate-900 dark:text-white',
                )}
              >
                <bdi dir="ltr" data-catalog-count={kind}>
                  {count === null ? '—' : catalogFigure(count)}
                </bdi>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
};
