// «معاينة المذكرة» — a saved custody memo's paper, seen before it is printed: the licence memo's
// view (a wide dialog, the grey tray, each A4 sheet at 0.8) for a custody memo.
//
// Its header is the memo's name — the one he typed, or «مذكرة <النوع> رقم N» when he typed none —
// and under it what the view is and, for a named memo, which memo it is («مذكرة كاوتش رقم 2»), or
// that it was saved without a name. Over the paper its facts: the kind, its number, how many
// receipts, its period, its total and whether the fund has replenished it. The paper itself is
// his, with the names it was saved with — never the memo's name, number or date.
//
// Used by «المذكرات» (the row's eye) and by «استعاضة العهدة» (each memo's eye).
import { useMemo } from 'react';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Spinner } from '../../../shared/ui/Spinner';
import { PrinterIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../shared/lib/errors';
import { formatMoneyParts } from '../../../shared/lib/format';
import { useCustodyMemo } from '../api/fleet-queries';
import { memoFileName, memoPaperOf, memoSheets, printPaperAfter } from '../lib/custody-papers';
import { useCustodyCount } from '../lib/custody-words';
import { CustodyKindBadge } from './CustodyKinds';
import { PaperTray, usePaperFonts } from './CustodyPaperSheets';
import { NUM } from './FuelCardBoard';
import { Dates, FACT_CHIP, MemoStatus, isUnnamedMemo, memoDisplayName } from './custody-memo-parts';

/** What the print tab says while the paper is on its way, and what a refused tab is called. */
export const usePrintOutcome = (): ((printing: Promise<boolean>) => void) => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (printing) => {
    printing.then(
      (opened) => {
        if (!opened) toast.error(t('fleet.violations.popupBlocked'));
      },
      (failure: unknown) => toast.error(errorMessage(failure, locale)),
    );
  };
};

export const CustodyMemoPaperView = ({
  memoId,
  onClose,
}: {
  memoId: string;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { count } = useCustodyCount();
  const announce = usePrintOutcome();
  const read = useCustodyMemo(memoId);
  const memo = read.data;
  // Drawn again once the paper faces can measure (the maintenance «البيان» shrinks to fit).
  const fonts = usePaperFonts();
  const sheets = useMemo(
    () => (memo === undefined ? [] : memoSheets(memoPaperOf(memo))),
    [memo, fonts],
  );

  const print = (): void => {
    if (memo === undefined) return;
    announce(
      printPaperAfter(
        () => Promise.resolve({ sheets, title: memoFileName(memo) }),
        t('fleet.custody.papers.printing'),
      ),
    );
  };

  const view = t('fleet.custody.papers.viewMemo');
  const { figure, currency } = formatMoneyParts(memo?.total ?? 0, 'EGP', locale);
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      // Its header is its name; a memo saved without one is called by its kind and number.
      title={memo === undefined ? view : memoDisplayName(memo, t)}
      description={
        memo === undefined
          ? ''
          : `${view} — ${
              isUnnamedMemo(memo)
                ? t('fleet.custody.parts.unnamed')
                : memoDisplayName({ ...memo, name: '' }, t)
            }`
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button
            onClick={print}
            disabled={memo === undefined}
            data-memo-view-print={memo?.no ?? ''}
            leftIcon={<PrinterIcon className="me-1.5 h-4 w-4" />}
          >
            {t('fleet.custody.papers.printMemo')}
          </Button>
        </>
      }
    >
      {memo === undefined ? (
        <div className="flex min-h-40 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
          {read.isError ? (
            <span role="alert">{errorMessage(read.error, locale)}</span>
          ) : (
            <Spinner className="h-6 w-6" />
          )}
        </div>
      ) : (
        <div className="space-y-3" data-memo-view={memo.no}>
          <div className="flex flex-wrap items-center gap-2" data-memo-view-facts="true">
            <CustodyKindBadge kind={memo.kind} />
            <span className={FACT_CHIP}>{t('fleet.custody.parts.memoNo', { no: memo.no })}</span>
            <span className={FACT_CHIP}>{count('receipt', memo.receipts)}</span>
            <span className={FACT_CHIP}>
              <Dates from={memo.from} to={memo.to} />
            </span>
            <span className={FACT_CHIP}>
              {t('fleet.custody.memos.columns.total')}{' '}
              <span dir="ltr" className={NUM}>
                {figure}
              </span>
              <span className="text-[11px] font-semibold opacity-80">{currency}</span>
            </span>
            <MemoStatus memo={memo} />
          </div>
          <PaperTray
            sheets={sheets}
            name={`memo-${String(memo.no)}`}
            className="max-h-[calc(70vh-4.5rem)] overflow-auto"
          />
        </div>
      )}
    </Dialog>
  );
};
