// «صلاحياتي» — what this account may do, read by the person who holds it.
//
// It is NOT the permission registry with a filter on it. That screen (`/system/permissions`) exists
// to let an administrator look up what a key means before granting it, so it prints all 349 of them
// and marks the few the reader happens to hold. This one answers a different question, asked by
// somebody who will never open that screen: «ما الذي يُسمح لي به؟» — and the honest answer to that
// is a short list, so the list is all there is.
//
// Three consequences follow, and they are the whole design:
//   • GROUPED BY SCREEN, not by module id. A person knows «الإجازات» and «طلبات الصيانة»; nobody
//     outside this codebase knows what `hr` or `itMaintenance` is. The screen name is the heading
//     and the permissions under it read as the sentence «في هذه الشاشة أستطيع: الاطلاع، التقديم».
//   • THE REACH IS SPELLED OUT. «الاطلاع على الإجازات» is not an answer on its own — whose leave?
//     Every row says «على إدارتي» or «على بياناتي وحدها», because the difference between those two
//     is the difference between a manager and a clerk.
//   • THE SOURCE IS NAMED. «من دور: مدير الحركة» tells the holder why he has it and, when it is
//     wrong, what to ask about. No id, no button: there is nothing on this screen to change.
//
// An account holding nothing reaches this page only by typing the URL — the menu entry is not
// drawn for it — and is told so plainly rather than shown an empty frame.
import { useMemo } from 'react';
import { type DataScope, type Locale, type MyPermissionDto, type PageDto } from '@ecms/contracts';
import { useT } from '../localization/useT';
import { useAppSelector } from '../../store';
import { PageContainer, PageHeader } from '../layout/PageContainer';
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, LoadingState } from '../../shared/ui';
import { formatDateTime } from '../../shared/lib/format';
import { useMyPermissions } from './my-permissions-queries';

/** One heading and the permissions filed under it. `page` is null for the catch-all group. */
interface Group {
  key: string;
  page: PageDto | null;
  moduleId: string | null;
  rows: MyPermissionDto[];
}

/**
 * Screens first, in the registry's own order, then whatever no screen claims — grouped by module so
 * the tail is still readable, and last so it never displaces a real screen.
 */
export const groupByScreen = (rows: MyPermissionDto[], pages: PageDto[]): Group[] => {
  const byPage = new Map<string, MyPermissionDto[]>();
  const loose = new Map<string, MyPermissionDto[]>();
  for (const row of rows) {
    const bucket = row.pageId === null ? loose : byPage;
    const key = row.pageId ?? (row.moduleId ?? '');
    bucket.set(key, [...(bucket.get(key) ?? []), row]);
  }
  const screens: Group[] = pages
    .filter((page) => (byPage.get(page.id) ?? []).length > 0)
    .map((page) => ({
      key: `page:${page.id}`,
      page,
      moduleId: page.moduleId,
      rows: byPage.get(page.id) ?? [],
    }));
  const rest: Group[] = [...loose.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([moduleId, group]) => ({
      key: `module:${moduleId}`,
      page: null,
      moduleId: moduleId === '' ? null : moduleId,
      rows: group,
    }));
  return [...screens, ...rest];
};

/** The reach, as a sentence rather than a noun — «على إدارتي», not «إدارة». */
const scopeLabel = (t: ReturnType<typeof useT>, scope: DataScope): string => {
  // Five literal calls rather than one assembled key: the i18n guardrail scans the source for
  // `t('…')` and a key built inside the call is invisible to it.
  if (scope === 'own') return t('account.permissions.scope.own');
  if (scope === 'section') return t('account.permissions.scope.section');
  if (scope === 'department') return t('account.permissions.scope.department');
  if (scope === 'branch') return t('account.permissions.scope.branch');
  return t('account.permissions.scope.organization');
};

export const MyPermissionsPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data, isLoading, isError, error, refetch } = useMyPermissions();

  const groups = useMemo(
    () => groupByScreen(data?.rows ?? [], data?.pages ?? []),
    [data?.rows, data?.pages],
  );

  return (
    <PageContainer>
      <PageHeader
        title={t('account.permissions.title')}
        aside={
          data === undefined ? undefined : (
            <Badge size="sm" tone="neutral">
              {t('account.permissions.count', { count: data.rows.length })}
            </Badge>
          )
        }
      />

      <div className="space-y-4">
        {isLoading && <LoadingState />}
        {isError && <ErrorState error={error} onRetry={() => void refetch()} />}

        {/* The account that holds nothing. It arrived here by URL, since the menu draws no entry
            for it — so the page says what is true and what to do about it, rather than showing an
            empty frame that reads as a loading failure. */}
        {!isLoading && !isError && groups.length === 0 && (
          <EmptyState
            title={t('account.permissions.empty')}
            description={t('account.permissions.emptyHint')}
          />
        )}

        {groups.map((group) => (
          <Card key={group.key}>
            <CardHeader
              title={
                group.page === null
                  ? t('account.permissions.otherScreens')
                  : group.page.name[locale]
              }
              description={t('account.permissions.inThisScreen', { count: group.rows.length })}
            />
            <CardBody>
              <ul className="space-y-2">
                {group.rows.map((row) => (
                  <li
                    key={row.key}
                    className="min-w-0 rounded-md border border-slate-200 p-3 dark:border-slate-800"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                        {row.name === null ? row.key : row.name[locale]}
                      </span>
                      <Badge size="sm" tone="success">
                        {scopeLabel(t, row.scope)}
                      </Badge>
                      {row.breakGlass && (
                        <Badge size="sm" tone="danger">
                          {t('account.permissions.breakGlass')}
                        </Badge>
                      )}
                    </div>
                    {row.sources.length > 0 && (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {t('account.permissions.from')}{' '}
                        {row.sources
                          .map((source) =>
                            source.where === null
                              ? source.name[locale]
                              : `${source.name[locale]} — ${source.where[locale]}`,
                          )
                          .join('، ')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))}

        {/* The moment this answer describes. The authorizer reads a cached snapshot whose lifetime
            is capped at the next validity boundary, so a grant that opened seconds ago can be true
            here and not yet true there — saying WHEN is the difference between a screen that
            reports and one that appears to be wrong. */}
        {data !== undefined && groups.length > 0 && (
          <p className="text-xs text-slate-400">
            {t('account.permissions.evaluatedAt', {
              at: formatDateTime(data.evaluatedAt, locale),
            })}
          </p>
        )}
      </div>
    </PageContainer>
  );
};

export default MyPermissionsPage;
