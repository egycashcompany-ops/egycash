// «طباعة المستندات» — the employee's contract and every hiring form for the job, printed in one go
// (A27, «مستندات التعيين»). The server builds the set — making and generating the contract when
// there is none yet — and the button prints it in a tab of its own.
//
// The tab opens on the click itself, before the request: a tab opened after a request returns is
// one the browser's popup blocker refuses. What kept the contract out of the set (approval pending,
// a required value missing…) is said as a warning; the forms print regardless.
import { useT } from '../../../../platform/localization/useT';
import { Can } from '../../../../platform/rbac/Can';
import { Button } from '../../../../shared/ui/Button';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { openPrintWindow, writePrintWindow } from '../../../../shared/lib/print-window';
import { useHiringPack } from '../api/contract-queries';

export const PrintHiringPackButton = ({
  employeeId,
  variant = 'primary',
  size = 'sm',
  label,
}: {
  employeeId: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  label?: string;
}): JSX.Element => {
  const t = useT();
  const pack = useHiringPack();

  const print = async (): Promise<void> => {
    const win = openPrintWindow(t('hiringPack.preparing'));
    if (win === null) {
      toast.error(t('hiringPack.popupBlocked'));
      return;
    }
    try {
      const set = await pack.mutateAsync(employeeId);
      if (set.documents.length === 0) {
        win.close();
        toast.warning(t('hiringPack.empty'));
        return;
      }
      writePrintWindow(win, set.html);
      if (set.contract?.created === true) {
        toast.success(t('hiringPack.contractCreated', { code: set.contract.code }));
      }
      if (set.contractNote !== null) toast.warning(t(`hiringPack.note.${set.contractNote}`));
    } catch {
      win.close(); // the error itself is surfaced globally
    }
  };

  return (
    <Can permission="contract.print">
      <Button
        variant={variant}
        size={size}
        loading={pack.isPending}
        data-print-hiring-pack={employeeId}
        onClick={() => void print()}
      >
        {label ?? t('hiringPack.print')}
      </Button>
    </Can>
  );
};
