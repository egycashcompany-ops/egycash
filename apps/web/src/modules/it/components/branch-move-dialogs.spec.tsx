// «عايز إمكانية نقل أصل أو مستهلك إلى فرع تاني» (2026-11-11) — the two dialogs, proven against what
// they render: every picked asset is listed with what the move does to it (a held one goes with its
// custody, which the dialog says; a disposed one or one under maintenance stays, and why), and every
// ticked item is a row asking how many — empty until answered, bounded by what the store holds —
// with the store it leaves never offered as where it goes. Where they may go is what the SERVER
// says each action's own custody grant reaches, never what `me` suggests — the assets' move on
// `itAsset.assign` (`GET /it/assets/move-targets`), the store's transfer on `itConsumable.assign`
// (`GET /it/consumables/transfer-targets`, 2026-11-17), each asked under its own key.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type ItAssetDto,
  type ItConsumableDto,
  type ItMoveTargetsDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { AssetBranchMoveDialog } from './AssetBranchMoveDialog';
import { NO_DEPARTMENT, departmentHolder } from '../custody-holder-fixtures';
import { TransferConsumablesDialog } from './ConsumableDialogs';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const ar = (key: string): string => translate('ar', key);

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
  permissions: {
    'itAsset.view': 'organization',
    'itAsset.assign': 'organization',
    'itConsumable.view': 'organization',
    'itConsumable.assign': 'organization',
  },
  isPrivileged: false,
  flags: {},
  totpEnabled: true,
  external: null,
} as unknown as MeDto;

const ALL = ['b-hq', 'b-oct', 'b-alex'];

/** Where each dialog's answer is cached: the assets' move and the store's transfer, apart. */
type ReachKey = 'moveTargets' | 'consumableTransferTargets';

/**
 * The dialog as rendered once the branch options are in and the server has said which branches
 * the custody grant reaches (`reach`, under `key`) — or before it has answered (`null`). The
 * account is org-wide on every key: whatever `me` suggests, only the server's answer is offered.
 */
const render = (
  element: JSX.Element,
  reach: string[] | null = ALL,
  key: ReachKey = 'moveTargets',
): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(listKey('it', 'branchOptions'), [
    { id: 'b-hq', code: '01', name: { ar: 'المهندسين', en: 'HQ' }, parentId: null },
    { id: 'b-oct', code: '02', name: { ar: 'أكتوبر', en: 'October' }, parentId: null },
    { id: 'b-alex', code: '03', name: { ar: 'الإسكندرية', en: 'Alexandria' }, parentId: null },
  ]);
  if (reach !== null) {
    qc.setQueryData<ItMoveTargetsDto>(listKey('it', key), { branchIds: reach });
  }
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

const asset = (over: Partial<ItAssetDto>): ItAssetDto =>
  ({
    id: 'a-1',
    assetCode: 'AST-00001',
    name: 'Lenovo ThinkCentre',
    status: 'inStock',
    branchId: 'b-hq',
    location: null,
    holder: null,
    hasActiveMaintenance: false,
    ...over,
  }) as ItAssetDto;

const IN_STOCK = asset({});
const HELD = asset({
  id: 'a-2',
  assetCode: 'AST-00002',
  status: 'assigned',
  holder: {
    kind: 'employee',
    ...NO_DEPARTMENT,
    employeeId: 'e-1',
    employeeCode: '0100052',
    employeeName: 'وليد صفوت جلال',
    assignedAt: '2026-10-01T09:00:00.000Z',
  },
});
const IN_REPAIR = asset({ id: 'a-3', assetCode: 'AST-00003', status: 'underMaintenance' });
const GONE = asset({ id: 'a-4', assetCode: 'AST-00004', status: 'disposed' });

/** The list row that carries `marker`, opening tag to closing tag. */
const rowOf = (html: string, marker: string): string => {
  const at = html.indexOf(marker);
  expect(at, marker).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<li', at), html.indexOf('</li>', at));
};

describe('«نقل إلى فرع» — the assets', () => {
  const html = render(
    <AssetBranchMoveDialog open onClose={() => {}} assets={[IN_STOCK, HELD, IN_REPAIR, GONE]} />,
  );

  it('lists every picked asset with its code, branch and holder', () => {
    expect(html).toContain(ar('it.assets.move.title'));
    expect(rowOf(html, 'data-move-asset="a-1"')).toContain('AST-00001');
    expect(rowOf(html, 'data-move-asset="a-1"')).toContain('المهندسين');
    expect(rowOf(html, 'data-move-asset="a-1"')).toContain(ar('it.assets.move.inStore'));
    expect(rowOf(html, 'data-move-asset="a-2"')).toContain('وليد صفوت جلال (0100052)');
  });

  it('says a held asset goes with its custody, and the holder stays', () => {
    expect(rowOf(html, 'data-move-asset="a-2"')).toContain('data-move-state="moves"');
    expect(rowOf(html, 'data-move-asset="a-2"')).toContain(ar('it.assets.move.withCustody'));
    expect(html).toContain('data-move-held-note');
    expect(html).toContain(ar('it.assets.move.heldNote'));
  });

  it('shows what stays, and why — left out of the request', () => {
    expect(rowOf(html, 'data-move-asset="a-3"')).toContain('data-move-state="underMaintenance"');
    expect(rowOf(html, 'data-move-asset="a-3"')).toContain(
      ar('it.assets.move.refused.underMaintenance'),
    );
    expect(rowOf(html, 'data-move-asset="a-4"')).toContain('data-move-state="disposed"');
    expect(rowOf(html, 'data-move-asset="a-4"')).toContain(ar('it.assets.move.refused.disposed'));
    expect(html).toContain(ar('it.assets.move.leftOut'));
  });

  it('offers no branch they all already sit in, and waits for a branch to be chosen', () => {
    expect(html).not.toContain('<option value="b-hq"');
    expect(html).toContain('<option value="b-oct"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?نقل \(٢\)/u);
  });

  it('says nothing about custody when nothing held moves', () => {
    const plain = render(<AssetBranchMoveDialog open onClose={() => {}} assets={[IN_STOCK]} />);
    expect(plain).not.toContain('data-move-held-note');
    // One asset: its code and name are the dialog's subtitle.
    expect(plain).toContain('AST-00001 — Lenovo ThinkCentre');
  });

  it('shows an asset with a maintenance order still open as staying, whatever its status', () => {
    const ordered = asset({ id: 'a-5', assetCode: 'AST-00005', hasActiveMaintenance: true });
    const page = render(<AssetBranchMoveDialog open onClose={() => {}} assets={[ordered]} />);
    expect(rowOf(page, 'data-move-asset="a-5"')).toContain('data-move-state="underMaintenance"');
    expect(rowOf(page, 'data-move-asset="a-5"')).toContain(
      ar('it.assets.move.refused.underMaintenance'),
    );
  });

  // 2026-11-19 — a place does not travel: a server a department holds at its branch's server room
  // stays, and says to move it with «نقل» (the server's `heldAtLocation`).
  it('shows a department-held asset as staying, named by the department and its place', () => {
    const server = asset({
      id: 'a-6',
      assetCode: 'AST-00006',
      status: 'assigned',
      holder: departmentHolder(),
    });
    const page = render(<AssetBranchMoveDialog open onClose={() => {}} assets={[server]} />);
    const row = rowOf(page, 'data-move-asset="a-6"');
    expect(row).toContain('data-move-state="heldAtLocation"');
    expect(row).toContain(ar('it.assets.move.refused.heldAtLocation'));
    expect(row).toContain('إدارة تقنية المعلومات — غرفة السيرفرات');
    expect(page).not.toContain('data-move-held-note');
  });
});

describe('«نقل إلى فرع» — only the branches the server says the custody grant reaches', () => {
  const dialog = <AssetBranchMoveDialog open onClose={() => {}} assets={[IN_STOCK]} />;

  it('offers the branches the server names, and no other — whatever `me` reaches', () => {
    // `me` is org-wide on every key; the custody grant reaches two branches.
    const html = render(dialog, ['b-hq', 'b-oct']);
    expect(html).toContain('<option value="b-oct"');
    expect(html).not.toContain('<option value="b-alex"');
    expect(html).not.toContain(ar('it.assets.move.noTarget'));
  });

  it('with no other branch in reach, says so and leaves nothing to send', () => {
    // A branch-scoped grant over the branch the asset sits in, and a department-scoped one.
    for (const reach of [['b-hq'], []]) {
      const html = render(dialog, reach);
      expect(html).toContain(ar('it.assets.move.noTarget'));
      expect(html).not.toContain('<option value="b-oct"');
      expect(html).not.toContain('<option value="b-alex"');
      expect(html).toMatch(/<select[^>]*disabled=""/u);
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?نقل \(١\)/u);
    }
  });

  it('waits for the server’s answer — no «no branch» before it, nothing to choose or send', () => {
    const html = render(dialog, null);
    expect(html).not.toContain(ar('it.assets.move.noTarget'));
    expect(html).toContain(ar('common.loading'));
    expect(html).not.toContain('<option value="b-');
    expect(html).toMatch(/<select[^>]*disabled=""/u);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?نقل \(١\)/u);
  });
});

const item = (over: Partial<ItConsumableDto>): ItConsumableDto =>
  ({
    id: 'c-1',
    code: 'CON-00004',
    name: 'Mouse',
    typeId: 'ty-mice',
    unit: 'قطعة',
    branchId: 'b-hq',
    active: true,
    onHandQty: 10,
    ...over,
  }) as ItConsumableDto;

/** The store's answer — `GET /it/consumables/transfer-targets`, under its own key. */
const STORE: ReachKey = 'consumableTransferTargets';

describe('«تحويل إلى فرع» — the items', () => {
  const html = render(
    <TransferConsumablesDialog
      open
      onClose={() => {}}
      items={[item({}), item({ id: 'c-3', code: 'CON-00008', name: 'Power Cable', onHandQty: 0 })]}
    />,
    ALL,
    STORE,
  );

  it('names the store the items leave, and never offers it as where they go', () => {
    expect(html).toContain(ar('it.consumables.transfer.title'));
    expect(html).toContain('من مخزن فرع المهندسين');
    expect(html).not.toContain('<option value="b-hq"');
    expect(html).toContain('<option value="b-oct"');
    expect(html).toContain('<option value="b-alex"');
  });

  it('asks how many of each, empty until answered and bounded by what the store holds', () => {
    const mice = rowOf(html, 'data-transfer-line="c-1"');
    expect(mice).toContain('CON-00004');
    expect(mice).toContain('الرصيد الحالي: ١٠ قطعة');
    expect(mice).toMatch(/<input[^>]*type="number"[^>]*max="10"[^>]*value=""/u);
  });

  it('lists an item with nothing on hand as left out, with no box to fill', () => {
    const empty = rowOf(html, 'data-transfer-line="c-3"');
    expect(empty).toContain(ar('it.consumables.transfer.nothingOnHand'));
    expect(empty).not.toContain('<input');
  });

  it('says the other store’s item of the same name receives it, made when missing', () => {
    expect(html).toContain(ar('it.consumables.transfer.sameNameNote'));
  });
});

describe('«تحويل إلى فرع» — only the branches the server says the store’s custody grant reaches', () => {
  const dialog = <TransferConsumablesDialog open onClose={() => {}} items={[item({})]} />;
  const submitDisabled = new RegExp(
    `<button[^>]*disabled=""[^>]*>[\\s\\S]*?${ar('it.consumables.transfer.submit')}`,
    'u',
  );

  it('offers the branches the server names, never the store left — whatever `me` reaches', () => {
    // `me` is org-wide on every key; the store's custody grant reaches two branches.
    const html = render(dialog, ['b-hq', 'b-oct'], STORE);
    expect(html).toContain('<option value="b-oct"');
    expect(html).not.toContain('<option value="b-hq"');
    expect(html).not.toContain('<option value="b-alex"');
    expect(html).not.toContain(ar('it.consumables.transfer.noTarget'));
  });

  it('with no other branch in reach, says so and leaves nothing to send', () => {
    // A branch-scoped grant over the store the items leave, and a department-scoped one.
    for (const reach of [['b-hq'], []]) {
      const html = render(dialog, reach, STORE);
      expect(html).toContain(ar('it.consumables.transfer.noTarget'));
      expect(html).not.toContain('<option value="b-oct"');
      expect(html).toMatch(/<select[^>]*disabled=""/u);
      expect(html).toMatch(submitDisabled);
    }
  });

  it('waits for the server’s answer — no «no branch» before it, nothing to choose or send', () => {
    const html = render(dialog, null, STORE);
    expect(html).not.toContain(ar('it.consumables.transfer.noTarget'));
    expect(html).toContain(ar('common.loading'));
    expect(html).not.toContain('<option value="b-');
    expect(html).toMatch(/<select[^>]*disabled=""/u);
    expect(html).toMatch(submitDisabled);
  });

  // Two grants, two reaches: the assets' answer is for `itAsset.assign`, and a store keeper may
  // hold that over other branches — or not at all. The transfer never reads it.
  it('never offers the reach of the ASSETS’ custody grant — it waits for the store’s own', () => {
    const html = render(dialog, ALL, 'moveTargets');
    expect(html).toContain(ar('common.loading'));
    expect(html).not.toContain('<option value="b-');
    expect(html).toMatch(submitDisabled);
  });
});
