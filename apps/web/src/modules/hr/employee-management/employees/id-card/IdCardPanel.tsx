// The card itself, ready to print: the preview, what is missing from it, the print button — and the
// handover. Used by the list's dialog and by the profile's «الكارنيه» tab, so both work the same.
//
// PRINTING IS NOT RECEIVING. Printing only makes paper (a reprint, a jammed printer, a second press
// of the button), so it never counts as a card. Once printed, the card waits for its handover:
// (1) print the receipt (إقرار الاستلام), (2) the employee signs it and takes the card, (3) HR
// confirms here — and only that confirmation counts the card, once.
import { useState } from 'react';
import { type EmployeeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Button } from '../../../../../shared/ui/Button';
import { CheckIcon, FileIcon, PrinterIcon } from '../../../../../shared/ui/icons';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { cn } from '../../../../../shared/lib/cn';
import { errorMessage } from '../../../../../shared/lib/errors';
import { formatDate } from '../../../../../shared/lib/format';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { useEmployeePhotoUrl } from '../api/employee-photo';
import {
  useConfirmIdCardHandover,
  useEmployeeIdCard,
  useRecordIdCardPrint,
  useRecordIdCardReceipt,
} from '../api/employee-id-card';
import { useEmployee } from '../api/employee-queries';
import { PhotoDialog } from '../components/EmployeePhoto';
import { IdCardPreview, faceOf, useIdCardCanvases } from './IdCardPreview';
import { printCardPages, printHtml } from './print-card';
import { RECEIPT_STYLE, receiptHtml } from './card-receipt';

/** One numbered step of the handover: done, current, or still ahead. */
const Step = ({
  n,
  state,
  title,
  children,
}: {
  n: number;
  state: 'done' | 'current' | 'ahead';
  title: string;
  children?: React.ReactNode;
}): JSX.Element => (
  <li className="flex flex-wrap items-center justify-between gap-2">
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          'grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold',
          state === 'done' && 'bg-emerald-500 text-white',
          state === 'current' && 'bg-brand-600 text-white ring-4 ring-brand-500/20',
          state === 'ahead' && 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300',
        )}
      >
        {state === 'done' ? <CheckIcon className="h-4 w-4" /> : n}
      </span>
      <span
        className={cn(
          'text-sm',
          state === 'ahead' ? 'text-slate-500 dark:text-slate-400' : 'font-medium',
        )}
      >
        {title}
      </span>
    </div>
    {children}
  </li>
);

export const IdCardPanel = ({
  employee,
  onPrinted,
}: {
  employee: EmployeeDto;
  onPrinted?: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // The live file, not the row the dialog was opened with: a photo added from here is on the card
  // at once (the upload writes this cache), instead of the snapshot that still says «no photo».
  const live = useEmployee(employee.id);
  const current = live.data ?? employee;
  const card = useEmployeeIdCard(employee.id, true);
  const photo = useEmployeePhotoUrl(employee.id, current.personal.photoFileId);
  const record = useRecordIdCardPrint(employee.id);
  const confirm = useConfirmIdCardHandover(employee.id);
  const recordReceipt = useRecordIdCardReceipt(employee.id);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [asking, setAsking] = useState(false);
  const { canvases, frontUrl, backUrl, ready } = useIdCardCanvases(
    faceOf(card.data, locale),
    photo.url,
  );

  if (card.isLoading) return <LoadingState />;
  if (card.isError) return <ErrorState error={card.error} onRetry={() => void card.refetch()} />;

  const summary = current.idCard ?? card.data?.summary;
  const received = summary?.receivedCount ?? 0;
  const awaiting = summary?.awaitingHandover === true;
  // Kept on the server: closing the card and opening it again keeps the receipt step done.
  const receiptAt = awaiting ? (summary?.receiptPrintedAt ?? null) : null;
  const receiptDone = receiptAt !== null;
  // The card the paper is for: the one waiting to be handed over, or — reprinting a receipt — the last.
  const copyNumber = awaiting ? received + 1 : Math.max(received, 1);
  const missingPhoto = current.personal.photoFileId === null;
  // A photo on file that has not been drawn yet must not print a card without it.
  const photoPending = !missingPhoto && photo.url === null;
  const missingNationalId = (card.data?.nationalId ?? '') === '';

  const print = async (): Promise<void> => {
    setPrinting(true);
    try {
      // Recorded first: every print is on file, even the ones that never become a card.
      await record.mutateAsync();
      // The front only, one card-sized page: the same as the current system's PDF.
      await printCardPages([canvases.front]);
      toast.success(t('employees.idCard.printed'));
      setAsking(false);
      onPrinted?.();
    } catch (error) {
      toast.error(errorMessage(error, locale));
    } finally {
      setPrinting(false);
    }
  };

  // «إقرار استلام»: for the card waiting to be handed over, or — reopened later — for the last one.
  const printReceipt = async (): Promise<void> => {
    try {
      // Recorded first, for the card waiting to be handed over: the employee's turn starts here.
      if (awaiting) await recordReceipt.mutateAsync();
      await printHtml(
        receiptHtml({
          name: card.data?.fullNameAr ?? current.personal.fullNameAr,
          code: card.data?.code ?? current.code,
          employeeNumber: card.data?.employeeNumber ?? '',
          nationalId: card.data?.nationalId ?? '',
          jobTitle: card.data?.jobTitle?.ar ?? '',
          branch: current.placement.branch?.name.ar ?? '',
          department: current.placement.department?.name.ar ?? '',
          copyNumber,
          issuedAt: new Date(),
          cardImage: frontUrl,
        }),
        RECEIPT_STYLE,
        'rtl',
      );
    } catch (error) {
      toast.error(errorMessage(error, locale));
    }
  };

  const confirmHandover = (): void => {
    confirm.mutate(undefined, {
      onSuccess: (s) => {
        toast.success(t('employees.idCard.handover.confirmed', { n: s.receivedCount }));
        setAsking(false);
      },
      onError: (error) => toast.error(errorMessage(error, locale)),
    });
  };

  return (
    <div className="space-y-4">
      <IdCardPreview frontUrl={frontUrl} backUrl={backUrl} />

      <p className="text-center text-xs text-slate-500 dark:text-slate-400">
        {received === 0
          ? t('employees.idCard.neverReceived')
          : t('employees.idCard.receivedSummary', {
              count: received,
              date: formatDate(summary?.lastReceivedAt ?? null, locale),
            })}
      </p>

      {(missingPhoto || missingNationalId) && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {missingPhoto && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{t('employees.idCard.noPhoto')}</span>
              <Button size="sm" variant="secondary" onClick={() => setPhotoOpen(true)}>
                {t('employees.idCard.addPhoto')}
              </Button>
            </div>
          )}
          {missingNationalId && <p>{t('employees.idCard.noNationalId')}</p>}
        </div>
      )}

      {awaiting && (
        <div
          role="status"
          className={cn(
            'rounded-xl border bg-gradient-to-l to-white px-4 py-3 text-slate-800 shadow-sm ring-2 dark:to-slate-900 dark:text-slate-100',
            // HR's turn (print the receipt): amber. The employee's turn (sign and take it): sky.
            receiptDone
              ? 'border-sky-300 from-sky-50 ring-sky-400/20 dark:border-sky-800 dark:from-sky-950/50'
              : 'border-amber-300 from-amber-50 ring-amber-400/20 dark:border-amber-800 dark:from-amber-950/50',
          )}
        >
          <p
            className={cn(
              'font-semibold',
              receiptDone ? 'text-sky-800 dark:text-sky-200' : 'text-amber-800 dark:text-amber-200',
            )}
          >
            {t(
              receiptDone
                ? 'employees.idCard.handover.titleWaiting'
                : 'employees.idCard.handover.title',
              { n: copyNumber },
            )}
          </p>
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            {t('employees.idCard.handover.hint')}
          </p>
          <ol className="space-y-3">
            <Step n={1} state="done" title={t('employees.idCard.handover.step1')} />
            <Step
              n={2}
              state={receiptDone ? 'done' : 'current'}
              title={t('employees.idCard.handover.step2')}
            >
              <Button
                size="sm"
                variant={receiptDone ? 'secondary' : 'primary'}
                leftIcon={<FileIcon className="h-4 w-4" />}
                disabled={!ready}
                loading={recordReceipt.isPending}
                onClick={() => void printReceipt()}
              >
                {t(
                  receiptDone ? 'employees.idCard.receipt.again' : 'employees.idCard.receipt.print',
                )}
              </Button>
            </Step>
            <Step
              n={3}
              state={receiptDone ? 'current' : 'ahead'}
              title={t('employees.idCard.handover.step3')}
            >
              {!asking && (
                <Button
                  size="sm"
                  variant={receiptDone ? 'primary' : 'secondary'}
                  leftIcon={<CheckIcon className="h-4 w-4" />}
                  onClick={() => setAsking(true)}
                >
                  {t('employees.idCard.handover.confirm')}
                </Button>
              )}
            </Step>
          </ol>
          {asking && (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
              <p>
                {t('employees.idCard.handover.question', {
                  name: current.personal.fullNameAr,
                  n: copyNumber,
                })}
              </p>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setAsking(false)}
                  disabled={confirm.isPending}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  size="sm"
                  leftIcon={<CheckIcon className="h-4 w-4" />}
                  loading={confirm.isPending}
                  onClick={confirmHandover}
                >
                  {t('employees.idCard.handover.yes')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {receiptDone && (
        <p className="-mt-2 flex items-center justify-center gap-2 text-center text-sm font-medium text-sky-700 dark:text-sky-300">
          <span className="relative flex h-2.5 w-2.5" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-500" />
          </span>
          {t('employees.idCard.waitingEmployeeSince', { date: formatDate(receiptAt, locale) })}
        </p>
      )}

      <div className="flex flex-wrap justify-center gap-2">
        <Button
          variant={awaiting ? 'secondary' : 'primary'}
          leftIcon={<PrinterIcon className="h-4 w-4" />}
          disabled={!ready || photoPending}
          loading={printing}
          onClick={() => void print()}
        >
          {t(
            awaiting
              ? 'employees.idCard.reprint'
              : received === 0
                ? 'employees.idCard.print'
                : 'employees.idCard.printNew',
          )}
        </Button>
        {received > 0 && !awaiting && (
          <Button
            variant="secondary"
            leftIcon={<FileIcon className="h-4 w-4" />}
            disabled={!ready}
            onClick={() => void printReceipt()}
          >
            {t('employees.idCard.receipt.print')}
          </Button>
        )}
      </div>

      <PhotoDialog
        employee={current}
        currentUrl={photo.url}
        open={photoOpen}
        onClose={() => setPhotoOpen(false)}
      />
    </div>
  );
};
