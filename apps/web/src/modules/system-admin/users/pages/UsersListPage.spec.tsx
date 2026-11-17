// The System Users list, rendered: «زود أدوار كل واحد + الإدارة بتاعته + مسماه الوظيفي .. وطبعاً
// هتزودهم فى الفلتر». The data hooks are stubbed with the API's own row shape; what is asserted is
// what the page draws from it — and that the roles column and filter are there only for an
// administrator who may see roles.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type Locale,
  type MeDto,
  type OrgUnitOptionDto,
  type RoleDto,
  type UserListItemDto,
  type UserRoleRefDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../../store/localeSlice';
import { authSlice } from '../../../../store/authSlice';
import { uiSlice } from '../../../../store/uiSlice';
import type * as UserQueries from '../api/user-queries';
import type * as RoleQueries from '../../roles/api/role-queries';
import type * as References from '../../../organization/shared/references';
import { UsersListPage } from './UsersListPage';

const role = (id: string, en: string, ar: string): UserRoleRefDto => ({
  id,
  key: null,
  name: { en, ar },
});

const ROW: UserListItemDto = {
  id: 'u-1',
  email: null,
  username: '0101469',
  mustChangePassword: false,
  setupLinkPending: false,
  accountStatus: 'activated',
  invitationSentAt: null,
  invitationExpiresAt: null,
  activatedAt: '2026-11-01T09:00:00.000Z',
  lastLoginAt: null,
  passwordChangedAt: null,
  lastDelivery: null,
  totpEnabled: false,
  totpRequired: false,
  employeeId: 'e-1',
  externalSubject: null,
  kind: 'employee',
  phone: null,
  firstName: { ar: 'محمد', en: 'Mohamed' },
  lastName: { ar: 'مصطفى محمد احمد', en: 'Moustafa' },
  locale: 'ar',
  status: 'active',
  organization: { branchId: 'b-1', departmentId: 'd-1', sectionId: null, jobTitleId: 'j-1' },
  version: 1,
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-01T09:00:00.000Z',
  department: { id: 'd-1', name: { ar: 'نقل الأموال', en: 'Cash Transport' } },
  jobTitle: { id: 'j-1', name: { ar: 'سائق', en: 'Driver' } },
  roles: [
    role('r-1', 'Employee Self-Service', 'الخدمة الذاتية للموظفين'),
    role('r-2', 'Cash captain', 'كابتن نقل'),
    role('r-3', 'Vault reader', 'قارئ الخزينة'),
    role('r-4', 'Auditor', 'مدقق'),
  ],
};

const option = (id: string, ar: string, en: string, parentId: string | null): OrgUnitOptionDto => ({
  id,
  code: id,
  name: { ar, en },
  parentId,
  catalogId: null,
});

vi.mock('../api/user-queries', async (importOriginal) => ({
  ...(await importOriginal<typeof UserQueries>()),
  useSystemUsers: () => ({
    data: {
      items: [ROW],
      meta: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => undefined,
  }),
  useBranchOptions: () => ({ data: [] }),
}));

vi.mock('../../../organization/shared/references', async (importOriginal) => ({
  ...(await importOriginal<typeof References>()),
  useDepartmentReferenceOptions: () => ({
    data: [option('d-1', 'نقل الأموال', 'Cash Transport', 'b-1')],
  }),
  useJobTitleReferenceOptions: () => ({ data: [option('j-1', 'سائق', 'Driver', null)] }),
}));

vi.mock('../../roles/api/role-queries', async (importOriginal) => ({
  ...(await importOriginal<typeof RoleQueries>()),
  // The filter searches the server; here the search answers one role.
  useRoleSearch: (_term: string, enabled: boolean) => ({
    data: enabled
      ? {
          items: [
            { id: 'r-2', key: null, name: { en: 'Cash captain', ar: 'كابتن نقل' } } as RoleDto,
          ],
        }
      : undefined,
    isFetching: false,
  }),
  useRolesById: () => [],
}));

const me = (permissions: string[]): MeDto => ({
  id: 'admin-1',
  email: 'admin@ecms.local',
  username: null,
  mustChangePassword: false,
  name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
  locale: 'en',
  navLayout: 'rail',
  theme: 'system',
  branchId: null,
  branchIds: [],
  employeeId: null,
  permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
  isPrivileged: true,
  flags: {},
  totpEnabled: true,
  external: null,
});

const render = (permissions: string[], locale: Locale = 'en'): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <UsersListPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

describe('each account’s department, job title and roles', () => {
  const markup = render(['user.view', 'role.view']);

  it('names the department and the job title', () => {
    expect(markup).toContain('Department');
    expect(markup).toContain('Job title');
    expect(markup).toContain('Cash Transport');
    expect(markup).toContain('Driver');
  });

  it('names the roles, three at most, the rest folded into «+n» with all of them on hover', () => {
    expect(markup).toContain('Roles');
    expect(markup).toContain('Auditor');
    expect(markup).toContain('Cash captain');
    expect(markup).toContain('+1');
    expect(markup).toContain('Employee Self-Service');
  });

  it('offers the three as filters', () => {
    // The filter bar's controls are labelled by the same words as the columns.
    expect(markup.match(/Department/g)?.length ?? 0).toBeGreaterThan(1);
    expect(markup.match(/Job title/g)?.length ?? 0).toBeGreaterThan(1);
    expect(markup.match(/Roles/g)?.length ?? 0).toBeGreaterThan(1);
  });
});

describe('roles only for an administrator who may see them', () => {
  const markup = render(['user.view']);

  it('keeps department and job title', () => {
    expect(markup).toContain('Cash Transport');
    expect(markup).toContain('Driver');
  });

  it('draws no roles column and no roles filter', () => {
    expect(markup).not.toContain('Roles');
    expect(markup).not.toContain('Cash captain');
  });
});

describe('in Arabic', () => {
  const markup = render(['user.view', 'role.view'], 'ar');

  it('reads in Arabic, with no key left untranslated', () => {
    expect(markup).toContain('الإدارة');
    expect(markup).toContain('المسمى الوظيفي');
    expect(markup).toContain('الأدوار');
    expect(markup).toContain('نقل الأموال');
    expect(markup).not.toContain('systemAdmin.users.');
  });
});
