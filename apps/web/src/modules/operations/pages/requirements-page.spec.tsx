// «كشف طاقم العمليات» after the legacy screen (Round 19).
//
// The owner: «عاوز احسن الui بتاع الشاشة دى دا كان القديم برضو القى نظره», with the legacy roster
// beside this one — «ابحث بال ID» | «ابحث بالاسم» | «اختر الوظيفة» | «حفظ», a dark-headed table of
// ID | الاسم | الوظيفة | the flags, every flag a round toggle, green with ✓ or grey. What has to hold,
// rendered from the page over a seeded roster and read from its source:
//
//   · the boards' look: the title in the toolbar with the figures over the rows shown, the hint a
//     line under the title, the one-row dark filter bar, the dark table, a pager for a long roster;
//   · Round 19b («يكون فيها الاسم بتاع القائد فى الاول وجمبه صغير كدا الكود … والفلاتر تكون ترتبيها
//     زى الجدول والغى السيرش بالكود خليه مكان واحد للاسم والكود سوا»): the PERSON first — the name,
//     which opens the member's card, with the code small beside it — then الوظيفة, then all ten
//     flags, «قائد» and «أخصائي» first; the filters in that order, one box for the name or code;
//   · each flag a `switch` with its state and a name that says which flag of whom — pressable only
//     with the plan grant (today's rule), and said so to a reader without it;
//   · the filters read from the address (remembered as the boards' are) narrow the rows and the
//     figures alike;
//   · a save is ONE press over every tick waiting, built by the pure rules, and leaving with ticks
//     waiting asks first.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type MeDto,
  type OperationsCrewDirectoryDto,
  type OperationsCrewMemberDto,
  type OperationsCrewRequirementsDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { formatNumber } from '../../../shared/lib/format';
import { pluralKey } from '../../../shared/lib/plural';
import { listKey } from '../../../shared/lib/query-keys';
import { REQUIREMENT_FLAGS } from '../lib/requirements';
import { RequirementsPage } from './RequirementsPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
/** A figure as the Arabic page prints it — in Arabic-Indic digits. */
const n = (value: number): string => formatNumber(value, 'ar');

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
    external: null,
    flags: {},
    totpEnabled: true,
  }) as unknown as MeDto;

const HEAD = { id: 'jt-head', name: { ar: 'رئيس قسم تشغيل نقل الاموال', en: 'Head of operations' } };
const SENIOR = { id: 'jt-senior', name: { ar: 'اخصائى اول نقل اموال', en: 'Senior specialist' } };

const flags = (
  employeeId: string,
  over: Partial<OperationsCrewRequirementsDto>,
): OperationsCrewRequirementsDto => ({
  id: `r-${employeeId}`,
  employeeId,
  isCaptain: false,
  isSpecialist: false,
  hasWeapon: false,
  hasSignature: false,
  hasLicense: false,
  hasTemporaryLicense: false,
  isOpsAdmin: false,
  isNewJoiner: false,
  isAssignedSpecialTask: false,
  isPriority: false,
  notes: null,
  version: 0,
  createdAt: '',
  updatedAt: '',
  ...over,
});

const member = (
  employeeId: string,
  code: string,
  fullNameAr: string,
  over: Partial<OperationsCrewMemberDto> = {},
): OperationsCrewMemberDto => ({
  employeeId,
  code,
  fullNameAr,
  status: 'active',
  jobTitle: null,
  phone: null,
  branchId: null,
  requirements: null,
  assignedVehicleId: null,
  ...over,
});

// The legacy screen's own rows — its codes, names and titles.
const AYMAN = member('e-07', '0100007', 'ايمن اسماعيل عبد العظيم رافع', {
  jobTitle: HEAD,
  requirements: flags('e-07', { isCaptain: true }),
});
const MAHMOUD = member('e-18', '0100018', 'محمود محمد محمود محمد اسد', {
  jobTitle: SENIOR,
  requirements: flags('e-18', { isCaptain: true, hasWeapon: true, hasSignature: true, hasLicense: true }),
});
const AHMED = member('e-35', '0100035', 'احمد سيد محمود محمود', {
  jobTitle: SENIOR,
  requirements: flags('e-35', { isSpecialist: true, hasLicense: true }),
});
const NEWCOMER = member('e-64', '0300064', 'عبد الغنى ظهير محمد');

const ROSTER: OperationsCrewDirectoryDto = {
  date: '2026-11-15',
  // The server's order (captains first) — the screen runs by code.
  members: [MAHMOUD, AYMAN, AHMED, NEWCOMER],
  rosterIsDerived: true,
};

const render = ({
  permissions = ['operationsCrew.view', 'operationsCrew.plan'],
  roster = ROSTER,
  path = '/operations/requirements',
}: {
  permissions?: string[];
  roster?: OperationsCrewDirectoryDto;
  path?: string;
} = {}): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as const, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'dark' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  // The roster read every crew screen shares: no day (`null` → the 'tomorrow' key).
  qc.setQueryData(listKey('operations', 'crewDirectory', { date: 'tomorrow' }), roster);
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <RequirementsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const text = (html: string): string => html.replace(/<[^>]+>/g, '').trim();
const headers = (html: string): string[] =>
  [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1] as string));
const switches = (html: string): string[] =>
  [...html.matchAll(/<button\b[^>]*role="switch"[^>]*>/g)].map((m) => m[0]);
/** The rows' codes, in the order the table prints them. */
const codes = (html: string): string[] =>
  [...html.matchAll(/<tbody[\s\S]*<\/tbody>/g)]
    .flatMap((m) => [...m[0].matchAll(/dir="ltr"[^>]*>(\d{7})</g)])
    .map((m) => m[1] as string);
const figure = (html: string, name: string): string => {
  const start = html.indexOf(`data-figure="${name}"`);
  return text(html.slice(start, html.indexOf('</span></span>', start) + 14).replace(/^[^>]*>/, ''));
};

describe('«كشف طاقم العمليات» — the legacy roster in the boards’ look', () => {
  it('titles the page in its toolbar, the hint a line under the title rather than a card', () => {
    const html = render();
    expect(html).toMatch(/<h1[^>]*>كشف طاقم العمليات<\/h1>/);
    const hint = html.slice(html.indexOf('data-requirements-hint'));
    expect(hint.slice(0, hint.indexOf('</p>'))).toContain(ar('operations.crew.requirements.notAGate'));
    expect(html).toContain('data-requirements-toolbar="true"');
    expect(html).toContain('data-requirements-filters="true"');
  });

  it('draws the person (الاسم) | الوظيفة, then all ten flags — «قائد» and «أخصائي» first, legacy wording', () => {
    expect(headers(render())).toEqual([
      'الاسم',
      'الوظيفة',
      'قائد',
      'أخصائي',
      'سلاح',
      'صحة التوقيع',
      'مزاولة المهنة',
      'مزاولة مؤقتة',
      'موظف عمليات',
      'جديد',
      'مهمة خاصة',
      'أولوية',
    ]);
  });

  it('prints each member’s code, name and job title, the rows by code as legacy ran by ID', () => {
    const html = render();
    expect(codes(html)).toEqual(['0100007', '0100018', '0100035', '0300064']);
    expect(html).toContain(HEAD.name.ar);
    expect(html).toContain(SENIOR.name.ar);
    expect(html).toContain('ايمن اسماعيل عبد العظيم رافع');
  });

  it('starts each row with the person: the name — the card’s trigger — then the code, small, beside it', () => {
    const html = render();
    const firstCells = [...html.matchAll(/<tr\b[^>]*>\s*<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(
      (m) => m[1] as string,
    );
    expect(firstCells).toHaveLength(ROSTER.members.length);
    const ayman = firstCells.find((cell) => cell.includes('data-roster-person="0100007"')) ?? '';
    // The name first, reachable with Tab; the code after it in the same cell.
    expect(ayman.indexOf(AYMAN.fullNameAr)).toBeGreaterThan(-1);
    expect(ayman.indexOf('>0100007<')).toBeGreaterThan(ayman.indexOf(AYMAN.fullNameAr));
    const name = /<span\b[^>]*data-roster-hover="true"[^>]*>/.exec(ayman)?.[0] ?? '';
    expect(name).toContain('tabindex="0"');
    // The code: a figure in the boards' figures face (`NUM`), isolated left to right, small, muted.
    const code = /<span\b[^>]*data-roster-code="true"[^>]*>([^<]*)<\/span>/.exec(ayman);
    expect(code?.[1]).toBe('0100007');
    expect(code?.[0]).toContain('dir="ltr"');
    expect(code?.[0]).toContain('Azeret_Mono');
    expect(code?.[0]).toContain('tabular-nums');
    expect(code?.[0]).toContain('text-[11px]');
    expect(code?.[0]).toContain('text-slate-500');
    // No card is open until somebody hovers.
    expect(html).not.toContain('data-roster-card=');
  });

  it('draws every flag as a round switch with its state, named for the flag and the member', () => {
    const html = render();
    const all = switches(html);
    expect(all).toHaveLength(ROSTER.members.length * REQUIREMENT_FLAGS.length);
    const of = (flag: string, name: string): string | undefined =>
      all.find((tag) => tag.includes(`aria-label="${ar(`operations.crew.flag.${flag}`)} — ${name}"`));
    expect(of('isCaptain', AYMAN.fullNameAr)).toContain('aria-checked="true"');
    expect(of('hasWeapon', AYMAN.fullNameAr)).toContain('aria-checked="false"');
    expect(of('hasWeapon', MAHMOUD.fullNameAr)).toContain('aria-checked="true"');
    // A member with no row yet shows every flag off — nothing recorded.
    for (const flag of REQUIREMENT_FLAGS) {
      expect(of(flag, NEWCOMER.fullNameAr)).toContain('aria-checked="false"');
    }
    // A button: reached by Tab, pressed by Space or Enter — and nothing is ringed as waiting yet.
    expect(all.every((tag) => tag.includes('type="button"'))).toBe(true);
    expect(html).not.toContain('data-roster-pending');
  });

  it('counts the rows shown in the toolbar: members, captains, specialists', () => {
    const html = render();
    expect(figure(html, 'members')).toContain(n(4));
    expect(figure(html, 'captains')).toContain(n(2));
    expect(figure(html, 'specialists')).toContain(n(1));
    expect(figure(html, 'members')).toContain(ar('operations.crew.requirements.figures.members'));
  });

  it('gives a planner «تراجع» and «حفظ (0)», both idle while no tick waits, and every switch live', () => {
    const html = render();
    const save = html.slice(html.indexOf('data-requirements-save='));
    expect(save.slice(0, save.indexOf('>'))).toContain('disabled=""');
    expect(html).toContain('data-requirements-save="0"');
    expect(html).toContain(ar('operations.crew.requirements.save', { count: n(0) }));
    expect(html).toContain(ar('operations.crew.requirements.discard'));
    expect(switches(html).some((tag) => tag.includes('disabled=""'))).toBe(false);
    expect(html).not.toContain('data-requirements-readonly');
  });

  it('shows a reader without the plan grant every flag, presses none, and says why', () => {
    const html = render({ permissions: ['operationsCrew.view'] });
    const all = switches(html);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((tag) => tag.includes('disabled=""'))).toBe(true);
    expect(html).not.toContain('data-requirements-save');
    expect(html).not.toContain('data-requirements-discard');
    expect(html).toContain('data-requirements-readonly="true"');
    expect(html).toContain(ar('operations.crew.requirements.readOnly'));
  });

  it('narrows by the filters in the address — «الوظيفة» and «يحمل» — and the figures with them', () => {
    const html = render({
      path: `/operations/requirements?job=${SENIOR.id}&flags=isCaptain`,
    });
    expect(codes(html)).toEqual(['0100018']);
    // n / total: what the filters left, of the whole roster.
    expect(figure(html, 'members')).toContain(`${n(1)} / ${n(4)}`);
    expect(figure(html, 'captains')).toContain(n(1));
    // The chosen title and flag are named in their boxes.
    const bar = html.slice(html.indexOf('data-requirements-filters'), html.indexOf('data-requirements-table'));
    expect(bar).toContain(SENIOR.name.ar);
    expect(bar).toContain(ar('operations.crew.flag.isCaptain'));
  });

  it('finds a code and a folded name typed into the ONE box', () => {
    expect(codes(render({ path: '/operations/requirements?q=0035' }))).toEqual(['0100035']);
    // Either keyboard's digits.
    expect(codes(render({ path: `/operations/requirements?q=${encodeURIComponent('٠٠٣٥')}` }))).toEqual([
      '0100035',
    ]);
    // «عبد الغني» finds «عبد الغنى»; «إيمن» is not a spelling anybody has.
    expect(codes(render({ path: '/operations/requirements?q=عبد%20الغني' }))).toEqual(['0300064']);
    // The box says what it holds.
    const box = /<input\b[^>]*data-requirements-search="true"[^>]*>/.exec(
      render({ path: '/operations/requirements?q=0035' }),
    )?.[0];
    expect(box).toContain('value="0035"');
  });

  it('opens a view remembered with the two old boxes on their text in the one', () => {
    // A link or a remembered view from before Round 19b: the code typed, or the name.
    expect(codes(render({ path: '/operations/requirements?code=0035' }))).toEqual(['0100035']);
    expect(codes(render({ path: '/operations/requirements?name=عبد%20الغني' }))).toEqual([
      '0300064',
    ]);
    const box = /<input\b[^>]*data-requirements-search="true"[^>]*>/.exec(
      render({ path: '/operations/requirements?code=0035' }),
    )?.[0];
    expect(box).toContain('value="0035"');
  });

  it('puts the filters in the columns’ order: «الاسم أو الكود», «الوظيفة», «يحمل» — and no code box', () => {
    const html = render();
    const bar = html.slice(html.indexOf('data-requirements-filters'), html.indexOf('data-requirements-table'));
    const at = (needle: string): number => bar.indexOf(needle);
    const search = at(`placeholder="${ar('operations.crew.requirements.search')}"`);
    const job = at(ar('operations.crew.requirements.jobTitle'));
    const holds = at(ar('operations.crew.requirements.holds'));
    expect(search).toBeGreaterThan(-1);
    expect(job).toBeGreaterThan(search);
    expect(holds).toBeGreaterThan(job);
    expect(ar('operations.crew.requirements.search')).toBe('الاسم أو الكود');
    // ONE text box: the code's own box, and its digits-only keyboard, are gone.
    expect(bar.match(/<input\b/g)).toHaveLength(1);
    expect(bar).not.toContain('inputMode="numeric"');
    expect(bar).not.toContain('inputmode="numeric"');
    expect(translate('ar', 'operations.crew.requirements.searchCode')).toBe(
      'operations.crew.requirements.searchCode',
    );
    expect(translate('ar', 'operations.crew.requirements.searchName')).toBe(
      'operations.crew.requirements.searchName',
    );
  });

  it('says nobody matches — not that the roster is empty — when the filters leave nobody', () => {
    const html = render({ path: '/operations/requirements?q=999' });
    expect(html).toContain(ar('operations.crew.requirements.noMatch'));
    expect(html).not.toContain(ar('operations.crew.requirements.empty'));
  });

  it('offers «بلا وظيفة مسجَّلة» among the titles only when somebody has none', () => {
    expect(ar('operations.crew.requirements.noJobTitle')).toBe('بلا وظيفة مسجَّلة');
    const html = render({ path: '/operations/requirements?job=none' });
    expect(codes(html)).toEqual(['0300064']);
    expect(html).toContain(ar('operations.crew.requirements.noJobTitle'));
  });

  it('pages a roster longer than the smallest page with the boards’ pager — and not a short one', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      member(`m-${String(i)}`, `01${String(i).padStart(5, '0')}`, `فرد ${String(i)}`),
    );
    expect(render({ roster: { ...ROSTER, members: many } })).toContain(
      'data-requirements-pager="true"',
    );
    expect(render()).not.toContain('data-requirements-pager');
  });
});

// ── Source pins — what the screen is built from ────────────────────────────────────────────────

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const PAGE = read('./RequirementsPage.tsx');
const QUERIES = read('../api/operations-queries.ts');
const TOGGLE = read('../components/RosterFlagToggle.tsx');

describe('what the screen is built from', () => {
  it('saves every tick waiting in ONE press, built by the pure rules, and keeps what was refused', () => {
    expect(PAGE).toContain('useSaveCrewRequirementsBatch()');
    expect(PAGE).toContain('pendingRows(members, pending)');
    expect(PAGE).toContain('save.mutateAsync(toSaveRequests(waiting))');
    expect(PAGE).toContain('keepUnsaved(current, failed)');
    expect(PAGE).toContain('togglePending(current, row, flag)');
    // The per-tick save is gone: a press only marks the cell.
    expect(PAGE).not.toContain('useSetCrewRequirements');
    // One row after another through the roster's own PUT, the roster re-read once at the end.
    const hook = QUERIES.slice(QUERIES.indexOf('export const useSaveCrewRequirementsBatch'));
    const body = hook.slice(0, hook.indexOf('\n};'));
    expect(body).toContain('saveRowsInTurn(requests, api.setCrewRequirements)');
    expect(body).toContain('onSettled: invalidate');
  });

  it('asks before leaving with ticks waiting, and «تراجع» drops them', () => {
    expect(PAGE).toContain('useUnsavedGuard({ dirty })');
    expect(PAGE).toContain('open={guard.leaveOpen}');
    expect(PAGE).toContain(
      "t(pluralKey('operations.crew.requirements.leaveBody', locale, waitingCells)",
    );
    expect(PAGE).toContain('setPending(NO_PENDING)');
  });

  it('counts the waiting changes in the leave dialog in their Arabic form — not «٧ تعديل»', () => {
    const leave = (count: number): string =>
      translate('ar', pluralKey('operations.crew.requirements.leaveBody', 'ar', count), {
        count: String(count),
      });
    expect([1, 2, 7, 11, 100].map(leave)).toEqual([
      'في الكشف تعديل واحد لم يُحفظ. هل تريد المغادرة دون حفظ؟',
      'في الكشف تعديلان لم يُحفظا. هل تريد المغادرة دون حفظ؟',
      'في الكشف 7 تعديلات لم تُحفظ. هل تريد المغادرة دون حفظ؟',
      'في الكشف 11 تعديلًا لم يُحفظ. هل تريد المغادرة دون حفظ؟',
      'في الكشف 100 تعديل لم يُحفظ. هل تريد المغادرة دون حفظ؟',
    ]);
    expect(translate('en', pluralKey('operations.crew.requirements.leaveBody', 'en', 1))).toBe(
      'The roster has 1 unsaved change. Leave without saving?',
    );
    // The single-form key a screen once asked for is gone.
    expect(translate('ar', 'operations.crew.requirements.leaveBody')).toBe(
      'operations.crew.requirements.leaveBody',
    );
  });

  it('answers one press with ONE toast — success, error, or a warning naming both', () => {
    const save = PAGE.slice(PAGE.indexOf('const onSave'), PAGE.indexOf('// ── The rows'));
    expect(save).toContain('if (failed.size === 0) toast.success(savedText);');
    expect(save).toContain('else if (saved === 0) toast.error(notSavedText);');
    expect(save).toContain('else toast.warning(savedText, notSavedText);');
    expect(save.match(/toast\.\w+\(/g)).toHaveLength(3);
  });

  it('presses a flag only with the plan grant — today’s rule — and never while a save runs', () => {
    expect(PAGE).toContain("const canPlan = can('operationsCrew.plan');");
    expect(PAGE).toContain('disabled={!canPlan || save.isPending}');
  });

  it('draws the flag as a switch that says its state', () => {
    expect(TOGGLE).toContain('role="switch"');
    expect(TOGGLE).toContain('aria-checked={on}');
    expect(TOGGLE).toContain('aria-label={label}');
    expect(TOGGLE).toContain('type="button"');
  });

  it('remembers its three filters, and reads no day', () => {
    expect(PAGE).toContain("const REMEMBERED_FILTERS = ['q', 'job', 'flags'] as const;");
    expect(PAGE).toContain('useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);');
    expect(PAGE).toContain('useOperationsCrewDirectory(null)');
    expect(PAGE).not.toContain("sp.get('date')");
  });

  it('takes the two old boxes off the address once their text is in the one — replacing, not pushing', () => {
    const fold = PAGE.slice(PAGE.indexOf('useEffect(() => {'));
    const body = fold.slice(0, fold.indexOf('}, ['));
    expect(body).toContain("next.delete('code');");
    expect(body).toContain("next.delete('name');");
    expect(body).toContain('searchFromOldBoxes(oldCode, oldName)');
    // A `q` already on the address wins over what the old boxes said.
    expect(body).toContain("if (!next.has('q') && folded !== '') next.set('q', folded);");
    expect(body).toContain('setSp(next, { replace: true });');
  });

  it('opens the member’s card from the name, on the shared hover-card mechanics', () => {
    expect(PAGE).toContain('<RosterMemberHoverName member={row} className={NAME_WRAP} />');
    const CARD = read('../components/RosterMemberCard.tsx');
    expect(CARD).toContain("from '../../fleet/components/HoverCardLayer'");
    expect(CARD).toContain('useHoverCard(true)');
    expect(CARD).toContain('mark="roster"');
    expect(CARD).toContain("mayReadCrew={can('operationsCrew.view')}");
    // The captain card's own head, figures and branch naming — one look for every person card.
    expect(CARD).toContain("from './BoardCrewCards'");
  });
});
