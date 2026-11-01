// The lines under an open form when its run stopped part-way (the lines go in requests of
// `ATM_OPEN_MAX_ROWS` — `openInBatches`). Two facts:
//
//   · how many lines were NOT sent — they are back in the boxes, and pressing open sends them;
//     this one is about the last press only;
//   · the lines of a request whose result is unknown — the server may have opened some or all of
//     them, so they are not in the boxes: they are named here, to be checked in the table first.
//     They STAY until the reader puts them back («إعادتها إلى الخانات») or hides the list — a
//     later press (the unsent line asks for one) never drops them, and a later stop adds to them.
//
// A toast says the same in one line and goes; this stays, because the reader acts on it.
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Button } from '../../../shared/ui/Button';
import { joinCodes } from '../lib/operation-view';

/** What the form keeps after its presses: the last press's unsent count, and uncertain lines. */
export interface OpenStopState<Row> {
  unsent: number;
  uncertain: Row[];
}

export const emptyOpenStop = <Row,>(): OpenStopState<Row> => ({ unsent: 0, uncertain: [] });

/** Pure: a press starts — the last press's unsent count goes; the uncertain lines stay. */
export const openPressStarted = <Row,>(state: OpenStopState<Row>): OpenStopState<Row> => ({
  unsent: 0,
  uncertain: state.uncertain,
});

/** Pure: a press ended — its unsent count, and its uncertain lines after the ones still held. */
export const openPressEnded = <Row,>(
  state: OpenStopState<Row>,
  result: { unsent: readonly Row[]; uncertain: readonly Row[] },
): OpenStopState<Row> => ({
  unsent: result.unsent.length,
  uncertain: [...state.uncertain, ...result.uncertain],
});

/** Pure: `lines` set before what a box already holds, line for line (the boxes pair by line). */
export const prependLines = (lines: string, current: string): string =>
  current === '' ? lines : `${lines}\n${current}`;

export const OpenStopNotice = ({
  unsent,
  uncertainCodes,
  action,
  onRestore,
  onDismiss,
}: {
  unsent: number;
  uncertainCodes: readonly string[];
  /** The form's own open button label, named in the unsent line. */
  action: string;
  onRestore: () => void;
  onDismiss: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  return (
    <>
      {uncertainCodes.length > 0 && (
        <div className="flex w-full flex-wrap items-center gap-2" data-open-stop="uncertain">
          <p className="text-sm text-red-600 dark:text-red-400">
            {t('atm.common.openUncertain', { count: uncertainCodes.length })} —{' '}
            {t('atm.common.openUncertainRisk')}{' '}
            {t('atm.common.openUncertainHint', { codes: joinCodes(uncertainCodes, locale) })}
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={onRestore}>
            {t('atm.common.openUncertainRestore')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
            {t('atm.common.openUncertainDismiss')}
          </Button>
        </div>
      )}
      {unsent > 0 && (
        <p className="w-full text-sm text-red-600 dark:text-red-400" data-open-stop="unsent">
          {t('atm.common.openStopped', { count: unsent })} —{' '}
          {t('atm.common.openStoppedHint', { action })}
        </p>
      )}
    </>
  );
};
