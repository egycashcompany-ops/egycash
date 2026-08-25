// The inbox — every notification this person was sent, readable as itself.
//
// It exists because a notification has to have somewhere to BE. An announcement or a rule's
// message has no record behind it to open: the text is the whole content, and until this page
// there was nowhere in ECMS to read it. That is what made a push land on the home screen with no
// trace of the thing that buzzed.
//
// `?focus=<id>` is how a push arrives here. The notification it names is scrolled to and outlined
// rather than filtered to — the surrounding ones are context a person usually wants, and a list of
// exactly one row looks like the rest went missing.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Locale, type NotificationDto } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../localization/useT';
import { PageContainer, PageHeader } from '../../layout/PageContainer';
import { Button, Card, CardBody, EmptyState, LoadingState, Pagination } from '../../../shared/ui';
import { cn } from '../../../shared/lib/cn';
import { formatDateTime } from '../../../shared/lib/format';
import {
  archiveNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../notification-api';

const PAGE_SIZE = 20;

export const NotificationsInboxPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const focusId = params.get('focus');
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const focusRef = useRef<HTMLLIElement>(null);

  const inbox = useQuery({
    queryKey: ['notifications', 'inbox', page, unreadOnly],
    queryFn: () => listNotifications({ page, pageSize: PAGE_SIZE, unreadOnly }),
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };
  const readOne = useMutation({ mutationFn: markNotificationRead, onSuccess: refresh });
  const readAll = useMutation({ mutationFn: markAllNotificationsRead, onSuccess: refresh });
  const archive = useMutation({ mutationFn: archiveNotification, onSuccess: refresh });

  const items = useMemo(() => inbox.data?.items ?? [], [inbox.data]);
  const focused = items.find((item) => item.id === focusId) ?? null;

  // Scroll to the one a push named, and mark it read — arriving from the notification IS reading
  // it, and leaving it bold afterwards makes the badge lie about what is still waiting.
  const markRead = readOne.mutate;
  useEffect(() => {
    if (focused === null) return;
    focusRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (focused.readAt === null) markRead(focused.id);
    // Keyed on the id alone: re-running when the row object changes identity after the mutation
    // settles would mark it read a second time.
  }, [focused?.id]);

  const meta = inbox.data?.meta;

  const row = (notification: NotificationDto): JSX.Element => {
    const isFocused = notification.id === focusId;
    return (
      <li
        key={notification.id}
        ref={isFocused ? focusRef : undefined}
        className={cn(
          'rounded-lg border p-4 transition-colors',
          isFocused
            ? 'border-brand-400 bg-brand-50/60 dark:border-brand-500 dark:bg-brand-900/20'
            : notification.readAt === null
              ? 'border-slate-200 bg-brand-50/30 dark:border-slate-700 dark:bg-brand-900/10'
              : 'border-slate-200 dark:border-slate-700',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              {notification.title[locale]}
            </p>
            {/* `whitespace-pre-line`, because a human wrote this and their line breaks are meaning. */}
            <p className="mt-1 whitespace-pre-line text-sm text-slate-600 dark:text-slate-300">
              {notification.body[locale]}
            </p>
            <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
              {formatDateTime(notification.createdAt, locale)}
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-1.5">
            {notification.readAt === null && (
              <button
                type="button"
                onClick={() => readOne.mutate(notification.id)}
                className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
              >
                {t('notifications.markRead')}
              </button>
            )}
            <button
              type="button"
              onClick={() => archive.mutate(notification.id)}
              className="text-xs font-medium text-slate-400 hover:text-slate-600 hover:underline dark:hover:text-slate-300"
            >
              {t('notifications.archive')}
            </button>
          </div>
        </div>
      </li>
    );
  };

  return (
    <PageContainer>
      {/* No description line: "everything the system has sent you" is what the page evidently is,
          and on a phone it cost a row of height above the only thing anybody came here to read.
          `actions` puts the button on the title's own row for the same reason. */}
      <PageHeader
        title={t('notifications.inbox.title')}
        actions={
          <Button variant="secondary" onClick={() => readAll.mutate()} loading={readAll.isPending}>
            {t('notifications.markAllRead')}
          </Button>
        }
      />

      <Card>
        <CardBody>
          <div className="mb-4 flex items-center gap-2">
            {([false, true] as const).map((value) => (
              <button
                key={String(value)}
                type="button"
                onClick={() => {
                  setUnreadOnly(value);
                  setPage(1);
                }}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  unreadOnly === value
                    ? 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200'
                    : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
              >
                {t(value ? 'notifications.filter.unread' : 'notifications.filter.all')}
              </button>
            ))}
          </div>

          {inbox.isPending ? (
            <LoadingState />
          ) : items.length === 0 ? (
            <EmptyState
              title={t('notifications.empty')}
              description={t('notifications.inbox.emptyBody')}
            />
          ) : (
            <>
              <ul className="space-y-3">{items.map(row)}</ul>
              {meta !== undefined && meta.totalPages > 1 && (
                <div className="mt-4">
                  <Pagination meta={meta} onPageChange={setPage} />
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>
    </PageContainer>
  );
};

export default NotificationsInboxPage;
