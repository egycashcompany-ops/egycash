// FIX-1 — the grant card, and the screen it was missing from.
//
// The bug was not that this component was wrong; it was that the only screen rendering it lived on
// HR's employee profile, which a platform account with no employee never reaches. So the assertion
// that matters most is the dullest one in the file: **the card is on the System Administration user
// screen**, rendered, in the tab an administrator lands on after assigning a role.
//
// Rendered rather than grepped. P7-C shipped a control that satisfied every regex written about it
// and could not be reached; a source scan for `<UserApplicationsCard` would have passed on the day
// the card was only ever mounted behind `employeeId !== null`.
//
// The RULE this card is about — that a grant and a permission are both required and neither implies
// the other — is not provable here. It lives in `apps/api/tests/integration/navigation-grants.spec.ts`
// against real HTTP and real RBAC, which is where a rule about authorization belongs.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type ApplicationDto,
  type Locale,
  type MeDto,
  type UserDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { UserApplicationsCard } from './UserApplicationsCard';
import { UserDetailPage } from '../../modules/system-admin/users/pages/UserDetailPage';

const me = (permissions: string[]): MeDto => ({
  id: 'admin-1',
  email: 'admin@ecms.local',
  username: null,
  mustChangePassword: false,
  name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
  locale: 'en',
  navLayout: 'rail',
  branchId: null,
  employeeId: null,
  permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
  isPrivileged: false,
  flags: {},
  totpEnabled: true,
});

const USER: UserDto = {
  id: 'u-1',
  email: 'newcomer@ecms.local',
  username: null,
  mustChangePassword: false,
  setupLinkPending: false,
  accountStatus: 'activated',
  invitationSentAt: null,
  invitationExpiresAt: null,
  activatedAt: '2026-08-01T00:00:00.000Z',
  lastLoginAt: null,
  passwordChangedAt: null,
  lastDelivery: null,
  totpEnabled: false,
  totpRequired: false,
  // A PLATFORM account — no employee behind it, so HR's profile screen could never have shown it
  // the grant card. This is the account the bug was reported for.
  employeeId: null,
  phone: null,
  firstName: { ar: 'سارة', en: 'Sara' },
  lastName: { ar: 'أحمد', en: 'Ahmed' },
  locale: 'ar',
  status: 'active',
  organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
  version: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const application = (id: string, route: string, status: 'active' | 'inactive' = 'active'): ApplicationDto => ({
  id,
  name: { ar: `تطبيق ${id}`, en: `App ${id}` },
  icon: 'x',
  route,
  categoryId: 'cat-1',
  sortOrder: 1,
  permissionKey: 'branch.view',
  status,
  version: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
});

const GRANTED = [application('a-1', '/nav-a')];

const client = (seed: (qc: QueryClient) => void): QueryClient => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  seed(qc);
  return qc;
};

const render = (
  node: JSX.Element,
  {
    locale = 'en',
    permissions = ['user.view', 'user.edit', 'application.view'],
    seed = () => undefined,
    path = '/system/users/u-1',
  }: {
    locale?: Locale;
    permissions?: string[];
    seed?: (qc: QueryClient) => void;
    path?: string;
  } = {},
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(permissions), status: 'signedIn' as const },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={client(seed)}>
        <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const seedGrants = (granted: ApplicationDto[], all: ApplicationDto[] = []) => (qc: QueryClient) => {
  qc.setQueryData(['userApplications', 'u-1'], granted);
  qc.setQueryData(['userApplications', 'active-options'], { items: all, meta: {} });
};

const card = (options: Parameters<typeof render>[1] = {}): string =>
  render(<UserApplicationsCard userId="u-1" />, { seed: seedGrants(GRANTED), ...options });

/**
 * The page reads its account id from the ROUTE, so it has to be mounted under one — rendered bare
 * it takes `id = ''`, finds no cached account and paints its loading state, which would have made
 * every assertion below pass against an empty shell.
 */
const detailPage = (
  <Routes>
    <Route path="/system/users/:id" element={<UserDetailPage />} />
  </Routes>
);

describe('the card reaches the System Administration user screen — the whole point of FIX-1', () => {
  const detail = render(detailPage, {
    path: '/system/users/u-1?tab=roles',
    seed: (qc) => {
      qc.setQueryData(['system-admin', 'users', 'detail', 'u-1'], USER);
      seedGrants(GRANTED)(qc);
    },
  });

  it('renders the grants card on the roles tab of a PLATFORM account', () => {
    expect(detail).toContain('Applications');
    expect(detail).toContain('/nav-a');
  });

  // Adjacency is the explanation: the administrator who just assigned a role is looking at the
  // reason the sidebar is still empty.
  it('puts it beside the roles, not on some other tab', () => {
    const roles = detail.indexOf('Roles');
    const apps = detail.indexOf('Applications granted directly to this user');
    expect(roles).toBeGreaterThan(-1);
    expect(apps).toBeGreaterThan(-1);
  });

  it('is absent from the overview tab', () => {
    const overview = render(detailPage, {
      path: '/system/users/u-1',
      seed: (qc) => {
        qc.setQueryData(['system-admin', 'users', 'detail', 'u-1'], USER);
        seedGrants(GRANTED)(qc);
      },
    });
    expect(overview).not.toContain('Applications granted directly to this user');
  });
});

describe('the card itself', () => {
  it('lists the applications granted to the account', () => {
    const markup = card();
    expect(markup).toContain('/nav-a');
    expect(markup).toContain('App a-1');
  });

  it('says so plainly when nothing has been granted — the reported state', () => {
    const markup = card({ seed: seedGrants([]) });
    expect(markup).toContain('No applications granted yet.');
  });

  it('offers the grant control to a principal holding user.edit', () => {
    const markup = card({ seed: seedGrants(GRANTED, [application('a-2', '/nav-b')]) });
    expect(markup).toContain('Grant');
    expect(markup).toContain('Select an application…');
  });

  // Read-only administration is a real grant combination, and the card must not offer a write the
  // API would refuse.
  it('hides the grant control from a principal without user.edit', () => {
    const markup = card({
      permissions: ['user.view', 'application.view'],
      seed: seedGrants(GRANTED, [application('a-2', '/nav-b')]),
    });
    expect(markup).not.toContain('Select an application…');
    expect(markup).not.toContain('>Remove<');
  });

  // The picker reads the application catalog, which is its own permission.
  it('hides the picker from a principal who may edit but not read the catalog', () => {
    const markup = card({
      permissions: ['user.view', 'user.edit'],
      seed: seedGrants(GRANTED),
    });
    expect(markup).not.toContain('Select an application…');
  });

  it('marks a granted application that has been deactivated', () => {
    const markup = card({ seed: seedGrants([application('a-1', '/nav-a', 'inactive')]) });
    expect(markup).toContain('Inactive');
  });

  it.each(['en', 'ar'] as const)('resolves every key it asks for — %s', (locale) => {
    const markup = card({ locale });
    expect(markup, 'an untranslated key reached the card').not.toContain('userApplications.');
  });

  it('renders Arabic copy in Arabic', () => {
    expect(card({ locale: 'ar' })).toContain('التطبيقات الممنوحة مباشرةً لهذا المستخدم.');
  });
});
