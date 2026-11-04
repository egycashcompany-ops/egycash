// The line an open board shows when its one read was cut (`AtmOpenBoardDto.truncated`): more rows
// are open than `ATM_OPEN_BOARD_MAX_ROWS`, so the table holds the first of them only. The page walk
// the board read replaced (2026-11) was bounded too, and silently; a board that is not whole says so,
// with the way to reach the rest — the bank and area filters narrow the read itself, on the server.
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { formatNumber } from '../../../shared/lib/format';

export const OpenBoardCutShort = ({
  board,
}: {
  board: { truncated: boolean; totalItems: number; items: readonly unknown[] } | undefined;
}): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  if (board?.truncated !== true) return null;
  return (
    <p
      role="status"
      data-board-cut-short="true"
      className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
    >
      {t('atm.common.boardCutShort', {
        total: formatNumber(board.totalItems, locale),
        shown: formatNumber(board.items.length, locale),
      })}
    </p>
  );
};
