// «تعديل الجهاز» (2026-11-17) — «وضيف إمكانية تعديل الجهاز اللى عليه المستهلك بعد التسليم»; asked what
// the memo does, the owner chose «تتحدّث بالجهاز الجديد».
//
// The ledger's action and its dialog, as they render, against a mocked `it-api`. The web suite has
// no DOM to click in (`vitest.config.ts`), so — as `issue-holder.spec.tsx` does — the dialog is
// opened on the state a click leads to (its own reducer's, through a mocked `installedOnStart`),
// rendered, its requests answered through the query cache, and rendered again. The rules between
// the states are `lib/consumable-installed-on.spec.ts`; the few lines that WIRE them — the box's
// pick, «بدون جهاز», the save — are pinned in the source, and the hook's request and its re-read
// are run for real.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type ItAssetDto,
  type ItConsumableDto,
  type ItConsumableMovementDto,
  type Locale,
  type MeDto,
  type Paginated,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { detailKey, featureKey, listKey } from '../../../shared/lib/query-keys';
import { ApiError } from '../../../shared/lib/api-client';
import { formatDateTime } from '../../../shared/lib/format';
import { translate } from '../../../platform/localization/i18n';
import * as api from '../api/it-api';
import {
  useIssueItConsumables,
  useReturnItConsumable,
  useSetItConsumableInstalledOn,
} from '../api/it-queries';
import type * as InstalledOnRules from '../lib/consumable-installed-on';
import { type InstalledOnState } from '../lib/consumable-installed-on';
import { ConsumableInstalledOnDialog } from './ConsumableInstalledOnDialog';
import { ConsumableMovementsDialog } from './ConsumableDialogs';
import {
  AssetConsumablesCard,
  EmployeeConsumablesCard,
  installedOnEditing,
} from './ConsumableMovements';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

vi.mock('../api/it-api', async (actual) => ({
  ...(await actual<typeof api>()),
  listAssets: vi.fn(),
  setConsumableInstalledOn: vi.fn(),
}));
const listAssets = vi.mocked(api.listAssets);
const setInstalledOn = vi.mocked(api.setConsumableInstalledOn);

/** Where the dialog opens: empty by default, as it always does; a test sets what a click made. */
const opening = vi.hoisted(() => ({ state: null as unknown }));
vi.mock('../lib/consumable-installed-on', async (actual) => {
  const real = await actual<typeof InstalledOnRules>();
  return {
    ...real,
    installedOnStart: (): InstalledOnState =>
      (opening.state as InstalledOnState | null) ?? real.installedOnStart(),
  };
});

afterEach(() => {
  opening.state = null;
  listAssets.mockReset();
  setInstalledOn.mockReset();
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

/** The store's own grants — what every consumables screen is proven to work on. */
const STORE = [
  'itConsumable.view',
  'itConsumable.create',
  'itConsumable.edit',
  'itConsumable.assign',
];
/** …and the register of devices, which «تعديل الجهاز»'s box searches. */
const KEEPER = [...STORE, 'itAsset.view'];

const WALEED = '64b000000000000000000001';
const HANY = '64b000000000000000000003';
const WALEED_LABEL = 'وليد صفوت جلال (0100052)';

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
  name: 'Samsung S24 Monitor',
  serialNumber: 'ZX7710-B',
});
/** A shared printer somebody else holds — what «جهاز آخر» finds. */
const PRINTER = asset({
  id: 'a-5',
  assetCode: 'AST-00005',
  name: 'HP LaserJet Pro M404',
  serialNumber: 'PHBQ7K21',
  holder: {
    employeeId: HANY,
    employeeCode: '0100091',
    employeeName: 'هاني رأفت سليم',
    assignedAt: '2026-09-01T08:00:00.000Z',
  },
});

const page = <T,>(items: T[], pageSize = 50): Paginated<T> => ({
  items,
  meta: { page: 1, pageSize, totalItems: items.length, totalPages: 1 },
});

/** An issue of two toners to Waleed, installed on his laptop, on memo 7. */
const movement = (over: Partial<ItConsumableMovementDto> = {}): ItConsumableMovementDto => ({
  id: 'm-1',
  consumableId: 'c-1',
  kind: 'issued',
  qty: 2,
  at: '2026-10-21T08:30:00.000Z',
  branchId: 'b-hq',
  consumableCode: 'CON-00004',
  consumableName: 'حبر HP 59A',
  typeId: null,
  employeeId: WALEED,
  employeeCode: '0100052',
  employeeName: 'وليد صفوت جلال',
  assetId: LAPTOP.id,
  assetCode: LAPTOP.assetCode,
  assetName: LAPTOP.name,
  counterReading: null,
  counterReset: false,
  reason: 'new',
  memoId: 'memo-1',
  memoNumber: 7,
  memoSigned: true,
  transferId: null,
  counterpartBranchId: null,
  counterpartConsumableId: null,
  counterpartConsumableCode: null,
  byUserId: null,
  notes: null,
  version: 3,
  createdAt: '2026-10-21T08:30:00.000Z',
  ...over,
});

const SCRAPPED = movement({
  id: 'm-2',
  kind: 'scrapped',
  qty: 1,
  employeeId: null,
  employeeCode: null,
  employeeName: null,
  assetId: null,
  assetCode: null,
  assetName: null,
  reason: 'انكسر الموصل',
  memoId: null,
  memoNumber: null,
  memoSigned: null,
});

const item: ItConsumableDto = {
  id: 'c-1',
  code: 'CON-00004',
  name: 'حبر HP 59A',
  typeId: 'ty-toner',
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

const client = (): QueryClient => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
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

const dialog = (qc: QueryClient, row = movement(), left = false): string =>
  render(qc, <ConsumableInstalledOnDialog open onClose={() => {}} movement={row} left={left} />);

/** The recipient's devices query the box makes — the holder in its key. */
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

/** The save button's opening tag. */
const saveButton = (html: string): string => {
  const at = html.indexOf('data-installed-on-save');
  expect(at, 'the dialog has a save').toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<button', at), html.indexOf('>', at));
};

/** The «بدون جهاز» box's opening tag. */
const noneBox = (html: string): string => {
  const at = html.indexOf('data-installed-on-none');
  expect(at, 'the dialog offers «بدون جهاز»').toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<input', at), html.indexOf('>', at));
};

/** The table row that carries `marker`, opening tag to closing tag. */
const rowOf = (html: string, marker: string): string => {
  const at = html.indexOf(marker);
  expect(at, marker).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<tr', at), html.indexOf('</tr>', at));
};

// ── The action on the ledger ─────────────────────────────────────────────────────────────────────

describe('«تعديل الجهاز» on the ledger — every issued row, for a reader holding both grants', () => {
  /** A person's card, its page answered with an issue and a scrap. */
  const personCard = (permissions: string[]): string => {
    const qc = client();
    qc.setQueryData(
      listKey('it', 'consumables', { movements: true, employeeId: WALEED, page: 1, pageSize: 10 }),
      page([movement(), SCRAPPED], 10),
    );
    return render(qc, <EmployeeConsumablesCard employeeId={WALEED} />, permissions);
  };

  it('offers it on the issue, not on the scrap, in a column of its own', () => {
    const html = personCard(KEEPER);
    expect(dataAttr(html, 'data-movement-device-edit')).toEqual(['m-1']);
    expect(rowOf(html, 'data-movement-device-edit')).toContain('data-movement-qty="issued"');
    expect(rowOf(html, 'data-movement-qty="scrapped"')).not.toContain('data-movement-device-edit');
    expect(html).toContain(ar('it.consumables.installedOn.action'));
    expect(html).toContain(`<th`);
    expect(html).toContain(ar('it.assets.columns.actions'));
    // Closed, the row asks nothing of the register and draws no dialog.
    expect(html).not.toContain('role="dialog"');
    expect(listAssets).not.toHaveBeenCalled();
  });

  it('not without the register of devices: the store’s grants alone keep the ledger as it was', () => {
    const html = personCard(STORE);
    expect(html).not.toContain('data-movement-device-edit');
    // …and no empty column either.
    expect(html).not.toContain(ar('it.assets.columns.actions'));
  });

  it('not without the issue’s grant: a reader of both registers corrects nothing', () => {
    const html = personCard(['itConsumable.view', 'itAsset.view', 'itAsset.assign']);
    expect(html).not.toContain('data-movement-device-edit');
    expect(html).not.toContain(ar('it.assets.columns.actions'));
  });

  it('on the asset’s card too, where the device column is left out', () => {
    const qc = client();
    qc.setQueryData(
      listKey('it', 'consumables', { movements: true, assetId: LAPTOP.id, page: 1, pageSize: 10 }),
      page([movement()], 10),
    );
    const html = render(qc, <AssetConsumablesCard assetId={LAPTOP.id} />);
    expect(html).not.toContain('data-installed-on=');
    expect(dataAttr(html, 'data-movement-device-edit')).toEqual(['m-1']);
  });

  it('in one item’s movements as well', () => {
    const qc = client();
    qc.setQueryData(
      listKey('it', 'consumables', {
        movements: true,
        consumableId: item.id,
        page: 1,
        pageSize: 20,
      }),
      page([movement(), SCRAPPED], 20),
    );
    const html = render(qc, <ConsumableMovementsDialog open onClose={() => {}} item={item} />);
    expect(dataAttr(html, 'data-movement-device-edit')).toEqual(['m-1']);
  });
});

// ── The dialog ───────────────────────────────────────────────────────────────────────────────────

describe('the dialog — what was issued above, the recipient’s devices below', () => {
  it('shows the issue read-only, and lists the recipient’s devices at once, «جهاز آخر» under them', async () => {
    listAssets.mockImplementation((params) =>
      Promise.resolve(page(params['holderEmployeeId'] === WALEED ? [LAPTOP, SCREEN] : [PRINTER])),
    );
    const qc = client();
    const before = dialog(qc);
    // Whose devices these are — and the box asks before a word is typed.
    expect(before).toContain(ar('it.assets.pickerHolderHint', { name: WALEED_LABEL }));
    await answer(qc, heldBy(WALEED));
    expect(listAssets).toHaveBeenCalledTimes(1);
    expect(listAssets.mock.calls[0]?.[0]).toEqual({ holderEmployeeId: WALEED, pageSize: 50 });

    const html = dialog(qc);
    expect(html).toContain('role="dialog"');
    expect(html).toContain(ar('it.consumables.installedOn.title'));
    // What was issued: the item, how many, to whom, on which device now, and its memo.
    expect(dataAttr(html, 'data-installed-on-fact')).toEqual([
      'item',
      'qty',
      'recipient',
      'current',
      'memo',
    ]);
    expect(html).toContain('حبر HP 59A');
    expect(html).toContain('CON-00004');
    expect(html).toContain(WALEED_LABEL);
    expect(dataAttr(html, 'data-installed-on-current')).toEqual([LAPTOP.id]);
    expect(html).toContain(`${LAPTOP.assetCode} — ${LAPTOP.name}`);
    expect(html).toContain('EGYCASH-IT-CON-0007');
    // The recipient's devices, each with its serial; nothing picked for the user.
    expect(dataAttr(html, 'data-asset-serial')).toEqual(['PF3K9ZQ1', 'ZX7710-B']);
    expect(html).not.toContain(PRINTER.assetCode);
    expect(html).not.toContain('aria-pressed="true"');
    // …and «جهاز آخر» under them, for any other device of the register.
    expect(dataAttr(html, 'data-asset-picker-toggle')).toEqual(['other']);
    expect(html.indexOf(ar('it.assets.pickerOther'))).toBeGreaterThan(
      html.indexOf(SCREEN.assetCode),
    );
    // «بدون جهاز» is offered, unticked; nothing chosen, so nothing to save.
    expect(html).toContain(ar('it.consumables.installedOn.none'));
    expect(noneBox(html)).toMatch(/^<input type="checkbox"/u);
    expect(noneBox(html)).not.toContain('checked');
    expect(saveButton(html)).toContain('disabled=""');
  });

  it('says what the paper does before the save: the reprint, the signed copy, the record', () => {
    const qc = client();
    listAssets.mockResolvedValue(page([]));
    const signed = dialog(qc);
    expect(dataAttr(signed, 'data-installed-on-paper')).toEqual(['signed']);
    expect(signed).toContain(
      ar('it.consumables.installedOn.reprint', { memo: 'EGYCASH-IT-CON-0007' }),
    );
    expect(signed).toContain(ar('it.consumables.installedOn.signedStays'));
    expect(signed).toContain(ar('it.consumables.installedOn.recorded'));

    const unsigned = dialog(qc, movement({ memoSigned: false }));
    expect(dataAttr(unsigned, 'data-installed-on-paper')).toEqual(['unsigned']);
    expect(unsigned).toContain(ar('it.consumables.installedOn.unsigned'));
    expect(unsigned).not.toContain(ar('it.consumables.installedOn.signedStays'));

    // A memo the workforce reset purged: only the record is said.
    const paperless = dialog(qc, movement({ memoId: null, memoNumber: null, memoSigned: null }));
    expect(dataAttr(paperless, 'data-installed-on-paper')).toEqual(['none']);
    expect(paperless).not.toContain(ar('it.consumables.installedOn.reprintAnon'));
    expect(paperless).toContain(ar('it.consumables.installedOn.recorded'));
  });

  it('another of the recipient’s devices, picked: the save is offered', () => {
    listAssets.mockResolvedValue(page([LAPTOP, SCREEN]));
    opening.state = { assetId: SCREEN.id, asset: SCREEN, none: false, failure: null };
    const qc = client();
    qc.setQueryData(detailKey('it', 'assets', SCREEN.id), SCREEN);
    const html = dialog(qc);
    // The chip names the pick, the list is folded, and nothing more is said about it.
    expect(html).toContain(`${SCREEN.assetCode} — ${SCREEN.name}`);
    expect(html).toContain(ar('it.assets.clearPick'));
    expect(html).not.toContain('data-installed-on-holder');
    expect(html).not.toContain('data-installed-on-unchanged');
    expect(saveButton(html)).not.toContain('disabled=""');
  });

  it('«جهاز آخر»: a device somebody else holds stays the pick, and its line says whose it is', () => {
    listAssets.mockResolvedValue(page([]));
    opening.state = { assetId: PRINTER.id, asset: PRINTER, none: false, failure: null };
    const qc = client();
    qc.setQueryData(detailKey('it', 'assets', PRINTER.id), PRINTER);
    const html = dialog(qc);
    expect(html).toContain(`${PRINTER.assetCode} — ${PRINTER.name}`);
    expect(dataAttr(html, 'data-installed-on-holder')).toEqual([HANY]);
    expect(html).toContain(
      ar('it.consumables.issue.deviceHeldByOther', { name: 'هاني رأفت سليم (0100091)' }),
    );
    // The recipient is not changed by it: still Waleed, above.
    expect(html).toContain(WALEED_LABEL);
    expect(saveButton(html)).not.toContain('disabled=""');
  });

  it('«بدون جهاز»: ticked, the box goes and the save is offered', () => {
    opening.state = { assetId: '', asset: null, none: true, failure: null };
    const html = dialog(client());
    expect(noneBox(html)).toContain('checked=""');
    expect(html).not.toContain('data-asset-picker-holder');
    expect(html).not.toContain(ar('it.assets.pickerPlaceholder'));
    expect(saveButton(html)).not.toContain('disabled=""');
    expect(listAssets).not.toHaveBeenCalled();
  });

  it('a row with no device: «بدون جهاز» is what it already says, so it is not offered', () => {
    listAssets.mockResolvedValue(page([]));
    const html = dialog(client(), movement({ assetId: null, assetCode: null, assetName: null }));
    expect(dataAttr(html, 'data-installed-on-current')).toEqual(['']);
    expect(html).toContain(ar('it.consumables.installedOn.none'));
    expect(html).not.toContain('data-installed-on-none');
  });

  it('the device the row already names: said so, and nothing to save', () => {
    listAssets.mockResolvedValue(page([LAPTOP, SCREEN]));
    opening.state = { assetId: LAPTOP.id, asset: LAPTOP, none: false, failure: null };
    const qc = client();
    qc.setQueryData(detailKey('it', 'assets', LAPTOP.id), LAPTOP);
    const html = dialog(qc);
    expect(html).toContain('data-installed-on-unchanged');
    expect(html).toContain(ar('it.consumables.installedOn.unchanged'));
    expect(saveButton(html)).toContain('disabled=""');
  });

  it('409: somebody changed it first — said in the dialog’s own words', () => {
    listAssets.mockResolvedValue(page([]));
    opening.state = {
      assetId: SCREEN.id,
      asset: SCREEN,
      none: false,
      failure: { kind: 'conflict' },
    };
    const html = dialog(client());
    expect(dataAttr(html, 'data-installed-on-failure')).toEqual(['conflict']);
    expect(html).toMatch(/role="alert"[^>]*data-installed-on-failure="conflict"/u);
    expect(html).toContain(ar('it.consumables.installedOn.conflict'));
  });

  it('a ticked «بدون جهاز» stays offered when a re-read finds the device already taken off', () => {
    opening.state = { assetId: '', asset: null, none: true, failure: null };
    const html = dialog(client(), movement({ assetId: null, assetCode: null, assetName: null }));
    expect(noneBox(html)).toContain('checked=""');
  });

  it('409 on a row its list no longer has: says it left the list, and offers no second save', () => {
    listAssets.mockResolvedValue(page([]));
    opening.state = {
      assetId: SCREEN.id,
      asset: SCREEN,
      none: false,
      failure: { kind: 'conflict' },
      refusedVersion: 3,
    };
    const html = dialog(client(), movement(), true);
    expect(html).toMatch(/role="alert"[^>]*data-installed-on-failure="conflict"/u);
    expect(html).toContain(ar('it.consumables.installedOn.conflictLeft'));
    expect(html).not.toContain(ar('it.consumables.installedOn.conflict'));
    expect(html).not.toContain('data-installed-on-left');
    expect(saveButton(html)).toContain('disabled=""');
  });

  it('…and a new choice after it does not bring the save back: the row is still the refused one', () => {
    listAssets.mockResolvedValue(page([]));
    // Another device picked after the refusal: the words were cleared, the refused version was not.
    opening.state = {
      assetId: LAPTOP.id,
      asset: LAPTOP,
      none: false,
      failure: null,
      refusedVersion: 3,
    };
    const html = dialog(client(), movement({ assetId: SCREEN.id }), true);
    expect(html).toMatch(/role="alert"[^>]*data-installed-on-failure="conflict"/u);
    expect(html).toContain(ar('it.consumables.installedOn.conflictLeft'));
    expect(saveButton(html)).toContain('disabled=""');
    // The list re-read it at a newer version: the save is offered again.
    const reread = dialog(client(), movement({ assetId: SCREEN.id, version: 4 }), false);
    expect(reread).not.toContain('data-installed-on-failure');
    expect(saveButton(reread)).not.toContain('disabled=""');
  });

  it('a row its list no longer has, nothing refused: said so, and the save still offered', () => {
    listAssets.mockResolvedValue(page([]));
    opening.state = {
      assetId: SCREEN.id,
      asset: SCREEN,
      none: false,
      failure: null,
      refusedVersion: null,
    };
    const html = dialog(client(), movement(), true);
    expect(html).toContain('data-installed-on-left');
    expect(html).toContain(ar('it.consumables.installedOn.left'));
    expect(saveButton(html)).not.toContain('disabled=""');
    expect(dialog(client())).not.toContain('data-installed-on-left');
  });

  it('any other refusal: the server’s answer, as the platform words it', () => {
    listAssets.mockResolvedValue(page([]));
    opening.state = {
      assetId: SCREEN.id,
      asset: SCREEN,
      none: false,
      failure: { kind: 'refused', message: 'هذا الإجراء غير مسموح حاليًا.' },
    };
    const html = dialog(client());
    expect(dataAttr(html, 'data-installed-on-failure')).toEqual(['refused']);
    expect(html).toContain('هذا الإجراء غير مسموح حاليًا.');
    expect(html).not.toContain(ar('it.consumables.installedOn.conflict'));
  });
});

// ── A toner issued with the printer's counter («عداد الطابعة», 2026-11-19) ───────────────────────

describe('a toner issued with the printer’s counter moves with a reading', () => {
  /** The toner, issued onto Hany's printer at 12,400. */
  const TONER = movement({
    qty: 1,
    assetId: PRINTER.id,
    assetCode: PRINTER.assetCode,
    assetName: PRINTER.name,
    counterReading: 12_400,
  });
  const LAST_AT = '2026-11-12T09:00:00.000Z';
  /** The other printer's counter: its last reading is another toner's. */
  const counterOf = (assetId: string, rows: { id: string; reading: number }[]) =>
    ({
      assetId,
      latest: null,
      readings: rows.map(({ id, reading }) => ({
        movementId: id,
        at: LAST_AT,
        reading,
        reset: false,
        consumableId: 'c-9',
        consumableCode: 'CON-00009',
        consumableName: 'حبر HP 26A',
        replaced: null,
      })),
    }) as const;
  const picked = (over: Partial<InstalledOnState> = {}): InstalledOnState => ({
    assetId: SCREEN.id,
    asset: SCREEN,
    none: false,
    counterReading: '',
    counterReset: false,
    failure: null,
    refusedVersion: null,
    ...over,
  });
  const seeded = (): QueryClient => {
    const qc = client();
    qc.setQueryData(detailKey('it', 'assets', SCREEN.id), SCREEN);
    qc.setQueryData(
      listKey('it', 'consumables', { counter: 'printer', assetId: SCREEN.id }),
      counterOf(SCREEN.id, [{ id: 'm-7', reading: 31_000 }]),
    );
    return qc;
  };

  it('shows the reading it went in at, and asks one for the device it moves to', () => {
    listAssets.mockResolvedValue(page([]));
    opening.state = picked();
    const html = dialog(seeded(), TONER);
    expect(html).toContain('data-installed-on-fact="counter"');
    expect(dataAttr(html, 'data-counter-reading')).toEqual(['12400']);
    expect(html).toContain('data-installed-on-reading');
    expect(html).toContain(ar('it.consumables.installedOn.counterHint'));
    // That printer's last reading, as «صرف» shows it.
    expect(dataAttr(html, 'data-counter-latest')).toEqual(['31000']);
    // No reading yet: nothing to save.
    expect(saveButton(html)).toContain('disabled=""');
    opening.state = picked({ counterReading: '31500' });
    expect(saveButton(dialog(seeded(), TONER))).not.toContain('disabled=""');
  });

  it('a correction on its own printer is typed against the reading BEFORE this one', () => {
    opening.state = picked({ assetId: '', asset: null, counterReading: '12450' });
    const qc = client();
    qc.setQueryData(
      listKey('it', 'consumables', { counter: 'printer', assetId: PRINTER.id }),
      counterOf(PRINTER.id, [
        { id: TONER.id, reading: 12_400 },
        { id: 'm-0', reading: 9_000 },
      ]),
    );
    const html = dialog(qc, TONER);
    // This row's own reading is not its floor.
    expect(dataAttr(html, 'data-counter-latest')).toEqual(['9000']);
    expect(saveButton(html)).not.toContain('disabled=""');
  });

  it('«بدون جهاز» takes the reading off with the device — said, and no box for one', () => {
    opening.state = picked({ assetId: '', asset: null, none: true });
    const html = dialog(client(), TONER);
    expect(html).toContain('data-installed-on-counter-dropped');
    expect(html).toContain(ar('it.consumables.installedOn.counterDropped'));
    expect(html).not.toContain('data-installed-on-reading');
    expect(saveButton(html)).not.toContain('disabled=""');
  });

  it('the printer’s refusal is said on the reading’s box, with its figures — not above it', () => {
    listAssets.mockResolvedValue(page([]));
    const problem = { kind: 'belowPrevious', reading: 31_000, at: LAST_AT } as const;
    opening.state = picked({ counterReading: '30000', failure: { kind: 'counter', problem } });
    const html = dialog(seeded(), TONER);
    expect(html).toContain(
      ar('it.consumables.counter.belowPrevious', {
        reading: '٣١٬٠٠٠',
        date: formatDateTime(LAST_AT, 'ar'),
      }),
    );
    expect(html).not.toContain('data-installed-on-failure');
  });

  it('an issue recorded without a reading takes none afterwards: no box, as before', () => {
    listAssets.mockResolvedValue(page([]));
    opening.state = picked();
    const html = dialog(seeded());
    expect(html).not.toContain('data-installed-on-reading');
    expect(html).not.toContain('data-installed-on-fact="counter"');
    expect(saveButton(html)).not.toContain('disabled=""');
  });

  it('the box and its reset reach the state', () => {
    const source = flat('ConsumableInstalledOnDialog.tsx');
    expect(source).toContain(
      "dispatch({ type: 'counter', counterReading: e.target.value, counterReset: state.counterReset, })",
    );
    expect(source).toContain(
      "dispatch({ type: 'counter', counterReading: state.counterReading, counterReset: e.target.checked, })",
    );
    expect(source).toContain('const target = installedOnTarget(state, movement);');
  });
});

// ── The request, and the re-read ─────────────────────────────────────────────────────────────────

describe('the save — the PATCH, and the ledger read again whatever the answer', () => {
  /** The hook as a screen holds it, its mutation run outside the render as a click runs it. */
  const hook = (qc: QueryClient): ReturnType<typeof useSetItConsumableInstalledOn> => {
    let held: ReturnType<typeof useSetItConsumableInstalledOn> | null = null;
    const Probe = (): null => {
      held = useSetItConsumableInstalledOn();
      return null;
    };
    renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <Probe />
      </QueryClientProvider>,
    );
    expect(held).not.toBeNull();
    return held as unknown as ReturnType<typeof useSetItConsumableInstalledOn>;
  };

  it('sends the row’s id and the body, and reads the ledger’s subtree again', async () => {
    setInstalledOn.mockResolvedValue(movement({ assetId: SCREEN.id, version: 4 }));
    const qc = client();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    await hook(qc).mutateAsync({ id: 'm-1', body: { assetId: SCREEN.id, version: 3 } });
    expect(setInstalledOn).toHaveBeenCalledWith('m-1', { assetId: SCREEN.id, version: 3 });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: featureKey('it', 'consumables') });
  });

  it('a 409 reloads too — the dialog then shows the row as it now stands', async () => {
    setInstalledOn.mockRejectedValue(new ApiError('STALE_DOCUMENT', 'changed', 409));
    const qc = client();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    await expect(
      hook(qc).mutateAsync({ id: 'm-1', body: { assetId: null, version: 3 } }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(setInstalledOn).toHaveBeenCalledWith('m-1', { assetId: null, version: 3 });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: featureKey('it', 'consumables') });
  });

  // The app's client toasts every failed mutation that declares no `onError` of its own
  // (`shared/lib/query-client.ts`); the dialog words every refusal itself, so it is said once.
  it('a refusal is the dialog’s to say: the global toast is not raised over it', async () => {
    setInstalledOn.mockRejectedValue(new ApiError('STALE_DOCUMENT', 'changed', 409));
    const globalToast = vi.fn();
    const qc = new QueryClient({
      mutationCache: new MutationCache({
        onError: (error, _variables, _context, mutation) => {
          if (mutation.options.onError === undefined) globalToast(error);
        },
      }),
    });
    await expect(
      hook(qc).mutateAsync({ id: 'm-1', body: { assetId: null, version: 3 } }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(globalToast).not.toHaveBeenCalled();
  });

  it('the ledger’s rows, the memo and both assets’ cards all live under that subtree', () => {
    const subtree = featureKey('it', 'consumables');
    for (const key of [
      listKey('it', 'consumables', { movements: true, page: 1, pageSize: 25 }),
      listKey('it', 'consumables', { movements: true, assetId: LAPTOP.id, page: 1, pageSize: 10 }),
      listKey('it', 'consumables', { movements: true, assetId: SCREEN.id, page: 1, pageSize: 10 }),
      listKey('it', 'consumables', { movements: true, employeeId: WALEED, page: 1, pageSize: 10 }),
      detailKey('it', 'consumables', 'memo:memo-1'),
    ]) {
      expect(key.slice(0, subtree.length)).toEqual(subtree);
    }
  });
});

// ── The wiring, pinned ───────────────────────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));

/** Source with comments stripped and whitespace collapsed: prose satisfies no rule here. */
const flat = (file: string): string =>
  readFileSync(join(HERE, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
    .replace(/\s+/gu, ' ');

describe('the wiring a static render cannot click', () => {
  const source = flat('ConsumableInstalledOnDialog.tsx');

  it('the box is the issue’s own: the recipient’s devices, «جهاز آخر», the serial and holder', () => {
    const box = /<AssetPicker\b[\s\S]*?\/>/u.exec(source)?.[0] ?? '';
    expect(box).toContain("holderEmployeeId={movement.employeeId ?? ''}");
    expect(box).toContain("holderLabel={recipient ?? ''}");
    expect(box).toMatch(/\ballowOther\b/u);
    expect(box).toMatch(/\bshowHolder\b/u);
    expect(box).toContain('withoutStatus="disposed"');
  });

  it('a pick reaches the state with its row; «بدون جهاز» with its tick', () => {
    expect(source).toContain(
      "onChange={(assetId, asset) => dispatch({ type: 'device', assetId, asset: asset ?? null })",
    );
    expect(source).toContain(
      "onChange={(e) => dispatch({ type: 'none', none: e.target.checked })}",
    );
  });

  it('the save sends what the rules say, with the row’s id, and a refusal is read', () => {
    expect(source).toContain('const body = installedOnRequest(movement, state);');
    expect(source).toContain('disabled={body === null || stale}');
    expect(source).toContain('const stale = installedOnStale(movement, state);');
    expect(source).toContain('await save.mutateAsync({ id: movement.id, body });');
    expect(source).toContain('const failure = installedOnFailure(err, locale);');
    // The refusal remembers the version it refused…
    expect(source).toContain("dispatch({ type: 'failed', failure, version: body.version });");
    // …and one that settles after its dialog closed is still said.
    expect(source).toMatch(/if \(mounted\.current\) \{ dispatch\(/u);
    expect(source).toContain('} else { toast.error(');
  });
});

// ── The dialog is the ledger's, not a row's ──────────────────────────────────────────────────────

describe('the open dialog outlives its row', () => {
  const issue = movement();

  it('nothing open: no dialog', () => {
    expect(installedOnEditing(null, [issue])).toBeNull();
  });

  it('the row still listed: the list’s own copy, its version and device as last read', () => {
    const reread = movement({ version: 3, assetId: SCREEN.id });
    expect(installedOnEditing(issue, [SCRAPPED, reread])).toEqual({
      movement: reread,
      left: false,
    });
  });

  it('the row gone from the list (another device, the next page): the row as opened, `left`', () => {
    expect(installedOnEditing(issue, [SCRAPPED])).toEqual({ movement: issue, left: true });
    expect(installedOnEditing(issue, [])).toEqual({ movement: issue, left: true });
  });

  it('is mounted beside the table by every place the ledger is read, never in a cell', () => {
    const ledger = flat('ConsumableMovements.tsx');
    expect(ledger.match(/<ConsumableInstalledOnDialog\b/gu)).toHaveLength(1);
    expect(ledger).toContain('const columns = useConsumableMovementColumns(options, setKept);');
    expect(ledger).toContain('const editing = installedOnEditing(kept, rows);');
    // The last copy the list showed is carried forward, so a row that leaves falls back to it.
    expect(ledger).toContain(
      'if (editing !== null && !editing.left && editing.movement !== kept) setKept(editing.movement);',
    );
    // One dialog per row, and a close reaches only its own row.
    expect(ledger).toContain('key={id}');
    expect(ledger).toContain(
      'onClose={() => setKept((current) => (current?.id === id ? null : current))}',
    );
    expect(ledger).toContain('movement={editing.movement} left={editing.left}');
    expect(ledger).toContain('onClick={() => onEdit(movement)}');
    expect(ledger).toContain('<InstalledOnAction movement={m} onEdit={onEditDevice} />');
    const button = /const InstalledOnAction = [\s\S]*?\n\};/u.exec(
      readFileSync(join(HERE, 'ConsumableMovements.tsx'), 'utf8'),
    )?.[0];
    expect(button).toBeDefined();
    expect(button).not.toContain('ConsumableInstalledOnDialog');
    // The cards, one item's movements and the movements screen: each hands the hook the rows it
    // shows, and renders its dialog.
    expect(ledger).toContain(
      'const { columns, editor } = useConsumableMovementLedger(rows, options);',
    );
    expect(ledger).toContain('{editor} </CardBody>');
    const item = flat('ConsumableDialogs.tsx');
    expect(item).toContain(
      'const { columns, editor } = useConsumableMovementLedger(rows, { item: false, counter });',
    );
    expect(item).toMatch(/onPageChange=\{setPage\} \/> \)\} \{editor\} <\/div>/u);
    const screen = flat('../pages/ConsumableMovementsPage.tsx');
    expect(screen).toContain('const { columns, editor } = useConsumableMovementLedger(rows);');
    expect(screen).toMatch(/\{editor\} <\/div> <\/PageContainer>/u);
  });
});

// ── The issue says its own refusals ──────────────────────────────────────────────────────────────

describe('«صرف»: a refusal is the dialog’s to say, with its figures', () => {
  /** The mutation a hook returns, mounted once in a static render. */
  const mounted = <T,>(qc: QueryClient, use: () => T): T => {
    let held: T | null = null;
    const Probe = (): null => {
      held = use();
      return null;
    };
    renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <Probe />
      </QueryClientProvider>,
    );
    expect(held).not.toBeNull();
    return held as unknown as T;
  };

  const withGlobalToast = (globalToast: (error: unknown) => void): QueryClient =>
    new QueryClient({
      mutationCache: new MutationCache({
        onError: (error, _variables, _context, mutation) => {
          if (mutation.options.onError === undefined) globalToast(error);
        },
      }),
    });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('an issue refused on its counter raises no global toast over the dialog’s own words', async () => {
    vi.spyOn(api, 'issueConsumables').mockRejectedValue(
      new ApiError('IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS', 'not above', 422),
    );
    const globalToast = vi.fn();
    const issue = mounted(withGlobalToast(globalToast), useIssueItConsumables);
    await expect(
      issue.mutateAsync({ employeeId: 'e-1', lines: [] } as never),
    ).rejects.toBeInstanceOf(ApiError);
    expect(globalToast).not.toHaveBeenCalled();
  });

  it('every other consumables write still has the global toast — the harness sees it', async () => {
    vi.spyOn(api, 'returnConsumable').mockRejectedValue(new ApiError('NOT_FOUND', 'gone', 404));
    const globalToast = vi.fn();
    const giveBack = mounted(withGlobalToast(globalToast), useReturnItConsumable);
    await expect(
      giveBack.mutateAsync({ id: 'c-1', body: { qty: 1 } } as never),
    ).rejects.toBeInstanceOf(ApiError);
    expect(globalToast).toHaveBeenCalledTimes(1);
  });
});
