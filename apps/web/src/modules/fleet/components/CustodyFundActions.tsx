// «زرار تسوية العهدة و استعاضة العهدة و شحن العهدة كل واحد هيعمل اكشن معين»: the fund's three
// actions, now that each does its own — «تسوية العهدة» settles licence expenses out of the fund,
// «استعاضة العهدة» brings back what memos spent, «شحن العهدة» charges money into it. One framed group
// (the export pair's frame), each with its own coloured icon, at the far left of the toolbar of
// «العهدة» and of «سجل العهدة». A press opens its dialog through the address (`?fund=<op>`), so the
// dialog is a place: Back closes it, and a link can open it. On a phone each says its one word
// (`short`), as the export pair says «Excel» and «PDF»: the three whole names are wider than a
// phone's toolbar. Writing money into or out of the fund is what «إيصالات العهدة» already does, so
// the group is drawn only for a reader who may add one (`fleetReceipt.create`).
import { Fragment, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { cn } from '../../../shared/lib/cn';
import { BoardIcon } from './FuelCardBoard';
import { PILL_BUTTON, PILL_FRAME } from './custody-board-looks';

export type CustodyFundOp = 'settle' | 'replenish' | 'charge';

/** The owner's order, right to left: «تسوية العهدة», «استعاضة العهدة», «شحن العهدة». */
export const CUSTODY_FUND_ORDER: readonly CustodyFundOp[] = ['settle', 'replenish', 'charge'];

export interface CustodyOpLook {
  /** Its whole name, and the one word a phone shows. */
  label: string;
  short: string;
  icon: readonly string[];
  /** The icon's ink in the group, and the button's hover. */
  tone: string;
  hover: string;
  /** Its chip in «سجل العهدة», its icon's tile, and the edge of its card. */
  chip: string;
  tile: string;
  accent: string;
}

/** Each action's words and colours — one place for the toolbar, the dialogs and the ledger. */
export const CUSTODY_OPS: Record<CustodyFundOp, CustodyOpLook> = {
  settle: {
    label: 'fleet.custody.actions.settle',
    short: 'fleet.custody.actions.settleShort',
    // A balance — the fund squared against what was spent.
    icon: [
      'M12 3v18',
      'M7 21h10',
      'M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2',
      'm16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z',
      'm2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z',
    ],
    tone: 'text-emerald-600 dark:text-emerald-400',
    hover:
      'hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/60 dark:hover:text-emerald-300',
    chip: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
    tile: 'border border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-400',
    accent: 'border-l-4 border-l-emerald-500 hover:border-l-emerald-500 dark:border-l-emerald-500',
  },
  replenish: {
    label: 'fleet.custody.actions.replenish',
    short: 'fleet.custody.actions.replenishShort',
    // Turning back round — what was spent comes back into the fund.
    icon: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
    tone: 'text-sky-600 dark:text-sky-400',
    hover: 'hover:bg-sky-50 hover:text-sky-700 dark:hover:bg-sky-950/60 dark:hover:text-sky-300',
    chip: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300',
    tile: 'border border-sky-200 bg-sky-50 text-sky-600 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-400',
    accent: 'border-l-4 border-l-sky-500 hover:border-l-sky-500 dark:border-l-sky-500',
  },
  charge: {
    label: 'fleet.custody.actions.request',
    short: 'fleet.custody.actions.requestShort',
    // A plus in a circle — money added to the fund.
    icon: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z', 'M12 8v8', 'M8 12h8'],
    tone: 'text-teal-600 dark:text-teal-400',
    hover:
      'hover:bg-teal-50 hover:text-teal-700 dark:hover:bg-teal-950/60 dark:hover:text-teal-300',
    chip: 'border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300',
    tile: 'border border-teal-200 bg-teal-50 text-teal-600 dark:border-teal-500/30 dark:bg-teal-500/15 dark:text-teal-400',
    accent: 'border-l-4 border-l-teal-500 hover:border-l-teal-500 dark:border-l-teal-500',
  },
};

export const isCustodyFundOp = (value: unknown): value is CustodyFundOp =>
  typeof value === 'string' && (CUSTODY_FUND_ORDER as readonly string[]).includes(value);

/** The address with `fund` set to `op`, or without it — every other parameter (`page` too) kept. */
export const withFundParam = (
  search: URLSearchParams,
  op: CustodyFundOp | null,
): URLSearchParams => {
  const next = new URLSearchParams(search);
  if (op === null) next.delete('fund');
  else next.set('fund', op);
  return next;
};

/**
 * Which fund dialog is open — `?fund=settle|replenish|charge`, anything else none — and how to open
 * or close one. The board's own filters, page and sort are left exactly as they are.
 */
export const useFundParam = (): [CustodyFundOp | null, (op: CustodyFundOp | null) => void] => {
  const [sp, setSp] = useSearchParams();
  const overlay = useOverlayHistory();
  const raw = sp.get('fund');
  const open = isCustodyFundOp(raw) ? raw : null;
  return [
    open,
    (op) =>
      op === null
        ? overlay.close(() => setSp(withFundParam(sp, null), { replace: true }))
        : setSp(withFundParam(sp, op), overlay.openOptions(open !== null)),
  ];
};

/** The mark an overlay's own history entry carries: the entry its opening pushed. */
const OVERLAY_ENTRY = { custodyOverlay: true } as const;
const isOverlayEntry = (state: unknown): boolean =>
  typeof state === 'object' &&
  state !== null &&
  (state as { custodyOverlay?: unknown }).custodyOverlay === true;

/**
 * A dialog or drawer kept in the address (`?fund=…`, `?open=…`): opening it PUSHES one marked
 * entry — so the browser's Back closes it — and closing it POPS that entry again, rather than
 * pushing another: Back after a close (or after the operation was recorded) then leaves the page
 * instead of reopening the dialog. Opened from an address typed or reloaded (no entry of its own),
 * it closes in place.
 */
export const useOverlayHistory = (): {
  /** The navigation options for opening — in place when one is already open. */
  openOptions: (alreadyOpen: boolean) => { replace?: boolean; state: unknown };
  /** Close: pop the entry the opening pushed, else `inPlace()`. */
  close: (inPlace: () => void) => void;
} => {
  const location = useLocation();
  const navigate = useNavigate();
  const pushed = isOverlayEntry(location.state);
  // The entry already popped: a second close before the address moves (a double click on ✕, an
  // Escape on top of a save) must not go back a second step and leave the page.
  const popped = useRef<string | null>(null);
  return {
    openOptions: (alreadyOpen) =>
      alreadyOpen ? { replace: true, state: location.state } : { state: OVERLAY_ENTRY },
    close: (inPlace) => {
      if (!pushed) {
        inPlace();
        return;
      }
      if (popped.current === location.key) return;
      popped.current = location.key;
      void navigate(-1);
    },
  };
};

/**
 * The three, as the board has always drawn them — the export pair's frame
 * (`data-custody-fund-actions`), each button `data-custody-fund-action={op}` with its whole name as
 * its title. Nothing at all for a reader who may not write custody money.
 */
export const CustodyFundActions = (): JSX.Element | null => {
  const t = useT();
  const can = useCan();
  const [, setFund] = useFundParam();
  if (!can('fleetReceipt.create')) return null;
  return (
    <div data-custody-fund-actions="true" className={PILL_FRAME}>
      {CUSTODY_FUND_ORDER.map((key, index) => (
        <Fragment key={key}>
          {index > 0 && <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />}
          <button
            type="button"
            data-custody-fund-action={key}
            title={t(CUSTODY_OPS[key].label)}
            onClick={() => setFund(key)}
            className={cn(PILL_BUTTON, CUSTODY_OPS[key].hover)}
          >
            <BoardIcon
              d={CUSTODY_OPS[key].icon}
              className={cn('h-3.5 w-3.5', CUSTODY_OPS[key].tone)}
            />
            <span className="sm:hidden">{t(CUSTODY_OPS[key].short)}</span>
            <span className="hidden sm:inline">{t(CUSTODY_OPS[key].label)}</span>
          </button>
        </Fragment>
      ))}
    </div>
  );
};
