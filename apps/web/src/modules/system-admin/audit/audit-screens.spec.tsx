// P11 — the two log screens.
//
// Split by what can honestly be proven here. This suite has no DOM: nothing can be typed into a
// filter, and `Dialog` portals to `document.body`, which does not exist.
//
//   • **The URL contract is a pure function**, and is exercised directly. It is also the part most
//     worth proving: an audit view IS evidence, and a link that reopens a different view than the
//     one someone was looking at is worse than no link.
//   • **What each screen SHOWS is a markup fact**, asserted with `renderToStaticMarkup` — chiefly
//     that `ip`/`userAgent` are in the detail panel and NOT in the table (D6), that the export
//     control follows its own permission, and that every key resolves in both locales.
//
// What the SERVER does is proven in `apps/api/tests/integration/audit.spec.ts` — masking, the
// snapshot, every filter, and that `auditLog.view` does not grant `auditLog.export`. Nothing on
// this screen can enforce any of that; it only avoids offering what the server would refuse.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  AUDIT_ACTIONS,
  type ActivityLogDto,
  type AuditLogDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { AUDIT_KEY, ACTIVITY_KEY } from './api/audit-api';
import { AuditDetailPanel } from './components/AuditDetailPanel';
import { AuditLogPage } from './pages/AuditLogPage';
import { ActivityLogPage } from './pages/ActivityLogPage';
import { auditActionLabelKey } from './lib/audit-labels';
import {
  AUDIT_PAGE_SIZE,
  actionFrom,
  hasActiveFilters,
  pageFrom,
  readActivityFilters,
  readAuditFilters,
  withParam,
} from './lib/audit-filters';

const auditRow = (over: Partial<AuditLogDto> = {}): AuditLogDto => ({
  id: 'a-1',
  entityRef: { moduleId: 'hr', entityType: 'employee', entityId: 'e-1' },
  action: 'update',
  changes: [{ field: 'phone', old: '0100', new: '0111' }],
  actor: { userId: 'u-9', ip: '10.1.2.3', userAgent: 'Firefox/128' },
  actorSnapshot: {
    userId: 'u-9',
    displayName: { ar: 'سارة أحمد', en: 'Sara Ahmed' },
    jobTitle: { ar: 'مديرة', en: 'Manager' },
    avatarFileId: null,
    deletedAt: null,
  },
  requestId: 'req-77',
  at: '2026-08-01T10:00:00.000Z',
  ...over,
});

const activityRow = (over: Partial<ActivityLogDto> = {}): ActivityLogDto => ({
  id: 'act-1',
  entityRef: { moduleId: 'hr', entityType: 'employee', entityId: 'e-1' },
  messageKey: 'employees.timeline.personalDataUpdated',
  params: {},
  actorId: 'u-9',
  actor: {
    userId: 'u-9',
    displayName: { ar: 'سارة أحمد', en: 'Sara Ahmed' },
    jobTitle: null,
    avatarFileId: null,
    deletedAt: null,
  },
  at: '2026-08-01T10:00:00.000Z',
  ...over,
});

const me = (permissions: string[]): MeDto => ({
  id: 'admin-1',
  email: 'admin@ecms.local',
  username: null,
  mustChangePassword: false,
  name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
  locale: 'en',
  theme: 'system',
  navLayout: 'rail',
  branchId: null,
  employeeId: null,
  permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
  isPrivileged: false,
  flags: {},
  totpEnabled: true,
});

const page = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, pageSize: AUDIT_PAGE_SIZE, totalItems: items.length, totalPages: 1 },
});

const render = (
  node: JSX.Element,
  {
    locale = 'en',
    permissions = ['auditLog.view', 'auditLog.export', 'activityLog.view'],
    path = '/system/audit',
    seed = () => undefined,
  }: {
    locale?: Locale;
    permissions?: string[];
    path?: string;
    seed?: (qc: QueryClient) => void;
  } = {},
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  seed(qc);
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const auditScreen = (options: Parameters<typeof render>[1] = {}): string =>
  render(<AuditLogPage />, {
    seed: (qc) => qc.setQueryData([...AUDIT_KEY, 'list', readAuditFilters(new URLSearchParams((options.path ?? '/system/audit').split('?')[1] ?? ''))], page([auditRow()])),
    ...options,
  });

const params = (search: string): URLSearchParams => new URLSearchParams(search);

describe('the URL is the filter state', () => {
  it('reads every filter the endpoint accepts', () => {
    const filters = readAuditFilters(
      params('entityType=employee&entityId=e-1&actorUserId=u-9&action=update&moduleId=hr&from=2026-01-01&to=2026-02-01&page=3'),
    );
    expect(filters).toEqual({
      page: 3,
      pageSize: AUDIT_PAGE_SIZE,
      entityType: 'employee',
      entityId: 'e-1',
      actorUserId: 'u-9',
      action: 'update',
      moduleId: 'hr',
      from: '2026-01-01',
      to: '2026-02-01',
    });
  });

  it('omits an absent filter rather than sending it empty', () => {
    expect(readAuditFilters(params(''))).toEqual({ page: 1, pageSize: AUDIT_PAGE_SIZE });
  });

  it('treats whitespace as absent', () => {
    expect(readAuditFilters(params('entityType=%20%20')).entityType).toBeUndefined();
  });

  // A bad page is not a page. `?page=0` would ask the server for page 0 and get a 400.
  it.each([
    ['', 1],
    ['page=4', 4],
    ['page=0', 1],
    ['page=-2', 1],
    ['page=x', 1],
    ['page=1.5', 1],
  ])('reads %o as page %i', (search, expected) => {
    expect(pageFrom(params(search))).toBe(expected);
  });

  /**
   * An action the contract does not declare is dropped, not forwarded. The endpoint validates
   * against the same enum and would answer 400, which on screen reads as "the audit log is broken"
   * rather than "that link has a typo in it".
   */
  it('drops an action the contract does not declare', () => {
    expect(actionFrom(params('action=update'))).toBe('update');
    expect(actionFrom(params('action=nonsense'))).toBeUndefined();
    expect(readAuditFilters(params('action=nonsense')).action).toBeUndefined();
  });

  it('accepts every action the contract DOES declare', () => {
    for (const action of AUDIT_ACTIONS) {
      expect(actionFrom(params(`action=${action}`)), action).toBe(action);
    }
  });

  it('drops a malformed date rather than sending it', () => {
    expect(readAuditFilters(params('from=yesterday')).from).toBeUndefined();
    expect(readAuditFilters(params('from=2026-13-45')).from).toBeUndefined();
    expect(readAuditFilters(params('from=2026-03-04')).from).toBe('2026-03-04');
  });

  // Narrowing a filter while staying on page 7 shows an empty screen that reads as "no results"
  // when the results are on page 1.
  it('resets the page when a filter changes, and keeps it when the page changes', () => {
    expect(withParam(params('page=7'), 'action', 'login').get('page')).toBeNull();
    expect(withParam(params('page=7'), 'page', '2').get('page')).toBe('2');
  });

  it('removes a filter that is cleared', () => {
    expect(withParam(params('action=login'), 'action', '').get('action')).toBeNull();
  });

  it('knows whether anything beyond paging is applied', () => {
    expect(hasActiveFilters(readAuditFilters(params('page=3')))).toBe(false);
    expect(hasActiveFilters(readAuditFilters(params('action=login')))).toBe(true);
  });

  // The activity endpoint accepts two parameters and nothing else; offering more would be a
  // control that produces a 400.
  it('reads only the two filters the activity endpoint accepts', () => {
    expect(readActivityFilters(params('entityType=employee&entityId=e-1&action=login'))).toEqual({
      page: 1,
      pageSize: AUDIT_PAGE_SIZE,
      entityType: 'employee',
      entityId: 'e-1',
    });
  });
});

describe('D6 — ip and user agent are in the panel, never the table', () => {
  it('keeps them out of the list', () => {
    const markup = auditScreen();
    expect(markup).toContain('Sara Ahmed'); // the row is really rendered
    expect(markup).not.toContain('10.1.2.3');
    expect(markup).not.toContain('Firefox/128');
  });

  // The panel is asserted directly: `Dialog` portals to `document.body`, which this environment
  // does not have.
  it('shows them in the detail panel', () => {
    const markup = render(<AuditDetailPanel row={auditRow()} />);
    expect(markup).toContain('10.1.2.3');
    expect(markup).toContain('Firefox/128');
    expect(markup).toContain('req-77');
  });

  it('shows the field-level diff in the panel', () => {
    const markup = render(<AuditDetailPanel row={auditRow()} />);
    expect(markup).toContain('phone');
    expect(markup).toContain('0100');
    expect(markup).toContain('0111');
  });

  // A login, a download or a denied permission is audited with no diff — that is normal, and the
  // panel says so rather than showing an empty table.
  it('says so plainly when an act records no field changes', () => {
    const markup = render(<AuditDetailPanel row={auditRow({ changes: [] })} />);
    expect(markup).toContain(translate('en', 'systemAdmin.audit.noChanges'));
  });
});

describe('G-2 on screen — the actor is the stored snapshot', () => {
  it('names who they were at the time', () => {
    expect(auditScreen()).toContain('Sara Ahmed');
  });

  it('names them in Arabic when the reader is reading Arabic', () => {
    expect(auditScreen({ locale: 'ar' })).toContain('سارة أحمد');
  });

  // A row written before actor snapshots existed. "Not recorded" is the honest answer — resolving
  // the user now would let a rename rewrite the past.
  it('says the actor was not recorded rather than inventing one', () => {
    const markup = render(<AuditDetailPanel row={auditRow({ actorSnapshot: null })} />);
    expect(markup).toContain(translate('en', 'systemAdmin.audit.actorUnknown'));
  });
});

describe('reading is not exporting', () => {
  it('offers the export to a caller holding auditLog.export', () => {
    expect(auditScreen()).toContain(translate('en', 'systemAdmin.audit.export'));
  });

  // Its own grant, its own row cap, its own audit row and its own security signal — the control is
  // withheld rather than shown and refused.
  it('withholds it from a caller who may only read', () => {
    expect(auditScreen({ permissions: ['auditLog.view'] })).not.toContain(
      translate('en', 'systemAdmin.audit.export'),
    );
  });
});

describe('the activity screen is its own screen', () => {
  const activityScreen = (options: Parameters<typeof render>[1] = {}): string =>
    render(<ActivityLogPage />, {
      path: '/system/activity',
      seed: (qc) =>
        qc.setQueryData(
          [...ACTIVITY_KEY, 'list', readActivityFilters(new URLSearchParams())],
          page([activityRow()]),
        ),
      ...options,
    });

  it('renders the message rather than a field diff', () => {
    const markup = activityScreen();
    expect(markup).toContain(translate('en', 'employees.timeline.personalDataUpdated'));
  });

  it('names the actor from the snapshot', () => {
    expect(activityScreen()).toContain('Sara Ahmed');
  });

  // It has no action vocabulary and no export — offering either would be a control the endpoint
  // cannot serve.
  it('offers neither an action filter nor an export', () => {
    const markup = activityScreen();
    expect(markup).not.toContain(translate('en', 'systemAdmin.audit.filters.allActions'));
    expect(markup).not.toContain(translate('en', 'systemAdmin.audit.export'));
  });
});

describe('both screens, in both languages', () => {
  it.each(['en', 'ar'] as const)('resolves every key the audit screen asks for — %s', (locale) => {
    const markup = auditScreen({ locale });
    expect(markup, 'an untranslated key reached the audit screen').not.toContain(
      'systemAdmin.audit.',
    );
  });

  it.each(['en', 'ar'] as const)('resolves every key the panel asks for — %s', (locale) => {
    const markup = render(<AuditDetailPanel row={auditRow()} />, { locale });
    expect(markup).not.toContain('systemAdmin.audit.');
  });

  it.each(['en', 'ar'] as const)(
    'resolves every key the activity screen asks for — %s',
    (locale) => {
      const markup = render(<ActivityLogPage />, {
        locale,
        path: '/system/activity',
        seed: (qc) =>
          qc.setQueryData(
            [...ACTIVITY_KEY, 'list', readActivityFilters(new URLSearchParams())],
            page([activityRow()]),
          ),
      });
      expect(markup).not.toContain('systemAdmin.activity.');
    },
  );

  // The filter lists every action the contract declares, so every one of them needs a label — the
  // namespace is shared with the account Activity tab, which labelled only a subset.
  it.each(['en', 'ar'] as const)('labels all %s audited actions', (locale) => {
    const missing = AUDIT_ACTIONS.filter(
      (action) => translate(locale, auditActionLabelKey(action)) === auditActionLabelKey(action),
    );
    expect(missing, `untranslated in ${locale}`).toEqual([]);
  });
});
