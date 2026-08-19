// One drawer on the visual board.
//
// The cell is the gold system's, restyled: a square whose FILL rises from the bottom as weight goes
// in, its number in the corner, the key indicator opposite it, and — when the board is showing
// owners — a strip of colour-coded owner chips underneath. The fill colours are state colours, not
// theme colours: a drawer over its limit has to look wrong in either theme.
import { KeyIcon } from './GoldIcons';
import { fillColor, fillRatio } from '../lib/gold-format';

export interface DrawerCellOwner {
  id: string;
  name: string;
  count: number;
}

export const DrawerCell = ({
  number,
  weight,
  limit,
  barsCount,
  owners,
  size = 88,
  vaultMax = 0,
  showOwners = false,
  keyHolder,
  title,
  keyTitle,
  ownerColor,
  onClick,
}: {
  number: number;
  weight: number;
  limit: number;
  barsCount: number;
  owners: DrawerCellOwner[];
  size?: number;
  /** The heaviest drawer in this vault — what an unlimited drawer's bar is drawn against. */
  vaultMax?: number;
  showOwners?: boolean;
  /** `undefined` = this board is not showing keys at all; `null` = key not handed over. */
  keyHolder?: string | null;
  title: string;
  keyTitle?: string;
  ownerColor: (id: string) => string;
  onClick: () => void;
}): JSX.Element => {
  const hasLimit = limit > 0;
  const pct = hasLimit ? Math.round((weight / limit) * 100) : null;
  const over = hasLimit && weight > limit;
  const ratio = hasLimit
    ? Math.min(weight / limit, 1.2)
    : vaultMax > 0
      ? Math.min(weight / vaultMax, 1)
      : fillRatio(weight, 0);
  const clamp = Math.min(ratio, 1);
  const empty = weight <= 0;
  const showKey = keyHolder !== undefined;
  const handed = showKey && keyHolder !== null;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="relative flex shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 text-start transition hover:border-brand-400 dark:border-slate-700 dark:hover:border-brand-500"
      style={
        showOwners
          ? { width: size, minHeight: size, alignSelf: 'stretch' }
          : { width: size, height: size }
      }
    >
      {/* The fill, anchored at the base of the top square. */}
      <span
        className="absolute inset-x-0"
        style={{
          top: `${String((1 - clamp) * size)}px`,
          height: `${String(clamp * size)}px`,
          background: empty
            ? 'transparent'
            : `linear-gradient(to top, ${fillColor(ratio * 0.55)}, ${fillColor(ratio)})`,
          opacity: 0.85,
        }}
      />
      <span className="relative z-10 flex flex-col p-1.5" style={{ height: size }}>
        <span className="flex items-center justify-between">
          <span className="inline-grid h-5 min-w-5 place-items-center rounded-md bg-white/85 px-1 text-xs font-bold leading-none text-slate-900 dark:bg-slate-900/80 dark:text-slate-50">
            {number}
          </span>
          {showKey && (
            <span
              title={keyTitle}
              className="grid h-4 w-4 place-items-center rounded-full"
              style={{ background: handed ? 'rgba(63,174,107,0.22)' : 'rgba(224,82,78,0.22)' }}
            >
              <KeyIcon className="h-2.5 w-2.5" style={{ color: handed ? '#2f9e5f' : '#c0392b' }} />
            </span>
          )}
        </span>
        <span className="flex flex-1 flex-col items-center justify-center gap-0.5 leading-none">
          {hasLimit ? (
            <>
              <span
                className={`text-lg font-extrabold leading-none ${over ? 'text-red-700 dark:text-red-300' : 'text-slate-900 dark:text-slate-50'}`}
              >
                {pct}%
              </span>
              <span className="text-[11px] font-semibold leading-none text-slate-700 dark:text-slate-200">
                {Math.round(weight)}
              </span>
              <span className="text-[10px] leading-none text-slate-600 dark:text-slate-300">
                {barsCount}
              </span>
            </>
          ) : (
            <>
              <span className="text-base font-extrabold leading-none text-slate-900 dark:text-slate-50">
                {Math.round(weight)}
              </span>
              <span className="text-[11px] font-semibold leading-none text-slate-700 dark:text-slate-200">
                {barsCount}
              </span>
            </>
          )}
        </span>
      </span>
      {showOwners && owners.length > 0 && (
        <span
          className="relative z-10 mx-1 mb-1 flex flex-col gap-1 rounded-lg bg-white/70 p-1 dark:bg-slate-900/60"
          style={{ maxHeight: size, overflowY: 'auto' }}
        >
          {owners.map((owner) => (
            <span
              key={owner.id}
              className="whitespace-normal break-words rounded-md px-1.5 py-0.5 text-[11px] font-bold leading-tight"
              title={`${owner.name} (${String(owner.count)})`}
              style={{ background: ownerColor(owner.id), color: '#16110a' }}
            >
              {owner.name}
            </span>
          ))}
        </span>
      )}
    </button>
  );
};
