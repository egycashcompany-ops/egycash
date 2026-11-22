// Department custody at a place (2026-11-19) — the hand-over, the transfer and the consumables
// issue, wired: «جهة الاستلام: موظف / إدارة», the department (IT chosen already), the place of the
// devices' branch, and the responsible person, sent as the request's ONE holder.
//
// The fields render as a static page here (no effects run), so what they offer is proven by
// rendering; what the dialogs send, and when they let it go, is pinned in their source — the
// wiring a browser walk confirmed (`dept-*.png`), kept from drifting.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ItSettingKeys,
  type ItLocationOptionDto,
  type Locale,
  type MeDto,
  type OrgUnitOptionDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { holderBody } from './CustodyDialogs';
import {
  CustodianKindSwitch,
  DepartmentCustodianFields,
  EMPTY_DEPARTMENT_CUSTODIAN,
  departmentCustodianReady,
} from './DepartmentCustodianFields';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const HERE = dirname(fileURLToPath(import.meta.url));
/** Source with comments stripped and whitespace collapsed: prose satisfies no rule here. */
const source = (file: string): string =>
  readFileSync(join(HERE, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
    .replace(/\s+/gu, ' ');

const me = {
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
  permissions: { 'itAsset.view': 'organization', 'itAsset.assign': 'organization' },
  isPrivileged: false,
  flags: {},
  totpEnabled: true,
  external: null,
} as unknown as MeDto;

const HQ = 'b-hq';
const ASYUT = 'b-asyut';
const unit = (id: string, ar: string, parentId: string | null): OrgUnitOptionDto =>
  ({ id, code: id, name: { ar, en: ar }, parentId, catalogId: null }) as OrgUnitOptionDto;
const PLACES: ItLocationOptionDto[] = [
  {
    id: 'l-servers',
    branchId: ASYUT,
    name: { ar: 'غرفة السيرفرات', en: 'Server room' },
    isActive: true,
  },
  {
    id: 'l-cctv',
    branchId: ASYUT,
    name: { ar: 'غرفة الكاميرات', en: 'CCTV room' },
    isActive: true,
  },
  { id: 'l-old', branchId: ASYUT, name: { ar: 'المخزن القديم', en: 'Old store' }, isActive: false },
  { id: 'l-hq', branchId: HQ, name: { ar: 'غرفة الشبكة', en: 'Network room' }, isActive: true },
];

const render = (element: JSX.Element): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(listKey('it', 'branchOptions'), [
    unit(HQ, 'المهندسين', null),
    unit(ASYUT, 'أسيوط', null),
  ]);
  qc.setQueryData(listKey('it', 'departmentOptions'), [
    unit('d-it-hq', 'تقنية المعلومات', HQ),
    unit('d-it-asyut', 'تقنية المعلومات', ASYUT),
    unit('d-ops-asyut', 'الحركة', ASYUT),
  ]);
  qc.setQueryData(listKey('it', 'locations', { options: true }), PLACES);
  qc.setQueryData(
    ['platform', 'settings', 'me'],
    [{ key: ItSettingKeys.TechnicianDepartmentIds, value: ['d-it-hq', 'd-it-asyut'] }],
  );
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me, status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter>{element}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

describe('«جهة الاستلام» and the department’s three fields', () => {
  it('the switch offers an employee and a department, the chosen one pressed', () => {
    const html = render(<CustodianKindSwitch value="department" onChange={() => {}} />);
    expect(html).toContain(ar('it.custody.department.receiverKind'));
    expect(html).toMatch(/aria-checked="true" data-custodian-kind="department"/u);
    expect(html).toMatch(/aria-checked="false" data-custodian-kind="employee"/u);
  });

  it('offers every department named with its branch — the devices’ branch first', () => {
    const html = render(
      <DepartmentCustodianFields
        value={EMPTY_DEPARTMENT_CUSTODIAN}
        onChange={() => {}}
        branchId={ASYUT}
        branchMissingHint="x"
      />,
    );
    const first = html.indexOf('تقنية المعلومات — أسيوط');
    expect(first).toBeGreaterThan(-1);
    expect(html.indexOf('تقنية المعلومات — المهندسين')).toBeGreaterThan(first);
    expect(html).toContain(ar('it.custody.department.responsibleReceiver'));
  });

  it('offers the places of the devices’ branch only, and none retired', () => {
    const html = render(
      <DepartmentCustodianFields
        value={EMPTY_DEPARTMENT_CUSTODIAN}
        onChange={() => {}}
        branchId={ASYUT}
        branchMissingHint="x"
      />,
    );
    expect(html).toContain('<option value="l-servers">غرفة السيرفرات</option>');
    expect(html).toContain('<option value="l-cctv">غرفة الكاميرات</option>');
    expect(html).not.toContain('المخزن القديم');
    expect(html).not.toContain('غرفة الشبكة');
  });

  it('waits, with the dialog’s hint, until the branch is known', () => {
    const html = render(
      <DepartmentCustodianFields
        value={EMPTY_DEPARTMENT_CUSTODIAN}
        onChange={() => {}}
        branchId=""
        branchMissingHint={ar('it.custody.department.locationAfterDevice')}
      />,
    );
    expect(html).toContain(ar('it.custody.department.locationAfterDevice'));
    expect(html).toMatch(/<select[^>]*data-custodian-location="true"[^>]*disabled=""/u);
    expect(html).not.toContain('غرفة السيرفرات');
  });

  it('keeps a place already filled while the branch is not known — shown, not let go', () => {
    // A memo with no item chosen yet, and a device the department holds picked on a line: its
    // department and its place were filled. The box waits for the branch, and shows that place.
    const html = render(
      <DepartmentCustodianFields
        value={{ ...EMPTY_DEPARTMENT_CUSTODIAN, departmentId: 'd-ops-asyut', locationId: 'l-cctv' }}
        onChange={() => {}}
        branchId=""
        branchMissingHint={ar('it.custody.department.locationAfterItem')}
      />,
    );
    expect(html).toContain(ar('it.custody.department.locationAfterItem'));
    expect(html).toMatch(/<select[^>]*data-custodian-location="true"[^>]*disabled=""/u);
    expect(html).toContain('<option value="l-cctv" selected="">غرفة الكاميرات</option>');
    // Only that one: the branch's other places wait for the branch.
    expect(html).not.toContain('غرفة السيرفرات');
  });

  it('is ready only with the department, the place and the signer', () => {
    const all = {
      departmentId: 'd',
      locationId: 'l',
      responsibleEmployeeId: 'e',
      responsibleLabel: '',
    };
    expect(departmentCustodianReady(all)).toBe(true);
    expect(departmentCustodianReady({ ...all, locationId: '' })).toBe(false);
    expect(departmentCustodianReady({ ...all, responsibleEmployeeId: '' })).toBe(false);
    expect(departmentCustodianReady(EMPTY_DEPARTMENT_CUSTODIAN)).toBe(false);
  });
});

describe('the request names ONE holder', () => {
  const department = {
    departmentId: 'd-it',
    locationId: 'l-servers',
    responsibleEmployeeId: 'e-sherif',
    responsibleLabel: 'شريف ممدوح فاروق (0100077)',
  };

  it('an employee by id, or the department, its place and its signer — never both', () => {
    expect(holderBody('employee', 'e-waleed', department)).toEqual({ employeeId: 'e-waleed' });
    expect(holderBody('department', 'e-waleed', department)).toEqual({
      department: {
        departmentId: 'd-it',
        locationId: 'l-servers',
        responsibleEmployeeId: 'e-sherif',
      },
    });
  });
});

describe('the wiring, pinned', () => {
  const custody = source('CustodyDialogs.tsx');
  const issue = source('ConsumableDialogs.tsx');

  it('the hand-over sends the one holder, its paper too, and holds back mixed branches', () => {
    expect(custody).toContain(
      'const body: HandOverItAssets = { ...holderBody(kind, employeeId, department),',
    );
    expect(custody).toContain(
      'const ready = holderChosen && lines.length > 0 && !orderWrong && otherBranchLines.length === 0;',
    );
    expect(custody).toContain(
      "const holderChosen = toDepartment ? departmentCustodianReady(department) : employeeId !== '';",
    );
    // One place per paper: the first device's branch, and the box offers that branch only.
    expect(custody).toContain("const placeBranch = lines[0]?.branchId ?? '';");
    expect(custody).toContain("branchId={toDepartment ? placeBranch : ''}");
    expect(custody).toContain("emptyLine(assetId, picked?.branchId ?? '')");
  });

  it('the transfer moves to a department at a place of the target branch — a place does not travel', () => {
    expect(custody).toContain('toDepartment: { departmentId: department.departmentId,');
    expect(custody).toContain("const placeBranch = chosen !== '' ? chosen : asset.branchId;");
    expect(custody).toContain(
      "const strandsPlace = held?.kind === 'department' && movesBranch && !movesHolder;",
    );
    expect(custody).toContain(
      'const canSubmit = (movesHolder || movesBranch) && (!movesHolder || printed) && !strandsPlace && !departmentUnfinished;',
    );
    // Its paper names the new holder the same way.
    expect(custody).toContain("kind: 'transfer', ...holderBody(kind, employeeId, department),");
  });

  it('«إدارة» half-filled sends nothing — not even a new branch alone — and says what is missing', () => {
    // A branch-only move is «موظف» with nobody picked; in «إدارة» the three fields come first.
    expect(custody).toContain(
      'const departmentUnfinished = toDepartment && !departmentCustodianReady(department);',
    );
    expect(custody).toMatch(/&& !departmentUnfinished;/u);
    expect(custody).toMatch(
      /\{departmentUnfinished && \( <p role="note" data-transfer-department-unfinished [^>]*> \{t\('it\.custody\.department\.completeHolder'\)\} <\/p> \)\}/u,
    );
    expect(ar('it.custody.department.completeHolder')).toBe('حدِّد الإدارة والموقع والمسؤول.');
  });

  it('the department’s fields apply their own rules in ONE call — never two spreads of one render', () => {
    const fields = source('DepartmentCustodianFields.tsx');
    // One effect, one `onChange` from it: the preselection and the place let go together.
    expect(fields.match(/useEffect\(/gu)).toHaveLength(1);
    expect(fields).toContain(
      'const follow = custodianFollowUp({ value, picked: picked || filledFromDevice, preselect,',
    );
    // A department a memo's device filled in is left alone like one picked by hand.
    expect(issue).toContain(
      "filledFromDevice={ state.filledDepartmentId !== '' && state.filledDepartmentId === state.departmentId }",
    );
    expect(fields).toContain(
      'if (follow === null) return; if (follow.auto !== null) lastAuto.current = follow.auto; onChange(follow.next); }, [',
    );
    expect(fields.match(/onChange\(\{ \.\.\.value, (departmentId|locationId)\b/gu)).toEqual([
      'onChange({ ...value, departmentId',
      'onChange({ ...value, locationId',
    ]);
  });

  it('the issue sends the custodian, lists the department’s devices at its place, and waits for the signer', () => {
    expect(issue).toContain('...issueCustodianBody(state),');
    expect(issue).toContain('const ready = custodianReady(state) && lines.length > 0');
    expect(issue).toContain('const otherHolder = heldByOther(line, custodianKey(state));');
    expect(issue).toContain(
      "holderDepartmentId={ toDepartment && state.locationId !== '' ? state.departmentId : '' }",
    );
    expect(issue).toContain('branchId={memoBranch}');
  });
});
