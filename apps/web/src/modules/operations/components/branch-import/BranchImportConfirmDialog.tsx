// «تأكيد الاستيراد» (Round 29) — what the import writes, in one go, before it does: the new
// branches, the branches updated (and how many of the codes they write take a suffix), the new
// areas, the English names filled, and the rows left out. The fuel-card comparison's confirmation
// (ReconcileConfirmDialog.tsx): nothing is written until it is confirmed here.
import { type OperationsBranchImportCompareDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Button } from '../../../../shared/ui/Button';
import { cn } from '../../../../shared/lib/cn';
import { NUM } from '../../../fleet/components/FuelCardBoard';
import { suffixedWrites } from '../../lib/branch-import';

const W = 'operations.catalogs.branchImport.';

const Line = ({ label, value, tone }: { label: string; value: number; tone: string }) => (
  <li className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
    <span className="text-sm text-slate-700 dark:text-slate-300">{label}</span>
    <span dir="ltr" className={cn(NUM, 'text-base font-black', tone)}>
      {value}
    </span>
  </li>
);

export const BranchImportConfirmDialog = ({
  result,
  open,
  busy,
  onClose,
  onConfirm,
}: {
  result: OperationsBranchImportCompareDto;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}): JSX.Element => {
  const t = useT();
  const { counts } = result;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(`${W}dialog.title`, { bank: result.bankName })}
      description={t(`${W}dialog.lead`)}
      dismissOnOutsideClick={!busy}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t(`${W}dialog.cancel`)}
          </Button>
          <Button onClick={onConfirm} loading={busy} data-branch-import-confirm-dialog="true">
            {t(busy ? `${W}applying` : `${W}confirm`)}
          </Button>
        </div>
      }
    >
      <ul className="space-y-2" data-branch-import-dialog-lines="true">
        <Line
          label={t(`${W}dialog.new`)}
          value={counts.new}
          tone="text-emerald-600 dark:text-emerald-400"
        />
        <Line
          label={t(`${W}dialog.update`)}
          value={counts.update}
          tone="text-sky-600 dark:text-sky-400"
        />
        <Line
          label={t(`${W}dialog.suffixed`)}
          value={suffixedWrites(result)}
          tone="text-amber-600 dark:text-amber-400"
        />
        <Line
          label={t(`${W}dialog.areas`)}
          value={counts.areasNew}
          tone="text-emerald-600 dark:text-emerald-400"
        />
        <Line
          label={t(`${W}dialog.filled`)}
          value={counts.areasFilled}
          tone="text-slate-700 dark:text-slate-200"
        />
        <Line
          label={t(`${W}dialog.problems`)}
          value={counts.problem}
          tone="text-rose-600 dark:text-rose-400"
        />
      </ul>
      {counts.problem > 0 && (
        <p className="mt-3 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
          {t(`${W}dialog.note`)}
        </p>
      )}
    </Dialog>
  );
};
