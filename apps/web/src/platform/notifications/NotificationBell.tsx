// The notification bell — the in-app half of the notifications platform.
//
// Until now this was a placeholder: it rendered a bell, a popover and an empty state, and asked
// the server nothing. Notifications were being created and pushed to phones the whole time; the
// one place a person would look for them inside ECMS was hard-coded to say there were none.
//
// HOW IT STAYS CURRENT. There is no socket client in this app, so the badge polls. That is a
// deliberate trade rather than a stopgap: the count is one indexed `countDocuments`, a minute-old
// badge is not a wrong badge, and the alternative — a Socket.IO client, its auth, its reconnect
// handling — is a dependency this fixes nothing without. The server already emits to `user:<id>`
// when that becomes worth wiring.
//
// The list is NOT polled. It is fetched when the popover opens, because that is the only moment
// anybody is reading it, and refetching a list nobody is looking at is how a quiet app makes a
// request every thirty seconds for ever.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  NOTIFICATIONS_INBOX_PATH,
  notificationTargetPath,
  type Locale,
  type NotificationDto,
} from '@ecms/contracts';
import { useAppSelector } from '../../store';
import { useT } from '../localization/useT';
import { useOnClickOutside } from '../../shared/lib/useOnClickOutside';
import { BellIcon, InboxIcon } from '../../shared/ui/icons';
import { cn } from '../../shared/lib/cn';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
} from './notification-api';

/** How often the badge re-asks. Slow enough to be free, fast enough that nobody waits for it. */
const BADGE_POLL_MS = 60_000;
/** The popover is a peek, not the inbox — "see all" is one click away. */
const PREVIEW_SIZE = 8;

export const NotificationBell = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const signedIn = useAppSelector((state) => state.auth.status === 'signedIn');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setOpen(false), open);

  const badge = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: unreadNotificationCount,
    // Nothing to count for somebody who is not signed in, and asking would 401 on every tick.
    enabled: signedIn,
    refetchInterval: BADGE_POLL_MS,
    refetchOnWindowFocus: true,
  });

  const list = useQuery({
    queryKey: ['notifications', 'preview'],
    queryFn: () => listNotifications({ page: 1, pageSize: PREVIEW_SIZE }),
    enabled: signedIn && open,
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const readOne = useMutation({ mutationFn: markNotificationRead, onSuccess: refresh });
  const readAll = useMutation({ mutationFn: markAllNotificationsRead, onSuccess: refresh });

  // A push tapped on a phone lands on a route; the badge should not keep the old number while the
  // person is looking at the thing it counted.
  useEffect(() => {
    if (open) void badge.refetch();
    // `badge` is intentionally not a dependency: the query object is new on every settle, and
    // depending on it would refetch in a loop.
  }, [open]);

  const unread = badge.data?.count ?? 0;
  const items = list.data?.items ?? [];

  /**
   * Open what the notification is about.
   *
   * The destination comes from the shared contract the PUSH payload also uses, so clicking here
   * and tapping the same notification on a lock screen land on the same screen.
   */
  const openNotification = (notification: NotificationDto): void => {
    setOpen(false);
    if (notification.readAt === null) readOne.mutate(notification.id);
    navigate(notificationTargetPath(notification.entityRef, notification.id));
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        aria-label={t('notifications.title')}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <BellIcon />
        {unread > 0 && (
          <span className="absolute end-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t('notifications.title')}
          className="absolute end-0 mt-2 w-96 max-w-[92vw] origin-top animate-menu-in rounded-lg border border-slate-200 bg-white shadow-elevated dark:border-slate-700 dark:bg-slate-800"
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-700">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {t('notifications.title')}
            </p>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => readAll.mutate()}
                disabled={readAll.isPending}
                className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400"
              >
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>

          {list.isPending ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">{t('common.loading')}</p>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <InboxIcon className="h-8 w-8 text-slate-300 dark:text-slate-600" />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('notifications.empty')}
              </p>
            </div>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-700">
              {items.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => openNotification(notification)}
                    className={cn(
                      'block w-full px-4 py-3 text-start transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50',
                      notification.readAt === null && 'bg-brand-50/60 dark:bg-brand-900/20',
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {/* Unread is a dot rather than bold text: it survives a long title and it
                          does not make the read ones look disabled. */}
                      <span
                        className={cn(
                          'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                          notification.readAt === null ? 'bg-brand-500' : 'bg-transparent',
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                          {notification.title[locale]}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500 dark:text-slate-400">
                          {notification.body[locale]}
                        </span>
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-slate-100 px-4 py-2 text-center dark:border-slate-700">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate(NOTIFICATIONS_INBOX_PATH);
              }}
              className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              {t('notifications.seeAll')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
