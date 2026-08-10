// The account's history, read from the platform timeline — the merged view over the audit and
// activity streams that already exists (`/platform/timeline`, BD-007).
//
// Two behaviours are inherited rather than reimplemented, and both matter here:
//
//   • The endpoint carries no `authorize()`. It degrades to whichever stream the caller may read
//     and refuses only when they can read neither, so this tab is offered exactly when at least one
//     of `auditLog.view` / `activityLog.view` is held, and the response's `included` says which
//     answered. The screen prints that rather than implying it is showing everything.
//   • Actors are ACTOR SNAPSHOTS taken when the event happened, not joins at read time. `ActorLink`
//     renders them, so a renamed or deleted account still shows the name that was true then.
//
// The tab opens on the newest page and walks BACKWARDS on demand: each press appends the next page
// beneath what is already on screen, so the reader never loses their place. It is deliberately not
// a page control — a trail is read by scrolling back until you find the event you came for, not by
// choosing a page number — and it is deliberately not the Audit screen, which is where filtering
// across every entity belongs.
//
// A failed load says so and offers a retry. The one thing it must never do is render the empty
// state: "this account has no history" and "we could not read this account's history" are opposite
// claims, and the second one dressed as the first would end an investigation before it started.
import { type Locale, type TimelineEntryDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { useCan } from '../../../../platform/rbac/Can';
import { ActorLink } from '../../../../platform/directory';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  Timeline,
  type TimelineEntry,
  type Tone,
} from '../../../../shared/ui';
import { formatDateTime } from '../../../../shared/lib/format';
import { timelinePanel } from '../lib/timeline-view';
import { TIMELINE_PAGE_SIZE, useUserTimeline } from '../api/user-queries';

/**
 * The audited acts an account actually receives, in the reader's language. Anything outside this
 * set renders its raw action code instead of a translation key — a trail that shows
 * `systemAdmin.users.audit.somethingNew` would look broken, while the code at least names the act.
 */
const TRANSLATED_ACTIONS = new Set([
  'create',
  'update',
  'delete',
  'statusChange',
  'usernameChanged',
  'passwordChanged',
  'passwordReset',
  'totpEnrolled',
  'totpDisabled',
  'totpReset',
  'totpRequiredChanged',
  'sessionRevoked',
  'roleAssigned',
  'roleRevoked',
  // Moving a grant's validity window — neither a new grant nor a revocation (SA-3).
  'roleAssignmentUpdated',
  'accountAutoCreated',
  'credentialsDelivered',
  'firstLogin',
  'invitationCreated',
  'invitationResent',
  'invitationUsed',
  'invitationExpired',
  'invitationRevoked',
  'invitationAttemptInvalid',
  'permissionDenied',
  'login',
  'loginFailed',
  'logout',
  'lockout',
]);

const ACTION_TONE: Record<string, Tone> = {
  create: 'success',
  firstLogin: 'success',
  invitationUsed: 'success',
  delete: 'danger',
  loginFailed: 'danger',
  invitationAttemptInvalid: 'danger',
  lockout: 'warning',
  statusChange: 'warning',
  permissionDenied: 'warning',
  sessionRevoked: 'warning',
  passwordReset: 'warning',
  totpReset: 'warning',
  invitationRevoked: 'warning',
  invitationExpired: 'warning',
};

/** `status: active → suspended` — the field-level diff, in one readable line. */
const describeChanges = (entry: TimelineEntryDto): string | undefined => {
  const changes = entry.changes ?? [];
  if (changes.length === 0) return undefined;
  return changes
    .map((c) => `${c.field}: ${String(c.old ?? '—')} → ${String(c.new ?? '—')}`)
    .join(' · ');
};

export const UserActivityTab = ({ userId }: { userId: string }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const can = useCan();

  const mayRead = can('auditLog.view') || can('activityLog.view');
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useUserTimeline(userId, mayRead);

  if (!mayRead) {
    return (
      <Card>
        <CardHeader title={t('systemAdmin.users.activity.title')} />
        <CardBody>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('systemAdmin.users.activity.noAccess')}
          </p>
        </CardBody>
      </Card>
    );
  }

  // Every page fetched so far, oldest page last — the order the server already sorted them in.
  const items = (data?.pages ?? []).flatMap((p) => p.items);

  const entries: TimelineEntry[] = items.map((item, index) => {
    const action = item.action ?? '';
    const title =
      item.source === 'audit'
        ? TRANSLATED_ACTIONS.has(action)
          ? t(`systemAdmin.users.audit.${action}`)
          : action
        : t(item.messageKey ?? '');
    const description = describeChanges(item);
    return {
      id: `${item.source}-${item.id}-${index}`,
      title,
      meta: formatDateTime(item.at, locale),
      ...(description === undefined ? {} : { description }),
      tone: item.source === 'audit' ? (ACTION_TONE[action] ?? 'brand') : 'neutral',
      actor: <ActorLink actor={item.actor} />,
    };
  });

  // `included` is a property of the caller's permissions, identical on every page — the first page
  // that answered is as good as any, and there is no first page while the very first load fails.
  const included = data?.pages[0]?.included ?? [];
  const separator = locale === 'ar' ? '، ' : ', ';
  const panel = timelinePanel({ isLoading, isError, loaded: entries.length });

  return (
    <Card>
      <CardHeader
        title={t('systemAdmin.users.activity.title')}
        description={t('systemAdmin.users.activity.hint', { count: TIMELINE_PAGE_SIZE })}
      />
      <CardBody>
        {panel === 'loading' ? (
          <LoadingState />
        ) : panel === 'error' ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : panel === 'empty' ? (
          <EmptyState title={t('systemAdmin.users.activity.empty')} />
        ) : (
          <>
            <Timeline entries={entries} />

            {/* A page that failed AFTER some history is on screen must not wipe what is there —
                the panel keeps the entries and reports the failure under them. */}
            {isError && (
              <p className="mt-4 text-xs text-red-600 dark:text-red-400">
                {t('systemAdmin.users.activity.loadMoreFailed')}
              </p>
            )}

            {hasNextPage && (
              <div className="mt-4">
                <Button
                  size="sm"
                  variant="ghost"
                  loading={isFetchingNextPage}
                  onClick={() => void fetchNextPage()}
                >
                  {t('systemAdmin.users.activity.loadOlder')}
                </Button>
              </div>
            )}

            <p className="mt-6 text-xs text-slate-400 dark:text-slate-500">
              {t('systemAdmin.users.activity.included', {
                streams: included
                  .map((source) => t(`systemAdmin.users.activity.stream.${source}`))
                  .join(separator),
              })}
              {!hasNextPage && ` · ${t('systemAdmin.users.activity.allLoaded')}`}
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
};
