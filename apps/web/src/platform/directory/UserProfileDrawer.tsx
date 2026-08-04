// The identity card behind every user name in the system. ONE component, platform-level: timeline,
// activity log, audit log, comments, assignments, and anything added later use this and nothing
// else. A module-local copy would drift from it within a release.
//
// It opens on what the caller already knows and fills in the rest. Waiting on the network before
// showing anything would make clicking a name feel like navigation, which it is not.
import { type ActorSnapshotDto } from '@ecms/contracts';
import { useT } from '../localization/useT';
import { useAppSelector } from '../../store';
import { Dialog } from '../../shared/ui/Dialog';
import { Skeleton } from '../../shared/ui/Skeleton';
import { AlertIcon } from '../../shared/ui/icons';
import { useDirectoryProfile } from './directory-queries';

const Row = ({ label, value }: { label: string; value: string | null }): JSX.Element | null =>
  value === null || value === '' ? null : (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-end font-medium text-slate-800 dark:text-slate-100">{value}</dd>
    </div>
  );

export const UserProfileDrawer = ({
  actor,
  open,
  onClose,
}: {
  /** What the calling row already knows — the card opens on this, immediately. */
  actor: ActorSnapshotDto;
  open: boolean;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const { data, isLoading, isError } = useDirectoryProfile(actor.userId, open);

  // The historical name always wins: it is what this person was called when they acted.
  const name = actor.displayName[locale];
  // `data === null` is the directory answering "no such account" — the same outcome as a 404, and
  // only ever set once the query has resolved. The card still shows the historical name above.
  const gone = actor.deletedAt !== null || isError || data === null;

  return (
    <Dialog open={open} onClose={onClose} title={t('directory.title')}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-200 text-lg font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-200">
            {name.trim().charAt(0)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-medium text-slate-900 dark:text-slate-50">{name}</p>
            {actor.jobTitle !== null && (
              <p className="truncate text-sm text-slate-500 dark:text-slate-400">
                {actor.jobTitle[locale]}
              </p>
            )}
          </div>
        </div>

        {gone ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t('directory.unavailable')}</span>
          </div>
        ) : isLoading && data === undefined ? (
          // Only the fields the row could not carry are skeletoned — the name is already up there.
          <div className="space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-5 w-3/5" />
          </div>
        ) : (
          <dl className="divide-y divide-slate-100 dark:divide-slate-800">
            <Row label={t('directory.jobTitle')} value={data?.jobTitle?.[locale] ?? actor.jobTitle?.[locale] ?? null} />
            <Row label={t('directory.department')} value={data?.department?.[locale] ?? null} />
            <Row label={t('directory.branch')} value={data?.branch?.[locale] ?? null} />
            <Row label={t('directory.email')} value={data?.workEmail ?? null} />
            <Row
              label={t('directory.status')}
              value={data == null ? null : t(data.active ? 'directory.active' : 'directory.inactive')}
            />
          </dl>
        )}
      </div>
    </Dialog>
  );
};
