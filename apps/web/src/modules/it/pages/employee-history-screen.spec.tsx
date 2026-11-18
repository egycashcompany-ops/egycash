// «اللى ادوس عليه يجيب الهيستورى بتاعه كله» — one person's IT history, proven against what it
// renders for each reader: every section rides its own register's read grant. Custody is the page's
// own (`itAsset.view`, the route's); the mobile lines ride `itMobileLine.view` and the consumables
// `itConsumable.view`, each its own since 2026-11-17 («فى الـ IT ظبط صلاحيات الشاشات عشان أقدر
// أتحكم فيها») — a reader without one sees no section for it, rather than a table of 403s, and the
// section's read is never asked.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type ItConsumableMovementDto,
  type ItMobileLineAssignmentDto,
  type ItPersonDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { detailKey, listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { ItEmployeeHistoryPage } from './ItEmployeeHistoryPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
/** The page's source with comments stripped: a rule about the code is never met by its prose. */
const SOURCE = readFileSync(join(HERE, 'ItEmployeeHistoryPage.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//gu, '')
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');

const ar = (key: string): string => translate('ar', key);

const me = (permissions: string[]): MeDto =>
  ({
    id: 'u-1',
    email: 'user@ecms.local',
    username: null,
    mustChangePassword: false,
    name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
    locale: 'ar',
    theme: 'system',
    navLayout: 'rail',
    branchId: null,
    branchIds: [],
    employeeId: null,
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
    isPrivileged: false,
    flags: {},
    totpEnabled: true,
    external: null,
  }) as unknown as MeDto;

const EMPLOYEE = 'e-1';

const PERSON: ItPersonDto = {
  employeeId: EMPLOYEE,
  code: '0100052',
  fullNameAr: 'محمد أحمد علي',
  status: 'active',
  branchId: 'b-hq',
  departmentId: null,
  jobTitleId: null,
  hiredAt: '2024-01-01T00:00:00.000Z',
  exitedAt: null,
  // No login: no tickets section either way, so only the three registers are in question.
  userId: null,
  openCustodyCount: 0,
};

const LINE_HELD = {
  id: 'la-1',
  lineId: 'l-1',
  network: 'etisalat',
  phoneNumber: '01112345678',
  ratePlan: 'Business 500',
  employeeId: EMPLOYEE,
  assignedAt: '2026-10-01T09:00:00.000Z',
  returnedAt: null,
  receiptId: null,
  receiptSigned: null,
} as unknown as ItMobileLineAssignmentDto;

const ISSUED = {
  id: 'm-1',
  consumableId: 'c-1',
  kind: 'issued',
  qty: 2,
  at: '2026-10-21T08:30:00.000Z',
  branchId: 'b-hq',
  consumableCode: 'CON-00004',
  consumableName: 'Mouse',
  typeId: null,
  employeeId: EMPLOYEE,
  employeeCode: '0100052',
  employeeName: 'محمد أحمد علي',
  assetId: null,
  assetCode: null,
  assetName: null,
  reason: 'new',
  memoId: null,
  memoNumber: null,
  memoSigned: null,
  transferId: null,
  counterpartBranchId: null,
  counterpartConsumableId: null,
  counterpartConsumableCode: null,
  byUserId: null,
  notes: null,
  createdAt: '2026-10-21T08:30:00.000Z',
} as unknown as ItConsumableMovementDto;

const page = <T,>(items: T[], pageSize: number) => ({
  items,
  meta: { page: 1, pageSize, totalItems: items.length, totalPages: 1 },
});

const render = (permissions: string[]): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(detailKey('it', 'people', EMPLOYEE), PERSON);
  const custody = (open: boolean) =>
    open
      ? { employeeId: EMPLOYEE, open, pageSize: 100, sortBy: 'assignedAt', sortDir: 'desc' }
      : {
          employeeId: EMPLOYEE,
          open,
          page: 1,
          pageSize: 10,
          sortBy: 'returnedAt',
          sortDir: 'desc',
        };
  qc.setQueryData(listKey('it', 'custody', custody(true)), page([], 100));
  qc.setQueryData(listKey('it', 'custody', custody(false)), page([], 10));
  qc.setQueryData(listKey('it', 'mobileLineAssignments', custody(true)), page([LINE_HELD], 100));
  qc.setQueryData(listKey('it', 'mobileLineAssignments', custody(false)), page([], 10));
  qc.setQueryData(
    listKey('it', 'consumables', { movements: true, employeeId: EMPLOYEE, page: 1, pageSize: 10 }),
    page([ISSUED], 10),
  );
  qc.setQueryData(listKey('it', 'branchOptions'), [
    { id: 'b-hq', code: '01', name: { ar: 'المهندسين', en: 'HQ' }, parentId: null },
  ]);
  qc.setQueryData(listKey('it', 'departmentOptions'), []);
  qc.setQueryData(listKey('it', 'jobTitleOptions'), []);
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/it/employees/${EMPLOYEE}`]}>
          <Routes>
            <Route path="/it/employees/:employeeId" element={<ItEmployeeHistoryPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const LINES_HINT = ar('it.employees.mobileLinesHint');
const CONSUMABLES_HINT = ar('it.consumables.employeeCard.hint');

describe('a person’s IT history — each section on its own register’s grant', () => {
  it('shows a keeper of the three registers the custody, the lines and the consumables', () => {
    const html = render(['itAsset.view', 'itMobileLine.view', 'itConsumable.view']);
    expect(html).toContain(ar('it.employees.sections.currentCustody'));
    expect(html).toContain(LINES_HINT);
    expect(html).toContain('01112345678');
    expect(html).toContain(CONSUMABLES_HINT);
    expect(html).toContain('CON-00004');
  });

  it('hides the lines and the consumables from a reader of the assets alone', () => {
    const html = render(['itAsset.view']);
    expect(html).toContain(ar('it.employees.sections.currentCustody'));
    expect(html).not.toContain(LINES_HINT);
    expect(html).not.toContain('01112345678');
    expect(html).not.toContain(CONSUMABLES_HINT);
    expect(html).not.toContain('CON-00004');
  });

  it('shows the lines without the consumables, and the consumables without the lines', () => {
    const lines = render(['itAsset.view', 'itMobileLine.view']);
    expect(lines).toContain(LINES_HINT);
    expect(lines).not.toContain(CONSUMABLES_HINT);
    const consumables = render(['itAsset.view', 'itConsumable.view']);
    expect(consumables).toContain(CONSUMABLES_HINT);
    expect(consumables).not.toContain(LINES_HINT);
  });

  // A hidden section asks nothing: the lines' two reads are switched off without their grant, and
  // the consumables' card — which owns its read — is not drawn at all.
  it('never asks for a section the reader may not see', () => {
    const lineReads = [...SOURCE.matchAll(/useItMobileLineAssignments\(([\s\S]*?)\n {2}\);/gu)];
    expect(lineReads).toHaveLength(2);
    for (const read of lineReads) {
      expect(read[1]).toMatch(/linesVisible && employeeId !== '',?\s*$/u);
    }
    expect(SOURCE).toContain("const linesVisible = can('itMobileLine.view');");
    expect(SOURCE).toContain(
      "{can('itConsumable.view') && <EmployeeConsumablesCard employeeId={employeeId} />}",
    );
  });
});
