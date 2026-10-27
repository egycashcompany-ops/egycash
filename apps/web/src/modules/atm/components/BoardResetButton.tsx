// The open boards' reset — «عايز يكون في Reset للفلتر» (2026-10-27). The boards draw their filters
// beside the open form rather than inside a `FilterBar`, so they draw the bar's reset themselves:
// the same circular arrow, the same label, and the red tone the ATM machine list and map already
// ask for (`filterResetTone`). Shown only while something narrows the board, as the bar's is.
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { filterResetTone } from '../../../shared/ui/FilterBar';
import { ResetIcon } from '../../../shared/ui/icons';

export const BoardResetButton = ({
  active,
  onReset,
}: {
  active: boolean;
  onReset: () => void;
}): JSX.Element | null => {
  const t = useT();
  if (!active) return null;
  return (
    <button
      type="button"
      onClick={onReset}
      aria-label={t('common.filters.clear')}
      title={t('common.filters.clear')}
      data-board-reset="true"
      className={cn(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors focus:outline-none focus:ring-2',
        filterResetTone('red'),
      )}
    >
      <ResetIcon className="h-4 w-4" />
    </button>
  );
};
