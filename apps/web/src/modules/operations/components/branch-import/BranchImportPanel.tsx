// «استيراد فروع من شيت» (Round 29) — on «البيانات المرجعية» → «الفروع», opened by the button beside
// «إضافة فرع»: «وعاوز جمب اضافة فرع فوق يقدر يضيف شيت ويقارن زى بتاع كروت الشحن كدا».
//
//   1. «اختر البنك» and «ارفع شيت الفروع» → «مقارنة بالفروع» posts the file; nothing is written.
//   2. The comparison: what every row comes to, the areas «المناطق» gains, filters and a search.
//   3. «تأكيد الاستيراد» → the confirmation → the SAME file posted again with the comparison's
//      hashes; the server writes it all in one go, or nothing when the bank, the areas or the file
//      moved since the comparison (then «مقارنة من جديد» compares the same file again).
//   After the import the branches list is read again and shown.
//
// State only: the rules are `lib/branch-import.ts`, the pieces beside this file.
import { useState } from 'react';
import { type OperationsBankDto, type OperationsBranchImportCompareDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { errorMessage } from '../../../../shared/lib/errors';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { cn } from '../../../../shared/lib/cn';
import { BOARD_FONT } from '../../../fleet/components/FuelCardBoard';
import { useApplyBranchImport, useCompareBranchImport } from '../../api/branch-import';
import { importedToast, isOutOfDate, refusalKeyOf } from '../../lib/branch-import';
import { BranchImportConfirmDialog } from './BranchImportConfirmDialog';
import { BranchImportResult } from './BranchImportResult';
import { BranchImportUpload } from './BranchImportUpload';


export const BranchImportPanel = ({
  banks,
  onClose,
}: {
  /** The ACTIVE banks. */
  banks: readonly OperationsBankDto[];
  /** Back to the branches list — after an import too. */
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const [bankId, setBankId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<OperationsBranchImportCompareDto | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [outOfDate, setOutOfDate] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const compare = useCompareBranchImport();
  const apply = useApplyBranchImport();

  const wordsOf = (error: unknown): string => {
    const key = refusalKeyOf(error);
    return key === null ? errorMessage(error, locale) : t(key);
  };

  const runCompare = (): void => {
    if (bankId === '' || file === null) return;
    setRefusal(null);
    setOutOfDate(false);
    compare.mutate(
      { bankId, file },
      {
        onSuccess: (dto) => setResult(dto),
        onError: (error) => {
          setResult(null);
          setRefusal(wordsOf(error));
        },
      },
    );
  };

  const runApply = (): void => {
    if (result === null || file === null) return;
    apply.mutate(
      { bankId: result.bankId, file, fileSha256: result.fileSha256, planDigest: result.planDigest },
      {
        onSuccess: (applied) => {
          setConfirming(false);
          const words = importedToast(t, applied);
          toast.success(words.title, words.description);
          onClose();
        },
        onError: (error) => {
          setConfirming(false);
          setOutOfDate(isOutOfDate(error));
          setRefusal(wordsOf(error));
        },
      },
    );
  };

  const another = (): void => {
    setResult(null);
    setFile(null);
    setRefusal(null);
    setOutOfDate(false);
  };

  return (
    <div
      className={cn(BOARD_FONT, 'space-y-4 text-slate-900 antialiased dark:text-slate-100')}
      data-branch-import="true"
    >
      {result === null ? (
        <>
          <BranchImportUpload
            banks={banks}
            bankId={bankId}
            file={file}
            reading={compare.isPending}
            onBank={setBankId}
            onFile={(next) => {
              setFile(next);
              setRefusal(null);
            }}
            onCompare={runCompare}
            onBack={onClose}
          />
          {refusal !== null && (
            <p
              role="alert"
              data-branch-import-read-refusal="true"
              className="rounded-xl border border-red-500/40 bg-red-50 px-4 py-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-200"
            >
              {refusal}
            </p>
          )}
        </>
      ) : (
        <>
          <BranchImportResult
            result={result}
            outOfDate={outOfDate}
            refusal={refusal}
            busy={apply.isPending || compare.isPending}
            onAnother={another}
            onCompareAgain={runCompare}
            onConfirm={() => setConfirming(true)}
          />
          <BranchImportConfirmDialog
            result={result}
            open={confirming}
            busy={apply.isPending}
            onClose={() => setConfirming(false)}
            onConfirm={runApply}
          />
        </>
      )}
    </div>
  );
};
