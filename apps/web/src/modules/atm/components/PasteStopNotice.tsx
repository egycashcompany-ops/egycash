// The line a paste dialog keeps when its run stopped part-way (`inPasteBatches`) — on the screens
// whose requests are safe to send again: every line not confirmed is back in the boxes, and when
// the request that stopped may have partly gone through (`maybeDone`) the line says so and how a
// line already done reads on the next send (`safeHint`). «اضغط … مرة أخرى» is left out when a new
// press would be refused the same way (the plan full).
import { useT } from '../../../platform/localization/useT';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Pure: the stop's title — «توقف الإرسال قبل آخر n سطر» only when none of them went; when the
 * request that stopped carried some of them, «توقف الإرسال، وأُعيد n سطر إلى الخانات».
 */
export const pasteStopTitle = (
  t: Translate,
  left: number,
  maybeDone: number,
  count: string | number = left,
): string =>
  maybeDone > 0
    ? t('atm.common.pasteStoppedBack', { count })
    : t('atm.common.openStopped', { count });

export const PasteStopNotice = ({
  left,
  maybeDone,
  action,
  safeHint,
  pressAgain = true,
  formatCount = String,
}: {
  left: number;
  maybeDone: number;
  /** The dialog's own button label, named in the line. */
  action: string;
  safeHint: string;
  /** False when a new press would be refused the same way. */
  pressAgain?: boolean;
  /** How the dialog writes its other counts (the plan writes them in the reader's digits). */
  formatCount?: (n: number) => string;
}): JSX.Element | null => {
  const t = useT();
  if (left === 0) return null;
  const title = pasteStopTitle(t, left, maybeDone, formatCount(left));
  return (
    <p className="w-full text-sm text-red-600 dark:text-red-400" data-paste-stop="true">
      {maybeDone > 0 ? (
        <>
          {title} — {t('atm.common.pasteMaybeDone', { count: formatCount(maybeDone) })} {safeHint}
          {pressAgain && <> {t('atm.common.pressAgain', { action })}</>}
        </>
      ) : (
        <>
          {title} —{' '}
          {pressAgain ? t('atm.common.pasteLeft', { action }) : t('atm.common.pasteLeftOnly')}
        </>
      )}
    </p>
  );
};
