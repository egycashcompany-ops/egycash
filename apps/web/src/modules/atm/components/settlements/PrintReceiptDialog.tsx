// Before «بيان التغذية» is printed again, or printed while drafts remain (§8.3, §9.4, GS-27): the
// paper covers issued and prepared lines only, and S-5 allows one per bank per day — so the dialog
// says what will be left out, when the last one was printed and by whom, and that the issued lines
// changed since. The paper itself carries none of this.
//
// The confirm is the click the print tab opens in (§8).
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { formatBusinessDateTime, formatNumber } from '../../../../shared/lib/format';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';

export const PrintReceiptDialog = ({
  open,
  drafts,
  lastPrint,
  stale,
  locale,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  /** Draft lines the paper leaves out. */
  drafts: number;
  lastPrint: { at: string; byName: string | null } | null;
  /** The issued lines changed since the last print (`summary.receiptStale`). */
  stale: boolean;
  locale: Locale;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const at = lastPrint === null ? '' : formatBusinessDateTime(lastPrint.at, locale);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('atm.plan.action.printReceipt')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} onClick={onConfirm}>
            {t('atm.plan.print.confirm')}
          </Button>
        </>
      }
    >
      <div
        className="space-y-2 text-sm text-slate-700 dark:text-slate-200"
        data-receipt-dialog="true"
      >
        {drafts > 0 && (
          <p className="text-amber-700 dark:text-amber-400">
            {t('atm.plan.print.draftsExcluded', { n: formatNumber(drafts, locale) })}
          </p>
        )}
        {lastPrint !== null && (
          <p>{t('atm.plan.print.lastPrint', { at, name: lastPrint.byName ?? '—' })}</p>
        )}
        {lastPrint !== null && stale && (
          <p className="text-amber-700 dark:text-amber-400">
            {t('atm.plan.notice.receiptStale', { at })}
          </p>
        )}
      </div>
    </Dialog>
  );
};
