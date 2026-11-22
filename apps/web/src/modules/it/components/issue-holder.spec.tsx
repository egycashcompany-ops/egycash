// «صرف لموظف» (2026-11-17) — «لما أكتب اسم الشخص اللى هسلمه تظهر الأجهزة اللى معاه بس .. والعكس
// بردو .. لو كتبت سيرال فى الجهاز اللى هيتركب عليه المستهلك .. تظهر على طول الشخص اللى مستلم الجهاز».
//
// The dialog as it renders in each state the user can bring it to, against a mocked `it-api`: the
// web suite has no DOM to click in (`vitest.config.ts`), so each test opens the dialog on the state
// a click leads to — the dialog's OWN reducer applied to the event — renders it, answers the
// requests the render made through the query cache, and renders again. The rules between the
// states are `lib/consumable-issue-holder.spec.ts`; the browser walk clicks through them for real.
//
// And the picker every other screen uses: a caller passing none of the new props gets exactly the
// request and the rows it always had.
//
// «جهاز آخر» and the review's three fixes (2026-11-17): the picker's switch to the whole register
// is internal state no static render can click, so its decisions are pure helpers proven here
// (`pickerRequest`, `pickerRowFlags`, `pickerListShows`, and the dialog's `holderAnswer`), and the
// few lines that WIRE them — the row's `onChange(asset.id, asset)`, the dialog's two dispatches,
// its effect, the switch's two buttons — are pinned in the source, as (g) pins the box's props.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type ItAssetDto,
  type ItConsumableDto,
  type ItPersonDto,
  type Locale,
  type MeDto,
  type Paginated,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { detailKey, listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import * as api from '../api/it-api';
import type * as HolderRules from '../lib/consumable-issue-holder';
import {
  type IssueDeviceLine,
  type IssueHolderEvent,
  type IssueHolderState,
} from '../lib/consumable-issue-holder';
import {
  AssetPicker,
  AssetPickerRow,
  pickerHolderKey,
  pickerHolderWords,
  pickerListShows,
  pickerRequest,
  pickerRowFlags,
} from './AssetPicker';
import { IssueConsumablesDialog } from './ConsumableDialogs';
import { NO_DEPARTMENT } from '../custody-holder-fixtures';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

vi.mock('../api/it-api', async (actual) => ({
  ...(await actual<typeof api>()),
  listAssets: vi.fn(),
  getPerson: vi.fn(),
}));
const listAssets = vi.mocked(api.listAssets);
const getPerson = vi.mocked(api.getPerson);

/**
 * Where the dialog opens: by default empty, as it always does; a test sets the events a user's
 * clicks would have sent, and the dialog opens on what its own reducer makes of them.
 */
const opening = vi.hoisted(() => ({ events: [] as unknown[] }));
vi.mock('../lib/consumable-issue-holder', async (actual) => {
  const real = await actual<typeof HolderRules>();
  return {
    ...real,
    issueHolderStart: <L extends IssueDeviceLine>(lines: L[]): IssueHolderState<L> =>
      (opening.events as IssueHolderEvent<L>[]).reduce(
        real.issueHolderReducer<L>,
        real.issueHolderStart(lines),
      ),
  };
});

afterEach(() => {
  opening.events = [];
  listAssets.mockReset();
  getPerson.mockReset();
});

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

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

/** The store's keeper who also reads the assets — the one «مركّب على» is offered to. */
const KEEPER = [
  'itConsumable.view',
  'itConsumable.create',
  'itConsumable.edit',
  'itConsumable.assign',
  'itAsset.view',
];

const WALEED = '64b000000000000000000001';
const SHERIF = '64b000000000000000000002';
/** A third person, whose device is picked through «جهاز آخر». */
const HANY = '64b000000000000000000003';
const WALEED_LABEL = 'وليد صفوت جلال (0100052)';
const SHERIF_LABEL = 'شريف ممدوح فاروق (0100077)';

const person = (over: Partial<ItPersonDto> = {}): ItPersonDto => ({
  employeeId: WALEED,
  code: '0100052',
  fullNameAr: 'وليد صفوت جلال',
  status: 'active',
  branchId: 'b-hq',
  departmentId: null,
  jobTitleId: null,
  hiredAt: '2020-01-01',
  exitedAt: null,
  userId: null,
  openCustodyCount: 2,
  ...over,
});

const asset = (over: Partial<ItAssetDto>): ItAssetDto =>
  ({
    id: 'a-1',
    assetCode: 'AST-00001',
    name: 'Lenovo ThinkCentre AIO',
    status: 'assigned',
    serialNumber: 'PF3K9ZQ1',
    branchId: 'b-hq',
    holder: {
      employeeId: WALEED,
      employeeCode: '0100052',
      employeeName: 'وليد صفوت جلال',
      assignedAt: '2026-10-01T08:00:00.000Z',
    },
    hasActiveMaintenance: false,
    ...over,
  }) as ItAssetDto;

const LAPTOP = asset({});
const SCREEN = asset({
  id: 'a-2',
  assetCode: 'AST-00002',
  name: 'Samsung 24" Monitor',
  serialNumber: 'ZX7710-B',
});
const SHERIFS = asset({
  id: 'a-3',
  assetCode: 'AST-00003',
  name: 'HP ProBook 450 G8',
  serialNumber: '5CD1234XYZ',
  holder: {
    kind: 'employee',
    ...NO_DEPARTMENT,
    employeeId: SHERIF,
    employeeCode: '0100077',
    employeeName: 'شريف ممدوح فاروق',
    assignedAt: '2026-10-01T08:00:00.000Z',
  },
});
const HANYS = asset({
  id: 'a-5',
  assetCode: 'AST-00005',
  name: 'HP LaserJet Pro M404',
  serialNumber: 'PHBQ7K21',
  holder: {
    kind: 'employee',
    ...NO_DEPARTMENT,
    employeeId: HANY,
    employeeCode: '0100091',
    employeeName: 'هاني رأفت سليم',
    assignedAt: '2026-09-01T08:00:00.000Z',
  },
});
const IN_STOCK = asset({
  id: 'a-4',
  assetCode: 'AST-00004',
  name: 'Canon LBP 6030',
  status: 'inStock',
  serialNumber: 'CN-55821',
  holder: null,
});

const page = (items: ItAssetDto[]): Paginated<ItAssetDto> => ({
  items,
  meta: { page: 1, pageSize: 50, totalItems: items.length, totalPages: 1 },
});

const item: ItConsumableDto = {
  id: 'c-1',
  code: 'CON-00004',
  name: 'Mouse',
  typeId: 'ty-mice',
  unit: 'قطعة',
  branchId: 'b-hq',
  minQty: 5,
  notes: null,
  active: true,
  onHandQty: 13,
  issuedQty: 4,
  scrappedQty: 1,
  belowMin: false,
  version: 0,
  createdAt: '2026-10-28T09:00:00.000Z',
  updatedAt: '2026-10-28T09:00:00.000Z',
};

/**
 * `retryOnMount: false` keeps a FAILED request failed on the next render — otherwise a render reads
 * it as being asked again, which is what a browser mounting the box anew would do.
 */
const client = (retryOnMount = true): QueryClient => {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnMount: false, retryOnMount },
    },
  });
  qc.setQueryData(listKey('it', 'branchOptions'), [
    { id: 'b-hq', code: '01', name: { ar: 'المهندسين', en: 'HQ' }, parentId: null },
  ]);
  return qc;
};

const render = (qc: QueryClient, element: JSX.Element, permissions = KEEPER): string => {
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
        <MemoryRouter>{element}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const dialog = (qc: QueryClient): string =>
  render(qc, <IssueConsumablesDialog open onClose={() => {}} item={item} />);

/** The dialog's first line is key 0 (`blankLine(0, item)`), a second one added is key 1. */
const choose = (employeeId: string, label: string): IssueHolderEvent<IssueDeviceLine> => ({
  type: 'person',
  employeeId,
  label,
});
const pick = (key: number, device: ItAssetDto | null): IssueHolderEvent<IssueDeviceLine> => ({
  type: 'device',
  key,
  assetId: device?.id ?? '',
  asset: device,
});
/** «إضافة صنف»: another line, as the dialog's `blankLine` makes it. */
const addLine = (key: number): IssueHolderEvent<IssueDeviceLine> => ({
  type: 'add',
  line: { key, consumable: null, qty: '1', reason: 'new', assetId: '', asset: null } as never,
});

/** The holder's devices query a person's box makes — the holder filter in its key. */
const heldBy = (employeeId: string): readonly unknown[] =>
  listKey('it', 'assets', { picker: '', status: undefined, holderEmployeeId: employeeId });

/** Answers, through the cache, the request a render made — what the browser would have sent. */
const answer = async (qc: QueryClient, key: readonly unknown[]): Promise<void> => {
  const query = qc.getQueryCache().find({ queryKey: key, exact: true });
  expect(query, `the render asked for ${JSON.stringify(key)}`).toBeDefined();
  await query?.fetch();
};

const dataAttr = (html: string, name: string): string[] =>
  [...html.matchAll(new RegExp(`${name}="([^"]*)"`, 'gu'))].map((m) => m[1] ?? '');

describe('the person first — «مركّب على» lists only their devices', () => {
  it('(a) asks for the devices the person holds and lists them at once, without typing', async () => {
    listAssets.mockImplementation((params) =>
      Promise.resolve(
        page(params['holderEmployeeId'] === WALEED ? [LAPTOP, SCREEN] : [LAPTOP, SCREEN, SHERIFS]),
      ),
    );
    opening.events = [choose(WALEED, WALEED_LABEL)];
    const qc = client();

    const before = dialog(qc);
    // Whose devices these are, above the list — and the box asks before a word is typed.
    expect(before).toContain(ar('it.assets.pickerHolderHint', { name: WALEED_LABEL }));
    await answer(qc, heldBy(WALEED));
    expect(listAssets).toHaveBeenCalledTimes(1);
    expect(listAssets.mock.calls[0]?.[0]).toEqual({ holderEmployeeId: WALEED, pageSize: 50 });

    const html = dialog(qc);
    expect(html).toContain(LAPTOP.assetCode);
    expect(html).toContain(SCREEN.assetCode);
    expect(html).not.toContain(SHERIFS.assetCode);
    // Each row: the name, the code and the serial — the person's own list says no holder.
    expect(dataAttr(html, 'data-asset-serial')).toEqual(['PF3K9ZQ1', 'ZX7710-B']);
    expect(html).not.toContain('data-asset-holder');
    // Nothing picked for the user, not even from a list of their devices.
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain('aria-pressed="true"');
    // …and under them, «جهاز آخر»: the whole register, a click away.
    expect(dataAttr(html, 'data-asset-picker-toggle')).toEqual(['other']);
    expect(html).toContain(ar('it.assets.pickerOther'));
    expect(html.indexOf(ar('it.assets.pickerOther'))).toBeGreaterThan(
      html.indexOf(SCREEN.assetCode),
    );
  });

  it('(b) a person who holds nothing: the box says so, and the field stays empty', async () => {
    listAssets.mockResolvedValue(page([]));
    opening.events = [choose(SHERIF, SHERIF_LABEL)];
    const qc = client();
    dialog(qc);
    await answer(qc, heldBy(SHERIF));
    const html = dialog(qc);
    expect(html).toContain(ar('it.assets.pickerHolderNone', { name: SHERIF_LABEL }));
    expect(html).not.toContain(ar('it.assets.pickerNoResults'));
    expect(html).not.toContain('aria-pressed');
  });

  it('(e) changing the person clears a line’s device they do not hold, and says so once', () => {
    listAssets.mockResolvedValue(page([]));
    opening.events = [choose(WALEED, WALEED_LABEL), pick(0, LAPTOP), choose(SHERIF, SHERIF_LABEL)];
    const qc = client();
    const html = dialog(qc);
    expect(html).toContain(SHERIF_LABEL);
    expect(html).toContain(ar('it.consumables.issue.deviceCleared', { lines: '١' }));
    expect(dataAttr(html, 'data-issue-devices-cleared')).toEqual(['1']);
    // The line's box is empty again, and lists Sherif's devices now.
    expect(html).not.toContain(ar('it.assets.clearPick'));
    expect(html).toContain(ar('it.assets.pickerHolderHint', { name: SHERIF_LABEL }));
  });

  it('(h) changing the person keeps a device they hold, one in stock, and a third person’s', () => {
    listAssets.mockResolvedValue(page([]));
    // Waleed chosen: line 1 his own, line 2 Hany's printer through «جهاز آخر», line 3 one in stock.
    const chosen = [
      choose(WALEED, WALEED_LABEL),
      addLine(1),
      addLine(2),
      pick(0, LAPTOP),
      pick(1, HANYS),
      pick(2, IN_STOCK),
    ];
    opening.events = chosen;
    const qc = client();
    for (const device of [LAPTOP, HANYS, IN_STOCK, SHERIFS]) {
      qc.setQueryData(detailKey('it', 'assets', device.id), device);
    }
    const before = dialog(qc);
    // A third person's device never changes the person; its line says whose it is.
    expect(before).toContain(WALEED_LABEL);
    expect(dataAttr(before, 'data-issue-line-holder')).toEqual([HANY]);
    expect(before).toContain(
      ar('it.consumables.issue.deviceHeldByOther', { name: 'هاني رأفت سليم (0100091)' }),
    );
    expect(getPerson).not.toHaveBeenCalled();

    opening.events = [...chosen, choose(SHERIF, SHERIF_LABEL)];
    const html = dialog(qc);
    expect(html).toContain(SHERIF_LABEL);
    // Only Waleed's laptop went, and the one message says so.
    expect(dataAttr(html, 'data-issue-devices-cleared')).toEqual(['1']);
    expect(html).toContain(ar('it.consumables.issue.deviceCleared', { lines: '١' }));
    expect(html).not.toContain(`${LAPTOP.assetCode} — ${LAPTOP.name}`);
    expect(html).toContain(`${HANYS.assetCode} — ${HANYS.name}`);
    expect(html).toContain(`${IN_STOCK.assetCode} — ${IN_STOCK.name}`);
    expect(dataAttr(html, 'data-issue-line-holder')).toEqual([HANY]);

    // Sherif's own device, picked through «جهاز آخر» while Waleed was chosen, stays too — and
    // says nothing once he is the one receiving.
    opening.events = [choose(WALEED, WALEED_LABEL), pick(0, SHERIFS), choose(SHERIF, SHERIF_LABEL)];
    const his = dialog(qc);
    expect(his).toContain(`${SHERIFS.assetCode} — ${SHERIFS.name}`);
    expect(his).not.toContain('data-issue-devices-cleared');
    expect(his).not.toContain('data-issue-line-holder');
  });

  it('clearing the person keeps the device, and the box searches the whole register again', () => {
    opening.events = [choose(WALEED, WALEED_LABEL), pick(0, LAPTOP), choose('', '')];
    const qc = client();
    qc.setQueryData(detailKey('it', 'assets', LAPTOP.id), LAPTOP);
    const html = dialog(qc);
    expect(html).toContain(`${LAPTOP.assetCode} — ${LAPTOP.name}`);
    expect(html).not.toContain('data-asset-picker-holder');
    expect(html).not.toContain('data-issue-devices-cleared');
  });
});

describe('the device first — its holder fills the person', () => {
  it('(c) a held device reads its holder, and an employed one fills the person with the box’s label', async () => {
    getPerson.mockResolvedValue(person());
    opening.events = [pick(0, LAPTOP)];
    const qc = client();
    qc.setQueryData(detailKey('it', 'assets', LAPTOP.id), LAPTOP);

    const asking = dialog(qc);
    expect(asking).not.toContain(WALEED_LABEL);
    // The render asked who holds it — `/it/people/:id`.
    await answer(qc, detailKey('it', 'people', WALEED));
    expect(getPerson).toHaveBeenCalledWith(WALEED);

    // What the dialog does with the answer (its effect): hand it to the reducer.
    const read = qc.getQueryData<ItPersonDto>(detailKey('it', 'people', WALEED)) ?? null;
    opening.events = [
      pick(0, LAPTOP),
      {
        type: 'holderRead',
        question: { lineKey: 0, assetId: LAPTOP.id, employeeId: WALEED },
        person: read,
      },
    ];
    const html = dialog(qc);
    expect(html).toContain(WALEED_LABEL);
    expect(dataAttr(html, 'data-issue-holder-note')).toEqual(['filled']);
    expect(html).toContain(ar('it.consumables.issue.holderFilled', { n: '١' }));
    // …and the box now offers Waleed's devices.
    expect(html).toContain(ar('it.assets.pickerHolderHint', { name: WALEED_LABEL }));
  });

  it('(d) a holder who has left fills nothing — the note under the field says why', async () => {
    getPerson.mockResolvedValue(person({ status: 'exited', exitedAt: '2026-10-15' }));
    opening.events = [pick(0, LAPTOP)];
    const qc = client();
    dialog(qc);
    await answer(qc, detailKey('it', 'people', WALEED));
    const read = qc.getQueryData<ItPersonDto>(detailKey('it', 'people', WALEED)) ?? null;
    opening.events = [
      pick(0, LAPTOP),
      {
        type: 'holderRead',
        question: { lineKey: 0, assetId: LAPTOP.id, employeeId: WALEED },
        person: read,
      },
    ];
    const html = dialog(qc);
    expect(html).not.toContain(WALEED_LABEL);
    expect(html).not.toContain(ar('it.custody.clearPick'));
    expect(dataAttr(html, 'data-issue-holder-note')).toEqual(['exited']);
    expect(html).toContain(
      ar('it.consumables.issue.holderExited', { n: '١', name: 'وليد صفوت جلال' }),
    );
  });

  it('(f) a device in stock fills nothing, and asks nobody', () => {
    opening.events = [pick(0, IN_STOCK)];
    const qc = client();
    qc.setQueryData(detailKey('it', 'assets', IN_STOCK.id), IN_STOCK);
    const html = dialog(qc);
    expect(html).toContain(`${IN_STOCK.assetCode} — ${IN_STOCK.name}`);
    expect(html).not.toContain(ar('it.custody.clearPick'));
    expect(html).not.toContain('data-issue-holder-note');
    // The only person read on the dialog is the idle one, for nobody.
    const reads = qc.getQueryCache().findAll({ queryKey: ['it', 'people', 'detail'] });
    expect(reads.map((query) => query.queryKey[3])).toEqual(['']);
    expect(getPerson).not.toHaveBeenCalled();
  });

  it('(g) a row of the register says the serial and who holds it', () => {
    const qc = client();
    const held = render(
      qc,
      <AssetPickerRow asset={LAPTOP} pressed={false} showSerial showHolder onPick={() => {}} />,
    );
    expect(held).toContain('PF3K9ZQ1');
    expect(held).toContain(ar('it.assets.pickerHeldBy', { name: 'وليد صفوت جلال' }));
    const stock = render(
      qc,
      <AssetPickerRow asset={IN_STOCK} pressed={false} showSerial showHolder onPick={() => {}} />,
    );
    expect(stock).toContain('CN-55821');
    expect(stock).toContain(ar('it.assets.status.inStock'));
    // …and the issue's box asks for exactly those rows, filtered by the person once chosen.
    const element = /<AssetPicker\b[\s\S]*?\/>/u.exec(source('components/ConsumableDialogs.tsx'));
    expect(element?.[0]).toMatch(/\bshowHolder\b/u);
    // The person — or, «صرف لإدارة» (2026-11-19), the department at its place — never the signer.
    expect(element?.[0]).toMatch(/\bholderEmployeeId=\{toDepartment \? '' : employeeId\}/u);
    expect(element?.[0]).toMatch(/\bholderLocationId=\{toDepartment \? state\.locationId : ''\}/u);
    expect(element?.[0]).toMatch(/\bholderLabel=\{custodianLabel\}/u);
    expect(element?.[0]).not.toMatch(/responsibleEmployeeId/u);
    expect(element?.[0]).toMatch(/\ballowOther\b/u);
  });
});

describe('«جهاز آخر» — the whole register from a person’s box', () => {
  const ask = (over: Partial<Parameters<typeof pickerRequest>[0]>) =>
    pickerRequest({
      holderEmployeeId: WALEED,
      allowOther: true,
      otherFor: null,
      search: '',
      status: undefined,
      ...over,
    });

  it('opened for the person: the whole register’s own request, asked once something is typed', () => {
    const other = ask({ otherFor: WALEED, search: 'CN-55' });
    const register = ask({ holderEmployeeId: '', allowOther: false, search: 'CN-55' });
    expect(other.mode).toBe('other');
    expect(register.mode).toBe('register');
    expect(other.queryKey).toEqual(register.queryKey);
    expect(other.queryKey).toEqual(listKey('it', 'assets', { picker: 'CN-55', status: undefined }));
    expect(other.params).toEqual({ search: 'CN-55', pageSize: 8 });
    expect(other.untyped).toBe(false);
  });

  it('their own devices otherwise — before it is opened, once the person changes, or where not allowed', () => {
    const own = ask({});
    expect(own.mode).toBe('holder');
    expect(own.queryKey).toEqual(heldBy(WALEED));
    expect(own.params).toEqual({ holderEmployeeId: WALEED, pageSize: 50 });
    expect(own.untyped).toBe(true);
    // Opened for Waleed, and the line's person is Sherif now: Sherif's devices.
    expect(ask({ holderEmployeeId: SHERIF, otherFor: WALEED }).mode).toBe('holder');
    // A caller that did not allow it never leaves the person's devices.
    expect(ask({ allowOther: false, otherFor: WALEED }).mode).toBe('holder');
    // Typed among them: the search is sent with the holder.
    expect(ask({ search: 'PF3' }).params).toEqual({
      holderEmployeeId: WALEED,
      pageSize: 50,
      search: 'PF3',
    });
  });

  it('the switch: «جهاز آخر» opens it for the person shown, «أجهزة الموظف فقط» closes it', () => {
    const code = flat(source('components/AssetPicker.tsx'));
    // Opened for the holder shown — the person, or (2026-11-19) the department at its place.
    expect(code).toMatch(
      /data-asset-picker-toggle="other" onClick=\{\(\) => setOtherFor\(holder\)\}/u,
    );
    expect(code).toMatch(
      /data-asset-picker-toggle="holder" onClick=\{\(\) => setOtherFor\(null\)\}/u,
    );
    expect(code).toMatch(
      /const holder = pickerHolderKey\(\{ holderEmployeeId, holderDepartmentId, holderLocationId \}\);/u,
    );
    expect(code).toMatch(
      /pickerRequest\(\{ holderEmployeeId, holderDepartmentId, holderLocationId, branchId, allowOther, otherFor, search, status, \}\)/u,
    );
  });

  // 2026-11-19 — a department's devices at its place, and a box narrowed to one branch.
  it('a department’s box: its devices at its place, listed at once; another place is another box', () => {
    const own = ask({ holderEmployeeId: '', holderDepartmentId: 'd-it', holderLocationId: 'l-1' });
    expect(own.mode).toBe('holder');
    expect(own.untyped).toBe(true);
    expect(own.params).toEqual({ holderDepartmentId: 'd-it', locationId: 'l-1', pageSize: 50 });
    const other = ask({
      holderEmployeeId: '',
      holderDepartmentId: 'd-it',
      holderLocationId: 'l-2',
    });
    expect(other.queryKey).not.toEqual(own.queryKey);
    // «جهاز آخر» is opened for the department at that place.
    expect(
      ask({
        holderEmployeeId: '',
        holderDepartmentId: 'd-it',
        holderLocationId: 'l-1',
        otherFor: pickerHolderKey({
          holderEmployeeId: '',
          holderDepartmentId: 'd-it',
          holderLocationId: 'l-1',
        }),
      }).mode,
    ).toBe('other');
    // A person wins over a department passed beside them.
    expect(ask({ holderDepartmentId: 'd-it', holderLocationId: 'l-1' }).params).toEqual({
      holderEmployeeId: WALEED,
      pageSize: 50,
    });
  });

  it('a box narrowed to a branch asks for that branch, in every mode', () => {
    expect(ask({ holderEmployeeId: '', branchId: 'b-asyut', search: 'Dell' }).params).toEqual({
      search: 'Dell',
      pageSize: 8,
      branchId: 'b-asyut',
    });
    expect(ask({ branchId: 'b-asyut' }).params).toMatchObject({ branchId: 'b-asyut' });
    expect(ask({ holderEmployeeId: '', search: 'Dell' }).params).toEqual({
      search: 'Dell',
      pageSize: 8,
    });
  });

  it('only a box that allows it offers it — and only with a person', async () => {
    listAssets.mockResolvedValue(page([LAPTOP]));
    const qc = client();
    const plain = <AssetPicker value="" holderEmployeeId={WALEED} onChange={() => {}} />;
    render(qc, plain);
    await answer(qc, heldBy(WALEED));
    const html = render(qc, plain);
    expect(html).toContain(LAPTOP.assetCode);
    expect(html).not.toContain('data-asset-picker-toggle');
    expect(html).not.toContain(ar('it.assets.pickerOther'));
    const nobody = render(qc, <AssetPicker value="" allowOther showHolder onChange={() => {}} />);
    expect(nobody).not.toContain('data-asset-picker-toggle');
  });
});

describe('a failed request is not an empty answer (review fix 1)', () => {
  it('a person’s list that failed says so, with a retry — never «لا يوجد في عهدة …»', async () => {
    listAssets.mockRejectedValue(new Error('offline'));
    const qc = client(false);
    const box = (
      <AssetPicker
        value=""
        holderEmployeeId={WALEED}
        holderLabel={WALEED_LABEL}
        allowOther
        onChange={() => {}}
      />
    );
    render(qc, box);
    await answer(qc, heldBy(WALEED)).catch(() => undefined);
    const html = render(qc, box);
    expect(dataAttr(html, 'data-asset-picker-error')).toEqual(['holderError']);
    expect(html).toContain(ar('it.assets.pickerHolderError', { name: WALEED_LABEL }));
    expect(html).toContain(ar('common.retry'));
    expect(html).not.toContain(ar('it.assets.pickerHolderNone', { name: WALEED_LABEL }));
    expect(html).not.toContain(ar('it.assets.pickerNoResults'));
    // «جهاز آخر» is still there to go round it.
    expect(html).toContain(ar('it.assets.pickerOther'));
    // The retry asks again.
    expect(flat(source('components/AssetPicker.tsx'))).toMatch(
      /onClick=\{\(\) => void results\.refetch\(\)\}/u,
    );
  });

  it('what the list shows: an error is an error, in either box; an empty answer is empty', () => {
    const shows = (over: Partial<Parameters<typeof pickerListShows>[0]>) =>
      pickerListShows({
        holderList: true,
        typed: false,
        isPending: false,
        isError: false,
        data: undefined,
        ...over,
      });
    expect(shows({ isPending: true })).toBe('loading');
    expect(shows({ isError: true })).toBe('holderError');
    expect(shows({ data: 0 })).toBe('holderNone');
    expect(shows({ data: 2 })).toBe('rows');
    // Typed among the person's devices, or in the whole register: a search.
    expect(shows({ typed: true, isError: true })).toBe('searchError');
    expect(shows({ holderList: false, typed: true, isError: true })).toBe('searchError');
    expect(shows({ holderList: false, typed: true, data: 0 })).toBe('noResults');
    expect(shows({ typed: true, data: 0 })).toBe('noResults');
    // A refresh that failed over an answer already held: that answer stands.
    expect(shows({ isError: true, data: 0 })).toBe('holderNone');
    expect(shows({ isError: true, data: 3 })).toBe('rows');
  });
});

// 2026-11-19 — a department's box (the issue's «مركّب على» in «إدارة», the installed-on dialog of a
// department's issue) speaks of the department, never of «الموظف».
describe('a department’s box says «الإدارة», not «الموظف»', () => {
  const heldByDepartment = listKey('it', 'assets', {
    picker: '',
    status: undefined,
    holderDepartmentId: 'd-it',
    holderLocationId: 'l-1',
  });
  const departmentBox = (
    <AssetPicker
      value=""
      holderEmployeeId=""
      holderDepartmentId="d-it"
      holderLocationId="l-1"
      showHolder
      allowOther
      onChange={() => {}}
    />
  );
  const EMPLOYEE_WORDS = [
    'it.assets.pickerHolderHintAnon',
    'it.assets.pickerHolderNoneAnon',
    'it.assets.pickerHolderErrorAnon',
    'it.assets.pickerHolderOnly',
  ];

  it('its words, and the way back from «جهاز آخر»: «أجهزة الإدارة فقط»', () => {
    const words = pickerHolderWords(ar, { holderEmployeeId: '', holderDepartmentId: 'd-it' });
    expect(words).toEqual({
      hint: 'الأجهزة التي في عهدة الإدارة المختارة الآن',
      none: ar('it.assets.pickerDepartmentNoneAnon'),
      error: ar('it.assets.pickerDepartmentErrorAnon'),
      only: 'أجهزة الإدارة فقط',
    });
    for (const key of EMPLOYEE_WORDS) expect(Object.values(words)).not.toContain(ar(key));
    // Named, it is named — the department at its place.
    const named = 'إدارة تقنية المعلومات — غرفة السيرفرات';
    expect(
      pickerHolderWords(ar, {
        holderEmployeeId: '',
        holderDepartmentId: 'd-it',
        holderLabel: named,
      }),
    ).toEqual({
      hint: ar('it.assets.pickerHolderHint', { name: named }),
      none: ar('it.assets.pickerHolderNone', { name: named }),
      error: ar('it.assets.pickerHolderError', { name: named }),
      only: 'أجهزة الإدارة فقط',
    });
  });

  it('a person’s box keeps the employee’s words — and a person wins over a department beside them', () => {
    const person = {
      hint: ar('it.assets.pickerHolderHintAnon'),
      none: ar('it.assets.pickerHolderNoneAnon'),
      error: ar('it.assets.pickerHolderErrorAnon'),
      only: ar('it.assets.pickerHolderOnly'),
    };
    expect(pickerHolderWords(ar, { holderEmployeeId: WALEED })).toEqual(person);
    expect(pickerHolderWords(ar, { holderEmployeeId: WALEED, holderDepartmentId: 'd-it' })).toEqual(
      person,
    );
  });

  it('renders them: the hint and the empty answer', async () => {
    listAssets.mockResolvedValue(page([]));
    const qc = client();
    render(qc, departmentBox);
    await answer(qc, heldByDepartment);
    const html = render(qc, departmentBox);
    expect(html).toContain(ar('it.assets.pickerDepartmentHintAnon'));
    expect(html).toContain(ar('it.assets.pickerDepartmentNoneAnon'));
    for (const key of EMPLOYEE_WORDS) expect(html).not.toContain(ar(key));
  });

  it('renders them: a list that failed', async () => {
    listAssets.mockRejectedValue(new Error('offline'));
    const qc = client(false);
    render(qc, departmentBox);
    await answer(qc, heldByDepartment).catch(() => undefined);
    const html = render(qc, departmentBox);
    expect(dataAttr(html, 'data-asset-picker-error')).toEqual(['holderError']);
    expect(html).toContain(ar('it.assets.pickerDepartmentErrorAnon'));
    for (const key of EMPLOYEE_WORDS) expect(html).not.toContain(ar(key));
  });

  it('the box says what the helper words — the way back included', () => {
    const code = flat(source('components/AssetPicker.tsx'));
    expect(code).toContain(
      'const words = pickerHolderWords(t, { holderEmployeeId, holderDepartmentId, holderLabel });',
    );
    expect(code).toContain("{other ? t('it.assets.pickerOtherHint') : words.hint}");
    expect(code).toContain(
      "{shows === 'searchError' ? t('it.assets.pickerSearchError') : words.error}",
    );
    expect(code).toMatch(
      /data-asset-picker-toggle="holder" onClick=\{\(\) => setOtherFor\(null\)\} > \{words\.only\}/u,
    );
    expect(code).toMatch(/shows === 'holderNone' \? \( <p [^>]*> \{words\.none\} <\/p>/u);
  });
});

describe('the row flags (review fix 3)', () => {
  it('neither new prop: neither fact — today’s row for every older caller', () => {
    expect(pickerRowFlags({ showHolder: false, byHolder: false })).toEqual({
      showSerial: false,
      showHolder: false,
    });
  });

  it('`showHolder` over the whole register: the serial and who holds it', () => {
    expect(pickerRowFlags({ showHolder: true, byHolder: false })).toEqual({
      showSerial: true,
      showHolder: true,
    });
  });

  it('a person’s own list: the serial, not the holder — every row there is theirs', () => {
    for (const showHolder of [true, false]) {
      expect(pickerRowFlags({ showHolder, byHolder: true })).toEqual({
        showSerial: true,
        showHolder: false,
      });
    }
  });

  it('«جهاز آخر» from it: the register again, so both', () => {
    for (const showHolder of [true, false]) {
      expect(pickerRowFlags({ showHolder, byHolder: true, other: true })).toEqual({
        showSerial: true,
        showHolder: true,
      });
    }
  });

  it('the rows are given exactly those flags', () => {
    const code = flat(source('components/AssetPicker.tsx'));
    expect(code).toMatch(/const flags = pickerRowFlags\(\{ showHolder, byHolder, other \}\);/u);
    expect(code).toMatch(/showSerial=\{flags\.showSerial\} showHolder=\{flags\.showHolder\}/u);
  });
});

describe('the wiring between the boxes and the reducer (review fix 2)', () => {
  /** The issue dialog's own source — the return dialog has an employee box of its own. */
  const issueDialog = (): string => {
    const code = flat(source('components/ConsumableDialogs.tsx'));
    const from = code.indexOf('export const IssueConsumablesDialog');
    const to = code.indexOf('export const TransferConsumablesDialog');
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    return code.slice(from, to);
  };

  it('a row picked hands over its id AND the row — the holder comes with it', () => {
    const code = flat(source('components/AssetPicker.tsx'));
    expect(code).toMatch(
      /onPick=\{\(\) => \{ onChange\(asset\.id, asset\); setSearch\(''\); \}\}/u,
    );
  });

  it('the line’s box dispatches the device with the row it came from', () => {
    const element = /<AssetPicker\b[\s\S]*?\/>/u.exec(issueDialog());
    expect(element?.[0]).toMatch(
      /onChange=\{\(assetId, asset\) => dispatch\(\{ type: 'device', key: line\.key, assetId, asset: asset \?\? null,? \}\),? \}/u,
    );
  });

  it('the employee box dispatches the person with its label', () => {
    const element = /<EmployeePicker\b[\s\S]*?\/>/u.exec(issueDialog());
    expect(element?.[0]).toMatch(
      /onChange=\{\(id, label\) => dispatch\(\{ type: 'person', employeeId: id, label,? \}\)\}/u,
    );
  });

  it('the effect hands the reducer what `holderAnswer` makes of the read', () => {
    expect(issueDialog()).toMatch(
      /const answer = holderAnswer<IssueLine>\(asking, \{ data: holderRead\.data, isError: holderRead\.isError,? \}\); if \(answer !== null\) dispatch\(answer\); \}, \[asking, holderRead\.data, holderRead\.isError\]\);/u,
    );
  });
});

describe('every other caller of the asset picker — exactly as before', () => {
  it('asks today’s request: the same key and the same parameters, nothing listed before typing', async () => {
    listAssets.mockResolvedValue(page([]));
    const qc = client();
    const html = render(qc, <AssetPicker value="" onChange={() => {}} />);
    const queries = qc.getQueryCache().findAll({ queryKey: listKey('it', 'assets') });
    expect(queries.map((query) => query.queryKey)).toEqual([
      listKey('it', 'assets', { picker: '', status: undefined }),
    ]);
    expect(Object.keys(queries[0]?.queryKey[3] as object)).toEqual(['picker', 'status']);
    await queries[0]?.fetch();
    expect(listAssets.mock.calls[0]?.[0]).toEqual({ search: '', pageSize: 8 });
    expect(Object.keys(listAssets.mock.calls[0]?.[0] ?? {})).toEqual(['search', 'pageSize']);
    expect(html).not.toContain('<ul');
    expect(html).not.toContain('data-asset-picker-holder');
  });

  it('a hand-over’s in-stock box asks the same as before too', async () => {
    listAssets.mockResolvedValue(page([]));
    const qc = client();
    render(qc, <AssetPicker value="" status="inStock" exclude={['a-9']} onChange={() => {}} />);
    const [query] = qc.getQueryCache().findAll({ queryKey: listKey('it', 'assets') });
    expect(query?.queryKey).toEqual(listKey('it', 'assets', { picker: '', status: 'inStock' }));
    await query?.fetch();
    expect(listAssets.mock.calls[0]?.[0]).toEqual({ search: '', pageSize: 8, status: 'inStock' });
  });

  it('renders today’s row: the name and the code, nothing more', () => {
    const qc = client();
    const row = render(qc, <AssetPickerRow asset={LAPTOP} pressed={false} onPick={() => {}} />);
    expect(row).toBe(
      '<button type="button" aria-pressed="false" class="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200">' +
        '<span>Lenovo ThinkCentre AIO</span>' +
        '<span class="font-mono text-xs text-slate-500" dir="ltr">AST-00001</span>' +
        '</button>',
    );
    const picked = render(qc, <AssetPickerRow asset={LAPTOP} pressed onPick={() => {}} />);
    expect(picked).toContain(
      'aria-pressed="true" class="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800/60 bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300"',
    );
  });

  it('a person’s box without `allowOther` behaves as built: their devices, and nothing else', async () => {
    listAssets.mockResolvedValue(page([]));
    const qc = client();
    const box = (
      <AssetPicker
        value=""
        holderEmployeeId={SHERIF}
        holderLabel={SHERIF_LABEL}
        onChange={() => {}}
      />
    );
    render(qc, box);
    await answer(qc, heldBy(SHERIF));
    const html = render(qc, box);
    expect(html).toContain(ar('it.assets.pickerHolderNone', { name: SHERIF_LABEL }));
    expect(html).not.toContain('data-asset-picker-toggle');
  });

  it('no other screen passes the new props', () => {
    // The issue's box, and the ledger's «تعديل الجهاز» (the same person-first box, by design).
    const holderBoxes = [
      'components/ConsumableDialogs.tsx',
      'components/ConsumableInstalledOnDialog.tsx',
    ];
    const others = sources()
      .filter((rel) => !holderBoxes.includes(rel))
      .flatMap((rel) =>
        [...source(rel).matchAll(/<AssetPicker\b[\s\S]*?\/>/gu)].map((m) => [rel, m[0]] as const),
      );
    // Custody, maintenance orders and plans, software, and the movements page's filter.
    expect(others.length).toBeGreaterThanOrEqual(5);
    for (const [rel, element] of others) {
      expect(element, rel).not.toMatch(/\b(holderEmployeeId|holderLabel|showHolder|allowOther)\b/u);
    }
  });
});

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE = join(HERE, '..');

/** Source with comments stripped: a rule about the code is not satisfied by prose. */
function source(rel: string): string {
  return readFileSync(join(MODULE, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

/** Whitespace collapsed: a wiring pinned is not broken by a line prettier wraps differently. */
function flat(code: string): string {
  return code.replace(/\s+/gu, ' ');
}

function sources(dir = MODULE): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/u.test(entry.name) && !entry.name.includes('.spec.')
      ? [relative(MODULE, full)]
      : [];
  });
}
