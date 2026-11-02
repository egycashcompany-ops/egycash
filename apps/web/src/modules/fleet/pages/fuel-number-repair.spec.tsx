// «تصحيح أرقام الكروت» (6d), proven against what it draws: the review (17 rows, masked numbers only,
// the PIN told as yes/no and never drawn), a record changed by hand holding its whole cycle, the
// confirmation that sends nothing until «راجعتُ الصفوف» is ticked, the done state with its next
// step, the grants that hide «تنفيذ التصحيح», and the yellow box on «مطابقة أرصدة الكروت».
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type FleetFuelNumberRepairDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { numberRepairKey } from '../api/fuel-number-repair-queries';
import { NumberRepairEntry } from '../components/number-repair/NumberRepairEntry';
import { RepairThumb } from '../components/number-repair/RepairThumb';
import {
  REPAIR_CLEAN,
  repairChanged269,
  repairDone,
  repairPartial,
} from '../fuel-number-repair-fixtures';
import { NUMBER_REPAIR_PATH, REPAIR_AUDIT_PATH } from '../lib/fuel-number-repair';
import { FuelNumberRepairPage, NumberRepairView } from './FuelNumberRepairPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
const N = 'fleet.fuelCards.numberRepair.';

const VIEW = ['fleetFuelCard.view'];
const EXECUTE = [...VIEW, 'fleetFuelCard.edit', 'fleetFuelCharge.approve'];

const me = (permissions: readonly string[]): MeDto =>
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

const wrap = (
  node: JSX.Element,
  permissions: readonly string[] = EXECUTE,
  repair?: FleetFuelNumberRepairDto,
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  if (repair !== undefined) qc.setQueryData(numberRepairKey, repair);
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const view = (
  repair: FleetFuelNumberRepairDto,
  {
    permissions = EXECUTE,
    confirming = false,
    reviewed = false,
    busy = false,
  }: {
    permissions?: readonly string[];
    confirming?: boolean;
    reviewed?: boolean;
    busy?: boolean;
  } = {},
): string =>
  wrap(
    <NumberRepairView
      repair={repair}
      refreshing={false}
      onRefresh={() => undefined}
      confirming={confirming}
      reviewed={reviewed}
      busy={busy}
      onRun={() => undefined}
      onReviewed={() => undefined}
      onCloseConfirm={() => undefined}
      onConfirm={() => undefined}
      onLog={() => undefined}
    />,
    permissions,
  );

/** The markup of one record's row. */
const rowOf = (html: string, car: string): string => {
  const start = html.indexOf(`data-repair-row="${car}"`);
  expect(start, `row ${car}`).toBeGreaterThan(-1);
  const next = html.indexOf('data-repair-row=', start + 10);
  return html.slice(start, next === -1 ? undefined : next);
};
/** What a reader sees: the markup without its tags. */
const textOf = (html: string): string =>
  html
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/\s+/gu, ' ');
/** The words alone, as one string — tags dropped without a gap. */
const plainOf = (html: string): string => html.replace(/<[^>]+>/gu, '');

/**
 * The four-digit figures a reader may see: a last four of the 17 (before and after), a year, or
 * the plate inside a card name. Anything else could be a PIN — and no PIN is ever drawn.
 */
const KNOWN_FOURS = new Set([
  ...REPAIR_CLEAN.cycles.flatMap((cycle) => [
    ...cycle.heldLast4,
    ...cycle.rows.flatMap((row) => [
      row.numberBeforeLast4,
      row.numberAfterLast4,
      ...(row.name.match(/\d{4}/gu) ?? []),
      ...(row.photoBefore.embossedName.match(/\d{4}/gu) ?? []),
      ...(row.photoAfter.embossedName.match(/\d{4}/gu) ?? []),
    ]),
  ]),
  ...REPAIR_CLEAN.pair.rows.flatMap((row) => [
    row.numberLast4,
    ...(row.nameBefore.match(/\d{4}/gu) ?? []),
    ...(row.nameAfter.match(/\d{4}/gu) ?? []),
  ]),
  '2026',
  '2027',
  '2028',
  '2029',
]);
const strayFours = (html: string): string[] =>
  [...new Set(textOf(html).match(/(?<![\d,.])\d{4}(?![\d,.])/gu) ?? [])].filter(
    (four) => !KNOWN_FOURS.has(four),
  );

describe('the review (sample 01, 02, 09)', () => {
  const html = view(REPAIR_CLEAN);

  it('draws every one of the 17 records — three cycles and the 0849 pair', () => {
    expect(html).toContain('data-repair-page="pending"');
    for (const cycle of REPAIR_CLEAN.cycles) {
      expect(html).toContain(`data-repair-cycle="${cycle.n}"`);
      expect(html).toContain(`data-repair-chain="${cycle.cars.join('-')}"`);
      for (const row of cycle.rows) expect(rowOf(html, row.car)).toContain(row.name);
    }
    expect(html).toContain('data-repair-pair="ready"');
    expect(rowOf(html, '530')).toContain('EGYCASH-1137-401485');
    expect(rowOf(html, '283')).toContain('EGYCASH-8616-783211');
    expect(html.match(/data-repair-row="/gu)).toHaveLength(17);
  });

  it('writes a card number only as its printed start and last four', () => {
    const row = rowOf(html, '239');
    expect(row).toContain('548 •••• 2813');
    expect(row).toContain('548 •••• 0935');
    // No full card number anywhere on the page.
    expect(textOf(html)).not.toMatch(/\d{9,}/u);
  });

  it('never draws a PIN: every four-digit figure is a last four, a year or a plate', () => {
    expect(strayFours(html)).toEqual([]);
    expect(html).not.toMatch(/password/iu);
  });

  it('tells what happens to the PIN from yes/no only — and the five records left without one', () => {
    expect(rowOf(html, '239')).toContain('data-repair-pin="moves"');
    for (const car of ['284', '269', '230', '256', '251']) {
      expect(rowOf(html, car)).toContain('data-repair-pin="none"');
      expect(rowOf(html, car)).toContain(ar(`${N}pin.none`));
    }
    expect(html).toContain('data-repair-no-pin="284,269,230,256,251"');
    // Today's PIN goes with today's number to the record that receives it.
    expect(textOf(rowOf(html, '239'))).toContain(
      ar(`${N}pin.goes`, { number: '•••• 2813', car: '241' }),
    );
  });

  it('keeps name, car and balance; lists the top-ups for information only', () => {
    const row = rowOf(html, '239');
    expect(row).toContain(ar(`${N}row.stays`));
    expect(row).toContain('6,549.73');
    expect(row).toContain(ar(`${N}row.chassisTypo`));
    expect(row).toContain(ar(`${N}topUps.note`));
    expect(textOf(row)).toContain('2026/10/09');
    expect(textOf(row)).toContain('+2,000.00');
    expect(rowOf(html, '243')).toContain(ar(`${N}topUps.none`));
    // Expiry: the same date, or a new one.
    expect(rowOf(html, '239')).toContain(ar(`${N}expiry.same`));
    expect(rowOf(html, '243')).toContain(ar(`${N}expiry.changes`));
  });

  it('the two photos: today’s ✗ → the right one ✓, as thumbnails', () => {
    const row = rowOf(html, '239');
    expect(row).toContain('data-repair-thumb="no"');
    expect(row).toContain('data-repair-thumb="ok"');
    expect(textOf(row)).toContain(ar(`${N}photo.ofCar`, { car: '241' }));
    expect(textOf(row)).toContain(ar(`${N}photo.ofCar`, { car: '239' }));
  });

  it('the pair: opening and balance before → after, Δ signed, the «بديل» note for 283 only', () => {
    const a = rowOf(html, '530');
    const b = rowOf(html, '283');
    expect(a).toContain('13,130.62');
    expect(a).toContain('1,258.00');
    expect(a).toContain('−11,872.62');
    expect(a).toContain(ar(`${N}pair.statementSame`));
    expect(b).toContain('+11,872.62');
    expect(b).toContain(ar(`${N}pair.statementDiffers`));
    expect(html).toContain('data-repair-pair-alt="283"');
    expect(html).not.toContain('data-repair-pair-alt="530"');
    expect(html).toContain(ar(`${N}pair.adjustNone`));
    expect(html).toContain(ar(`${N}pair.lock`));
  });

  it('the figures: 17 cards, 15 crossed in 3 cycles, the pair, 5 numbers with no PIN', () => {
    const kpi = (mark: string): string => {
      const start = html.indexOf(`data-fuel-kpi="${mark}"`);
      return html.slice(start, html.indexOf('data-fuel-kpi=', start + 10));
    };
    expect(kpi('repair-all')).toContain('>17<');
    expect(kpi('repair-cycles')).toContain('>15<');
    expect(kpi('repair-cycles')).toContain(
      ar(`${N}kpi.cyclesNote`, { count: 3, sizes: '4 و5 و6' }),
    );
    expect(kpi('repair-pair')).toContain('>2<');
    expect(kpi('repair-no-pin')).toContain('>5<');
  });

  it('the bar: «سيُصحَّح 17 كارتًا من 17» and «تنفيذ التصحيح», which only opens the confirmation', () => {
    expect(textOf(html)).toContain(ar(`${N}bar.fix`, { cards: '17 كارتًا', all: 17 }));
    expect(html).toMatch(/data-repair-run="true"(?![^>]*disabled="")/u);
    expect(html).not.toContain('data-repair-confirm="true"');
    expect(html).not.toContain('data-repair-alert');
  });
});

describe('a record changed by hand holds its whole cycle (sample 04)', () => {
  const html = view(repairChanged269());

  it('the red alert names the car and the cycle, and what still goes', () => {
    expect(html).toContain('data-repair-alert="changed"');
    expect(textOf(html)).toContain(
      ar(`${N}alert.one`, {
        car: '269',
        unit: ar(`${N}cycleName`, { n: 2 }),
        held: '5 كروت',
      }) + ar(`${N}alert.rest`, { rest: '12 كارتًا' }),
    );
  });

  it('the changed record: «تغيّر — لن يُلمس», what changed, from what, to what, when and by whom', () => {
    const row = rowOf(html, '269');
    expect(row).toContain('data-repair-row-state="changed"');
    expect(row).toContain(ar(`${N}state.changed`));
    expect(row).toContain('data-repair-expiry-changed="269"');
    const note = textOf(row.slice(row.indexOf('data-repair-changed-note')));
    expect(note).toContain('2026/11/30');
    expect(note).toContain('2027/11/30');
    expect(note).toContain(ar(`${N}changed.by`, { by: 'مشرف الكروت' }));
    expect(note).toContain(ar(`${N}changed.tail`));
  });

  it('the rest of its cycle waits «موقوف مع الدائرة»; the other cycles and the pair still match', () => {
    for (const car of ['233', '525', '284', '230']) {
      expect(rowOf(html, car)).toContain('data-repair-row-state="held"');
      expect(rowOf(html, car)).toContain(ar(`${N}state.held`));
    }
    expect(html).toContain('data-repair-cycle-tag="held"');
    expect(html).toContain(ar(`${N}cycle.held`, { car: '269' }));
    expect(rowOf(html, '239')).toContain('data-repair-row-state="ok"');
    expect(html).toContain('data-repair-pair-tag="ready"');
  });

  it('the bar counts 12 of 17 and names what it skips', () => {
    const bar = textOf(html.slice(html.indexOf('data-repair-bar=')));
    expect(bar).toContain(ar(`${N}bar.fix`, { cards: '12 كارتًا', all: 17 }));
    expect(bar).toContain(
      ar(`${N}bar.skip`, { cards: '5 كروت', units: ar(`${N}cycleName`, { n: 2 }) }).trim(),
    );
  });
});

describe('the confirmation (sample 05)', () => {
  it('«تأكيد التنفيذ ✓» is off until «راجعتُ الصفوف» is ticked — and the tick starts unticked', () => {
    const unticked = view(REPAIR_CLEAN, { confirming: true, reviewed: false });
    expect(unticked).toContain('data-repair-confirm="true"');
    expect(unticked).toMatch(/data-repair-confirm-run="true"[^>]*disabled=""/u);
    expect(unticked).toMatch(/data-repair-reviewed="true"(?![^>]*checked)/u);
    const ticked = view(REPAIR_CLEAN, { confirming: true, reviewed: true });
    expect(ticked).not.toMatch(/data-repair-confirm-run="true"[^>]*disabled=""/u);
    // And off again while the execution is on its way.
    const busy = view(REPAIR_CLEAN, { confirming: true, reviewed: true, busy: true });
    expect(busy).toMatch(/data-repair-confirm-run="true"[^>]*disabled=""/u);
  });

  it('says what moves, the five left without a PIN, each cycle, the pair’s Δ, and the log line', () => {
    const html = view(REPAIR_CLEAN, { confirming: true, reviewed: true });
    const dialog = html.slice(html.indexOf('data-repair-confirm="true"'));
    expect(dialog).toContain('data-repair-confirm-pin="284,269,230,256,251"');
    expect(plainOf(dialog)).toContain(
      ar(`${N}confirm.noPin`, { numbers: '5 أرقام', cars: '284 و269 و230 و256 و251' }),
    );
    for (const n of [1, 2, 3]) expect(dialog).toContain(`data-repair-confirm-cycle="${n}"`);
    expect(dialog).toContain('data-repair-confirm-pair="true"');
    expect(dialog).toContain('−11,872.62');
    expect(dialog).toContain('+11,872.62');
    expect(textOf(dialog)).toContain(
      'صُحّح رقم الكارت: كان •••• 2813 وأصبح •••• 0935 — تصحيح بيانات التشغيل',
    );
    expect(strayFours(dialog)).toEqual([]);
  });

  it('a held cycle is «تُتخطّى: سجل تغيّر», and its records are not named for the PIN', () => {
    const html = view(repairChanged269(), { confirming: true, reviewed: true });
    expect(html).toContain('data-repair-confirm-cycle="2" data-repair-confirm-state="held"');
    expect(html).toContain(ar(`${N}confirm.skipped`));
    expect(html).toContain('data-repair-confirm-pin="256,251"');
  });
});

describe('after execution (sample 06)', () => {
  const html = view(repairDone(), { permissions: [...EXECUTE, 'auditLog.view'] });

  it('the header says when and by whom; the rule gives way to the next step', () => {
    expect(html).toContain('data-repair-page="done"');
    expect(html).toContain('data-repair-status="done"');
    expect(textOf(html)).toContain('مدير الحركة');
    expect(html).toContain('data-repair-done="true"');
    expect(html).toContain(ar(`${N}done.title`, { records: 17, crossed: 15 }));
    expect(html).toContain(ar(`${N}next.title`));
    expect(html).not.toContain('data-repair-rulebox');
  });

  it('opens the reconciliation, and the audit log (filtered to the repair) for its readers only', () => {
    expect(html).toContain('href="/fleet/fuel-cards/reconcile"');
    expect(html).toContain(`href="${REPAIR_AUDIT_PATH.replace(/&/gu, '&amp;')}"`);
    expect(view(repairDone())).not.toContain('data-repair-audit');
  });

  it('every row reads «صُحِّح», with one photo and its log; no top-ups, no bar, no refresh', () => {
    const row = rowOf(html, '239');
    expect(row).toContain('data-repair-state="done"');
    expect(row).toContain(ar(`${N}was`));
    expect(row).toContain(ar(`${N}pin.moved`));
    expect(row).toContain('data-repair-log="card-6d-239"');
    expect(row.match(/data-repair-thumb="/gu)).toHaveLength(1);
    expect(html).not.toContain('data-repair-topups');
    expect(html).not.toContain('data-repair-bar');
    expect(html).not.toContain('data-repair-refresh');
    expect(html).toContain('data-repair-pair-tag="done"');
  });
});

describe('partly run', () => {
  it('the done cycle reads corrected; the rest is still reviewed, and the bar counts it', () => {
    const html = view(repairPartial());
    expect(html).toContain('data-repair-status="partial"');
    expect(html).toContain('data-repair-cycle="1" data-repair-unit-state="done"');
    expect(html).toContain('data-repair-cycle="2" data-repair-unit-state="ready"');
    expect(textOf(html)).toContain(ar(`${N}bar.fix`, { cards: '13 كارتًا', all: 17 }));
    expect(html).toContain('data-repair-rulebox="true"');
  });
});

describe('who may run it', () => {
  it('without card edit AND charge approval: no «تنفيذ التصحيح», only who may', () => {
    for (const permissions of [
      VIEW,
      [...VIEW, 'fleetFuelCard.edit'],
      [...VIEW, 'fleetFuelCharge.approve'],
    ]) {
      const html = view(REPAIR_CLEAN, { permissions });
      expect(html, permissions.join()).not.toContain('data-repair-run');
      expect(html, permissions.join()).toContain(ar(`${N}bar.noGrant`));
    }
  });

  it('with no unit ready, the button is off and says why', () => {
    const none = repairChanged269();
    none.readyUnits = [];
    const html = view(none);
    expect(html).toMatch(/data-repair-run="true"[^>]*disabled=""/u);
    expect(html).toContain(ar(`${N}bar.noneReady`));
  });

  it('the route asks `fleetFuelCard.view`; the page reads the dry run under the cards’ subtree', () => {
    const ROUTES = readFileSync(join(HERE, '../routes.tsx'), 'utf8');
    expect(ROUTES).toMatch(
      /path="fuel-cards\/reconcile\/numbers"\s+element=\{\s+<RequirePermission permission="fleetFuelCard\.view">\s+<FuelNumberRepairPage \/>/u,
    );
    expect(NUMBER_REPAIR_PATH).toBe('/fleet/fuel-cards/reconcile/numbers');
    expect(numberRepairKey.slice(0, 2)).toEqual(['fleet', 'fuelCards']);
  });

  it('while the dry run loads, the page shows its shapes', () => {
    expect(wrap(<FuelNumberRepairPage />)).toContain('data-repair-page="loading"');
    expect(wrap(<FuelNumberRepairPage />, EXECUTE, REPAIR_CLEAN)).toContain(
      'data-repair-page="pending"',
    );
  });
});

describe('the box on «مطابقة أرصدة الكروت» (sample 00)', () => {
  it('shows while the repair is pending, for a reader of the cards, and opens the repair', () => {
    const html = wrap(<NumberRepairEntry />, VIEW, REPAIR_CLEAN);
    expect(html).toContain('data-repair-entry="pending"');
    expect(html).toContain(ar(`${N}entry.title`));
    expect(textOf(html)).toContain('2026/10/04');
    expect(html).toContain(`href="${NUMBER_REPAIR_PATH}"`);
    expect(html).toContain(ar(`${N}entry.open`));
  });
  it('takes no room once done, without the grant, or before the dry run is read', () => {
    expect(wrap(<NumberRepairEntry />, VIEW, repairDone())).toBe('');
    expect(wrap(<NumberRepairEntry />, ['fleetFuelCharge.view'], REPAIR_CLEAN)).toBe('');
    expect(wrap(<NumberRepairEntry />, VIEW)).toBe('');
  });
  it('sits on the upload step of the reconcile page', () => {
    const PAGE = readFileSync(join(HERE, 'FuelReconcilePage.tsx'), 'utf8');
    const upload = PAGE.slice(PAGE.indexOf('data-recon-page="upload"'));
    expect(upload.indexOf('<NumberRepairEntry />')).toBeGreaterThan(-1);
    expect(upload.indexOf('<NumberRepairEntry />')).toBeLessThan(
      upload.indexOf('<ReconcileUploadCard'),
    );
  });
});

describe('a photo in a row', () => {
  const photo = REPAIR_CLEAN.cycles[0]!.rows[0]!.photoAfter;
  it('opens the full photo only for a holder of the reveal grant', () => {
    const viewer = wrap(<RepairThumb photo={photo} verdict="ok" />, VIEW);
    expect(viewer).not.toContain('data-repair-thumb-open');
    expect(viewer).toContain('•••• 0935');
    const revealer = wrap(<RepairThumb photo={photo} verdict="ok" />, [
      ...VIEW,
      'fleetFuelCard.reveal',
    ]);
    expect(revealer).toContain(`data-repair-thumb-open="${photo.cardId}"`);
  });
});
