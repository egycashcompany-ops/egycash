// The employee's National-ID card — front and back — as it was scanned when they applied, so HR can
// open it from the profile for as long as the person works here. The images are carried over from
// the applicant file at hire (or on the first look, for someone hired before that); each opens
// through a short-lived signed link and can be saved, like the review popup's downloads.
import { useQuery } from '@tanstack/react-query';
import { type FileDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { DownloadIcon, ImageIcon } from '../../../../../shared/ui/icons';
import { fileDownloadTicket } from '../api/employee-api';
import { useEmployeeNationalIdCard } from '../api/employee-queries';

/** Saves the file under a readable name; opens it in a new tab if the bytes cannot be fetched. */
const save = async (file: FileDto, name: string, failed: string): Promise<void> => {
  try {
    const { url } = await fileDownloadTicket(file.id);
    try {
      const blob = await (await fetch(url)).blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  } catch {
    toast.error(failed);
  }
};

const Side = ({
  file,
  label,
  name,
}: {
  file: FileDto;
  label: string;
  name: string;
}): JSX.Element => {
  const t = useT();
  // A fresh signed link for the preview; it is short-lived, so it is fetched when shown.
  const { data: ticket } = useQuery({
    queryKey: ['platform', 'files', 'ticket', file.id],
    queryFn: () => fileDownloadTicket(file.id),
    staleTime: 60_000,
    enabled: file.mime.startsWith('image/'),
  });
  return (
    <figure className="space-y-2">
      <div className="relative flex aspect-[1.586] items-center justify-center overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700">
        {ticket !== undefined ? (
          <img src={ticket.url} alt={label} className="h-full w-full object-contain" />
        ) : (
          <ImageIcon className="h-6 w-6 text-slate-500" />
        )}
      </div>
      <figcaption className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</span>
        <button
          type="button"
          onClick={() => void save(file, name, t('employees.nationalIdCard.downloadFailed'))}
          className="inline-flex min-h-[36px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-brand-700 dark:hover:bg-brand-950/40 dark:hover:text-brand-200"
        >
          <DownloadIcon className="h-4 w-4" />
          {t('employees.nationalIdCard.download')}
        </button>
      </figcaption>
    </figure>
  );
};

export const EmployeeNationalIdCard = ({
  employeeId,
  employeeCode,
}: {
  employeeId: string;
  /** Names the saved files, e.g. `001000125-national-id-front.jpg`. */
  employeeCode: string;
}): JSX.Element => {
  const t = useT();
  const {
    data: files = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useEmployeeNationalIdCard(employeeId);
  // Filed oldest first at hire (front, then back); the list comes back newest first.
  const sides = [...files].reverse();
  const stem = `${employeeCode}-national-id`;
  const sideLabel = (i: number): string =>
    sides.length === 2
      ? t(i === 0 ? 'employees.nationalIdCard.front' : 'employees.nationalIdCard.back')
      : t('employees.nationalIdCard.image', { n: i + 1 });

  return (
    <Card>
      <CardHeader
        title={t('employees.nationalIdCard.title')}
        description={t('employees.nationalIdCard.subtitle')}
      />
      <CardBody>
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : sides.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <ImageIcon className="h-4 w-4" />
            {t('employees.nationalIdCard.none')}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {sides.map((file, i) => (
              <Side
                key={file.id}
                file={file}
                label={sideLabel(i)}
                name={`${stem}-${sides.length === 2 ? (i === 0 ? 'front' : 'back') : i + 1}.${file.extension.replace(/^\./, '') || 'jpg'}`}
              />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
};
