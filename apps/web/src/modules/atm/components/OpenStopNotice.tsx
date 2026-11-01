// The lines under an open form when its run stopped part-way (the lines go in requests of
// `ATM_OPEN_MAX_ROWS` — `openInBatches`). Two facts, each kept on the page until the next press:
//
//   · how many lines were NOT sent — they are back in the boxes, and pressing open sends them;
//   · the lines of a request that got NO answer — the server may have opened some or all of them,
//     so they are not in the boxes: they are named here, to be checked on the board first, and
//     «إعادتها إلى الخانات» puts them back once the reader has.
//
// A toast says the same in one line and goes; this stays, because the reader acts on it.
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Button } from '../../../shared/ui/Button';
import { joinCodes } from '../lib/operation-view';

/** Where a stopped run left the form: lines back in the boxes, and lines of unknown outcome. */
export interface OpenStop<Row> {
  unsent: number;
  uncertain: Row[];
}

/** Pure: `lines` set before what a box already holds, line for line (the boxes pair by line). */
export const prependLines = (lines: string, current: string): string =>
  current === '' ? lines : `${lines}\n${current}`;

export const OpenStopNotice = ({
  unsent,
  uncertainCodes,
  onRestore,
}: {
  unsent: number;
  uncertainCodes: readonly string[];
  onRestore: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  return (
    <>
      {uncertainCodes.length > 0 && (
        <div className="flex w-full flex-wrap items-center gap-2" data-open-stop="uncertain">
          <p className="text-sm text-red-600 dark:text-red-400">
            {t('atm.common.openUncertain', { count: uncertainCodes.length })} —{' '}
            {t('atm.common.openUncertainHint', { codes: joinCodes(uncertainCodes, locale) })}
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={onRestore}>
            {t('atm.common.openUncertainRestore')}
          </Button>
        </div>
      )}
      {unsent > 0 && (
        <p className="w-full text-sm text-red-600 dark:text-red-400" data-open-stop="unsent">
          {t('atm.common.openStopped', { count: unsent })} — {t('atm.common.openStoppedHint')}
        </p>
      )}
    </>
  );
};
