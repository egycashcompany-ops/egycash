// The line a paste dialog keeps when its run stopped part-way (`inPasteBatches`) — on the screens
// whose requests are safe to send again: every line not confirmed is back in the boxes, the first
// of them were in the request that stopped and may have partly gone through, and the screen's own
// words say how a line already done reads on the next send (`safeHint`).
import { useT } from '../../../platform/localization/useT';

export const PasteStopNotice = ({
  left,
  maybeDone,
  action,
  safeHint,
}: {
  left: number;
  maybeDone: number;
  /** The dialog's own button label, named in the line. */
  action: string;
  safeHint: string;
}): JSX.Element | null => {
  const t = useT();
  if (left === 0) return null;
  return (
    <p className="w-full text-sm text-red-600 dark:text-red-400" data-paste-stop="true">
      {t('atm.common.openStopped', { count: left })} — {t('atm.common.pasteLeft', { action })}
      {maybeDone > 0 && (
        <>
          {' '}
          {t('atm.common.pasteMaybeDone', { count: maybeDone })} {safeHint}
        </>
      )}
    </p>
  );
};
