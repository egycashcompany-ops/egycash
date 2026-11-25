// The approval-chain screen names what a chain is for in the reader's language (P2.0 of
// docs/12-planning/administration-module-phase-2.md §3; design §13.4 rule 6): the request types,
// and the departments and branches a chain is written for, each carry an Arabic and an English
// name, and the screen showed the Arabic one in both locales.
//
// The list is rendered for real, its data hooks stubbed with the API's own shapes. The editor is
// pinned at its source: it opens only on a click, which a static render cannot make, while the
// property that matters, which name each of its three selects shows, is plainly readable in the
// file.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type ApprovalRequestTypeDto,
  type ApprovalWorkflowDto,
  type DepartmentCatalogDto,
  type Locale,
  type OrgUnitOptionDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../../store/localeSlice';
import type * as ApprovalQueries from '../api/approval-queries';
import type * as RoleQueries from '../../roles/api/role-queries';
import type * as References from '../../../organization/shared/references';
import { ApprovalWorkflowsPage } from './ApprovalWorkflowsPage';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, 'ApprovalWorkflowsPage.tsx'), 'utf8');

const FLEET = { id: 'dc-fleet', name: { ar: 'الحركة', en: 'Fleet' } };
const HQ = { id: 'b-hq', name: { ar: 'المركز الرئيسي', en: 'Head office' } };

const TYPES: ApprovalRequestTypeDto[] = [
  {
    key: 'hr.leave',
    moduleId: 'hr',
    name: { ar: 'طلب إجازة', en: 'Leave request' },
    permissionKeys: ['leave.approve'],
  },
];

const chain = (
  id: string,
  department: ApprovalWorkflowDto['department'],
  branch: ApprovalWorkflowDto['branch'],
): ApprovalWorkflowDto => ({
  id,
  requestType: 'hr.leave',
  department,
  branch,
  steps: [{ permissionKey: 'leave.approve', level: 'unit', label: null }],
  isActive: true,
  version: 0,
  updatedAt: '2026-11-25T09:00:00.000Z',
});

const ROWS = [chain('w-default', null, null), chain('w-fleet-hq', FLEET, HQ)];

vi.mock('../api/approval-queries', async (importOriginal) => ({
  ...(await importOriginal<typeof ApprovalQueries>()),
  useApprovalWorkflows: () => ({
    data: ROWS,
    isLoading: false,
    isError: false,
    refetch: () => undefined,
  }),
  useApprovalRequestTypes: () => ({ data: TYPES, isLoading: false }),
}));

vi.mock('../../roles/api/role-queries', async (importOriginal) => ({
  ...(await importOriginal<typeof RoleQueries>()),
  useDepartmentCatalog: () => ({
    data: [
      {
        id: FLEET.id,
        code: 'FLT',
        name: FLEET.name,
        description: null,
        status: 'active',
        version: 0,
        createdAt: '2026-11-01T09:00:00.000Z',
        updatedAt: '2026-11-01T09:00:00.000Z',
      },
    ] satisfies DepartmentCatalogDto[],
  }),
}));

vi.mock('../../../organization/shared/references', async (importOriginal) => ({
  ...(await importOriginal<typeof References>()),
  useBranchOptions: () => ({
    data: [
      { id: HQ.id, code: 'HQ', name: HQ.name, parentId: null, catalogId: null },
    ] satisfies OrgUnitOptionDto[],
  }),
}));

const render = (locale: Locale): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
    },
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <ApprovalWorkflowsPage />
      </QueryClientProvider>
    </Provider>,
  );
};

describe('the chain list names each request type and place in the reader’s language', () => {
  it('in English: the type’s English name over its chains, and the place’s English names', () => {
    const markup = render('en');
    expect(markup).toContain('Leave request');
    expect(markup).toContain('Fleet · Head office');
    expect(markup).not.toContain('طلب إجازة');
    expect(markup).not.toContain('الحركة');
    expect(markup).not.toContain('المركز الرئيسي');
  });

  it('in Arabic: the Arabic names, and no English one', () => {
    const markup = render('ar');
    expect(markup).toContain('طلب إجازة');
    expect(markup).toContain('الحركة · المركز الرئيسي');
    expect(markup).not.toContain('Leave request');
    expect(markup).not.toContain('Fleet');
    expect(markup).not.toContain('Head office');
  });

  it('keeps the rung keys an administrator configures', () => {
    // The chain screen is where a key is chosen, and its readers hold `approval.configure`; the
    // approval panel, read by requesters and approvers, shows none.
    expect(render('en')).toContain('leave.approve');
    expect(render('ar')).toContain('leave.approve');
  });
});

describe('the chain editor’s three selects name their options in the reader’s language', () => {
  /** The `<Field>` the label key opens, up to its close: one select and its options. */
  const field = (labelKey: string): string => {
    const start = SOURCE.indexOf(`<Field label={t('${labelKey}')}`);
    expect(start, labelKey).toBeGreaterThan(-1);
    return SOURCE.slice(start, SOURCE.indexOf('</Field>', start));
  };

  it('the request type', () => {
    expect(field('approvals.editor.requestType')).toContain('{type.name[locale]}');
  });

  it('the department', () => {
    expect(field('approvals.editor.department')).toContain('{department.name[locale]}');
  });

  it('the branch', () => {
    expect(field('approvals.editor.branch')).toContain('{branch.name[locale]}');
  });

  it('and no name anywhere on the screen is read in one language for every reader', () => {
    expect(SOURCE).not.toMatch(/name\??\.(ar|en)\b/u);
  });

  it('while a rung’s key select still lists the keys themselves', () => {
    expect(SOURCE).toMatch(
      /keysFor\(draft\.requestType\)\.map\(\(key\) => \(\s*<option key=\{key\} value=\{key\}>\s*\{key\}/u,
    );
  });
});
