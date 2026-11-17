// The van card of «توزيع المحصنات» and «تسليم المحصنات», the محصنة's chip and the column, rendered for
// real in both languages.
//
// Round 24c — «عاوز احسن شكل الكارد العربيه بالمحصنة يعنى عاوز انقل الاتجاه بعد كود السيارة والوقت»: the
// head is ONE line of code (or «بدون سيارة (n)»), time and direction; a direction cut by the line is
// whole on hover. The column folds on a phone.
//
// Round 25 — «شكل العربية بالمحصنات يتغير يعنى العربيه لو عليها اتنين قادة انا عاوز اللى يظهر اللى انا
// ضيفته ف الاول الصف نفسه بتاع القائد يكون قبله عدد المحصنات اللى على العربيه بعد كدا مش عاوز يظهر
// اخصائيين ولا اجمالى المصرى ولا اجمالى الدولار ولا اجمالى العملات اللى يظهر عدد الكراتين و الحقائب و
// الصناديق حتى لو ب 0 يتكتب»: ONE captain's line — the count, then the FIRST captain; no specialist,
// no money; the three package counts always. «عاوز المحصنة تظهر صغيره عبارة عن البنك والفرع ولما اعمل
// هوفر عليها يجيب بقى معلومتها»: the chip, and its card.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type Locale,
  type OperationsDayBoardVehicleCrewDto,
  type OperationsSecuredDistributionRowDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { translate } from '../../../platform/localization/i18n';
import { formatNumber } from '../../../shared/lib/format';
import { type Packaging, type PackagingRead } from '../lib/secured-distribution';
import {
  ColumnFilterBar,
  DISTRIBUTION_COLUMNS,
  DistributionColumn,
  FilterAreaSelect,
  FilterTextBox,
  PackageCounts,
  ShipmentCardBody,
  ShipmentChip,
  VAN_GRID,
  VanCard,
  hoverIsOnChip,
} from './SecuredDistributionParts';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const tr = (locale: Locale, key: string, vars?: Record<string, string>): string =>
  translate(locale, key, vars);

const render = (node: ReactElement, locale: Locale = 'ar'): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
    </Provider>,
  );
};

const P = (employeeId: string, fullNameAr: string, code: string | null = null) => ({
  employeeId,
  code,
  fullNameAr,
});

const VAN: OperationsDayBoardVehicleCrewDto = {
  crewAssignmentId: 'cr-249',
  vehicleId: 'v-249',
  vehicleCode: '249',
  drivers: [],
  captains: [P('c1', 'عبد الرحمن محمد عبد العزيز الشناوي', 'BR-1')],
  specialist1: [P('s1', 'وليد سيد فوزي')],
  specialist2: [],
  direction: 'السادس من أكتوبر - الشيخ زايد - الواحات البحرية',
  plannedTime: '08:15',
};

const card = (
  van: OperationsDayBoardVehicleCrewDto & { securedType?: boolean; shiftTypeName?: string | null },
  {
    crewPlanVisible = true,
    looseNumber = null,
    locale = 'ar',
    count = 3,
    packages = { bags: 2, cartons: 0, boxes: 1 },
  }: {
    crewPlanVisible?: boolean;
    looseNumber?: string | null;
    locale?: Locale;
    count?: number;
    packages?: Packaging | null;
  } = {},
): string =>
  render(
    <VanCard
      van={van}
      looseNumber={looseNumber}
      crewPlanVisible={crewPlanVisible}
      day="2026-11-16"
      count={count}
      packages={packages}
    >
      <p>load</p>
    </VanCard>,
    locale,
  );

/** The head line's markup. */
const headOf = (html: string): string =>
  html.slice(html.indexOf('data-van-head="true"'), html.indexOf('</header>'));
/** The captain's line. */
const lineOf = (html: string): string =>
  html.slice(html.indexOf('data-van-captain-line='), html.indexOf('data-van-packages='));

describe('the van card’s head — one line', () => {
  for (const locale of ['ar', 'en'] as const) {
    it(`[${locale}] code, then time, then the direction, in one line — the count is not in it`, () => {
      const html = card(VAN, { locale });
      const head = headOf(html);
      expect(head.indexOf('data-van-code="249"')).toBeGreaterThan(-1);
      expect(head.indexOf('data-van-time="08:15"')).toBeGreaterThan(head.indexOf('data-van-code'));
      expect(head.indexOf('data-van-direction=')).toBeGreaterThan(head.indexOf('data-van-time'));
      expect(html).toMatch(
        /data-van-head="true" class="flex min-w-0 flex-1 items-center gap-1\.5"/,
      );
      expect(html).not.toMatch(/data-van-head="true" class="[^"]*flex-wrap/);
      expect(head).not.toContain('data-van-count');
      expect(html.match(/data-van-direction=/g)).toHaveLength(1);
    });
  }

  it('cuts a long direction on the line and says it whole on hover and to a screen reader', () => {
    const head = headOf(card(VAN));
    const whole = 'السادس من أكتوبر - الشيخ زايد - الواحات البحرية';
    expect(head).toContain(`title="${tr('ar', 'operations.crew.direction')}: ${whole}"`);
    expect(head).toContain(`class="min-w-0 truncate">${whole}<`);
    expect(head).toContain(`class="sr-only">${tr('ar', 'operations.crew.direction')}: <`);
    expect(head).toContain(`title="${tr('ar', 'operations.crew.plannedTime')}: 08:15"`);
  });

  it('a crew without a van: «بدون سيارة (n)» where the code goes, the no-van mark, the same line', () => {
    const html = card(
      { ...VAN, crewAssignmentId: 'cr-loose', vehicleId: null, vehicleCode: null },
      { looseNumber: '٢' },
    );
    expect(html).toContain('data-no-van="true"');
    expect(headOf(html)).toContain(`>${tr('ar', 'operations.crewPlan.looseRow', { n: '٢' })}<`);
    expect(html).toContain(
      `aria-label="${tr('ar', 'operations.distribution.looseLabel', { n: '٢' })}"`,
    );
  });

  it('no direction: «بلا اتجاه», quietly — no time: no time chip', () => {
    const head = headOf(card({ ...VAN, direction: '  ', plannedTime: null }));
    expect(head).toContain(`>${tr('ar', 'operations.distribution.noDirection')}<`);
    expect(head).not.toContain('data-van-time');
  });

  it('the whole card is the van’s drop mark — head, captain’s line, packages and load alike', () => {
    const html = card(VAN);
    expect(html).toMatch(/^<article data-distribution-van="cr-249" data-drop-van="cr-249"/);
    expect(html.indexOf('data-van-load="cr-249"')).toBeGreaterThan(-1);
  });
});

describe('Round 25 — the captain’s line', () => {
  it('the count FIRST, in its Arabic form, then the captain with his mark, his name cut and a card trigger', () => {
    const line = lineOf(card(VAN));
    expect(line).toMatch(/^data-van-captain-line="cr-249"[^>]*><span data-van-count="3"/);
    expect(line).toContain(
      `>${tr('ar', 'operations.distribution.loadCount.few', { count: '3' })}<`,
    );
    expect(line.indexOf('data-van-count')).toBeLessThan(line.indexOf('data-van-captain="c1"'));
    expect(line).toMatch(
      new RegExp(
        `data-captain-mark="true"[^>]*>[\\s\\S]*?${tr('ar', 'operations.crewPlan.role.captain')}</span><span data-van-person="c1" class="min-w-0 truncate[^"]*" tabindex="0">عبد الرحمن محمد عبد العزيز الشناوي</span>`,
      ),
    );
  });

  it('two captains: only the FIRST one put on the row', () => {
    const html = card({
      ...VAN,
      captains: [P('c1', 'أحمد فتحي السيد'), P('c2', 'كريم سمير علي')],
    });
    expect(html).toContain('data-van-captain="c1"');
    expect(html).not.toContain('data-van-captain="c2"');
    expect(html).not.toContain('كريم سمير علي');
    expect(html.match(/data-captain-mark="true"/g)).toHaveLength(1);
  });

  it('no captain: the count, then «بلا قائد» in red — the van takes nothing', () => {
    const html = card({ ...VAN, captains: [] }, { count: 0 });
    const line = lineOf(html);
    expect(line).toMatch(
      /^data-van-captain-line="cr-249"[^>]*bg-rose-50[^>]*><span data-van-count="0"/,
    );
    expect(line).toMatch(
      new RegExp(
        `data-van-captain="none"[\\s\\S]*${tr('ar', 'operations.distribution.noCaptain')}`,
      ),
    );
    expect(html).not.toContain('data-captain-mark');
  });

  it('no specialist and no money — whoever rides in the slots', () => {
    const html = card(VAN);
    expect(html).not.toContain('وليد سيد فوزي');
    expect(html).not.toContain('data-van-slot');
    expect(html).not.toContain('data-money=');
    expect(html).not.toContain(tr('ar', 'operations.reportBoard.pound'));
    expect(html).not.toContain(tr('ar', 'operations.board.figures.otherCurrencies'));
  });

  it('a row of another type kept for what it carries says so, with its type', () => {
    const html = card({ ...VAN, securedType: false, shiftTypeName: 'سفر' });
    expect(html).toContain('data-not-secured="true"');
    expect(html).toMatch(
      new RegExp(
        `data-van-not-secured="سفر" title="${tr('ar', 'operations.distribution.notSecuredHint', { type: 'سفر' })}"`,
      ),
    );
    expect(html).toContain(tr('ar', 'operations.distribution.notSecured'));
    expect(card(VAN)).not.toContain('data-not-secured');
    const untyped = card({ ...VAN, securedType: false, shiftTypeName: null });
    expect(untyped).toContain(
      `title="${tr('ar', 'operations.distribution.notSecuredHintNoType')}"`,
    );
  });
});

describe('Round 25 — the packages, always', () => {
  for (const locale of ['ar', 'en'] as const) {
    it(`[${locale}] cartons, bags and boxes in that order, a 0 written`, () => {
      const html = render(<PackageCounts packages={{ bags: 0, cartons: 0, boxes: 0 }} />, locale);
      expect(html).toContain('data-van-packages="0/0/0"');
      const at = ['cartons', 'bags', 'boxes'].map((kind) =>
        html.indexOf(`data-van-package="${kind}"`),
      );
      expect(at.every((i) => i > -1)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      // «0», never an Arabic zero that reads as a dot — and never left out.
      expect(html.match(/>0</g)).toHaveLength(3);
      for (const kind of ['cartons', 'bags', 'boxes']) {
        expect(html).toContain(tr(locale, `operations.distribution.${kind}`));
      }
    });
  }

  it('says «—» with why when the reader cannot read the vault’s counts — never a 0 that would be a guess', () => {
    const html = render(<PackageCounts packages={null} />);
    expect(html).toContain('data-van-packages="unknown"');
    expect(html).toContain(`title="${tr('ar', 'operations.distribution.packagesUnknown')}"`);
    expect(html.match(/>—</g)).toHaveLength(3);
  });

  for (const locale of ['ar', 'en'] as const) {
    it(`[${locale}] never a 0 before the vault’s counts are in — «…» while the read is out, «—» when it failed`, () => {
      const pending = render(<PackageCounts packages="pending" />, locale);
      expect(pending).toContain('data-van-packages="pending"');
      expect(pending).toContain(`title="${tr(locale, 'operations.distribution.packagesPending')}"`);
      expect(pending).toContain('aria-busy="true"');
      expect(pending.match(/>…</g)).toHaveLength(3);
      expect(pending).not.toMatch(/>0</);
      const failed = render(<PackageCounts packages="failed" />, locale);
      expect(failed).toContain('data-van-packages="failed"');
      expect(failed).toContain(`title="${tr(locale, 'operations.distribution.packagesFailed')}"`);
      expect(failed).not.toContain('aria-busy');
      expect(failed.match(/>—</g)).toHaveLength(3);
      expect(failed).not.toMatch(/>0</);
    });
  }

  it('on the van card, under the captain’s line', () => {
    const html = card(VAN, { packages: { bags: 2, cartons: 0, boxes: 1 } });
    expect(html).toContain('data-van-packages="0/2/1"');
    expect(html.indexOf('data-van-captain-line')).toBeLessThan(html.indexOf('data-van-packages'));
    expect(html.indexOf('data-van-packages')).toBeLessThan(html.indexOf('data-van-load'));
  });
});

const ROW = {
  id: 's-1',
  shipmentType: 'secured',
  status: 'inVault',
  mainBankId: 'b-1',
  secondaryBankId: null,
  originBranchId: 'o',
  destinationBranchId: 'd',
  areaName: 'المعادي',
  lines: [{ currencyId: 'egp', amount: 1_500_000 }],
  collectionDate: '2026-11-16T00:00:00.000Z',
  deliveryDate: '2026-11-16T00:00:00.000Z',
  receiptNumber: null,
  vaultReceiptNumber: 'V-77',
  receiptImage: null,
  serialTracked: false,
  notes: null,
  receivedById: null,
  receivedAt: null,
  version: 1,
  createdAt: '2026-11-15T00:00:00.000Z',
  updatedAt: '2026-11-15T00:00:00.000Z',
  origin: { id: 'o', name: 'فرع المهندسين', code: 'O1', bankId: 'b-1', bankName: 'الأهلي' },
  destination: { id: 'd', name: 'فرع المعادي', code: 'D1', bankId: 'b-1', bankName: 'الأهلي' },
  crew: null,
  captainDeliveredAt: null,
  securedStage: 'inVault',
  pickedUpBy: 'captain',
  pickedUpAt: null,
  vaultReceivedAt: '2026-11-15T09:00:00.000Z',
  overdue: false,
  delivery: null,
  deliveryLegVersion: null,
  placedCrewAssignmentId: null,
  directionCrewAssignmentIds: [],
} as OperationsSecuredDistributionRowDto;

describe('Round 25 — the محصنة’s chip', () => {
  const chip = (drag: boolean, locale: Locale = 'ar') =>
    render(
      <ShipmentChip
        row={ROW}
        bankName="الأهلي"
        branchName="فرع المعادي"
        card={<p data-the-card="true">card</p>}
        move={<button type="button" data-move-open="s-1" />}
        {...(drag
          ? { drag: { dragging: false, onDragStart: () => undefined, onDragEnd: () => undefined } }
          : {})}
      />,
      locale,
    );

  it('is small: the stage’s mark, «البنك · الفرع», «نقل إلى…» — nothing else on it', () => {
    const html = chip(true);
    expect(html).toMatch(/^<div[^>]*data-distribution-shipment="s-1"/);
    expect(html).toContain('draggable="true"');
    expect(html).toContain('data-secured-stage="inVault"');
    expect(html).toMatch(
      /data-chip-text="true"[^>]*><span[^>]*>الأهلي<\/span><span aria-hidden="true"[^>]*> · <\/span><span data-chip-branch="true"[^>]*>فرع المعادي<\/span>/,
    );
    expect(html).toContain('data-move-open="s-1"');
    expect(html).toContain('aria-label="الأهلي · فرع المعادي"');
    // The money, the area and the stage's words are the card's, not the chip's.
    expect(html).not.toContain('1,500,000');
    expect(html).not.toContain('data-shipment-area');
    // A tab stop: a keyboard focus opens its card; not open until then.
    expect(html).toContain('tabindex="0"');
    expect(html).not.toContain('data-the-card');
  });

  it('a held leg is not draggable', () => {
    expect(chip(false)).toContain('draggable="false"');
  });

  // Critic — the «نقل إلى…» menu is a portal React counts inside the chip: a pointer coming into the
  // menu from outside fired the chip's mouseenter, and its card opened over the menu's vans.
  it('opens its card on a hover on the chip only — not from its menu’s portal, not while the menu is open', () => {
    const fakeChip = (inside: readonly unknown[], menuOpen: boolean) => ({
      contains: (node: unknown) => inside.includes(node),
      querySelector: (selector: string) =>
        menuOpen && selector === '[data-move-open][aria-expanded="true"]' ? {} : null,
    });
    const own = { own: true } as unknown as EventTarget;
    const menuItem = { portal: true } as unknown as EventTarget;
    expect(hoverIsOnChip(fakeChip([own], false) as never, own)).toBe(true);
    expect(hoverIsOnChip(fakeChip([own], false) as never, menuItem)).toBe(false);
    expect(hoverIsOnChip(fakeChip([own], true) as never, own)).toBe(false);
    expect(hoverIsOnChip(fakeChip([own], false) as never, null)).toBe(false);
    // The chip's mouseenter goes through it; the hook's own is not spread on the chip.
    const parts = readFileSync(
      fileURLToPath(new URL('./SecuredDistributionParts.tsx', import.meta.url)),
      'utf8',
    );
    expect(parts).toContain(
      'const { onDragStart: closeOnDrag, onMouseEnter: hoverIn, ...trigger } = hover.triggerProps;',
    );
    expect(parts).toMatch(
      /onMouseEnter=\{\(event\) => \{\s*if \(!hoverIsOnChip\(event\.currentTarget, event\.target\)\) return;\s*hoverIn\?\.\(\);/,
    );
  });
});

describe('Round 25 — the chip’s card says the rest', () => {
  const body = (
    packages: Packaging | undefined,
    readable = true,
    locale: Locale = 'ar',
    read: PackagingRead = readable ? 'ready' : 'forbidden',
  ) =>
    render(
      <ShipmentCardBody
        row={{ ...ROW, overdue: true }}
        bankName="الأهلي"
        money={[
          { key: 'egp', label: 'مصري', amount: 1_500_000 },
          { key: 'usd', label: 'دولار', amount: 20_000 },
        ]}
        packages={packages}
        packagesRead={read}
        place="السيارة 249 · مع أحمد"
        notes={[{ key: 'proposed', text: 'مقترحة', tone: 'warn' }]}
      />,
      locale,
    );

  it('the bank, its stage, from → to, the area, the day, the amounts, the packages, the receipt, where it is, the marks', () => {
    const html = body({ bags: 2, cartons: 1, boxes: 0 });
    expect(html).toContain('data-secured-card="s-1"');
    expect(html).toContain('data-secured-stage="inVault"');
    for (const key of ['from', 'to', 'deliveryDay', 'amounts', 'packages', 'receipt', 'on']) {
      expect(html).toContain(`>${tr('ar', `operations.distribution.card.${key}`)}<`);
    }
    expect(html).toContain('فرع المهندسين');
    expect(html).toContain('فرع المعادي');
    expect(html).toContain('المعادي');
    expect(html).toContain(tr('ar', 'operations.distribution.overdue'));
    expect(html).toMatch(/data-card-money="egp"[\s\S]*1,500,000[\s\S]*مصري/);
    expect(html).toMatch(/data-card-money="usd"[\s\S]*20,000[\s\S]*دولار/);
    expect(html).toContain('data-card-packages="1/2/0"');
    expect(html).toContain('V-77');
    expect(html).toContain('السيارة 249 · مع أحمد');
    expect(html).toContain('data-card-note="proposed"');
  });

  it('not counted yet: says so; no vault grant: no package line at all', () => {
    expect(body(undefined)).toContain(tr('ar', 'operations.distribution.card.notCounted'));
    expect(body(undefined, false)).not.toContain(
      `>${tr('ar', 'operations.distribution.card.packages')}<`,
    );
  });

  // Critic — the vault's read still out or failed: the card said «لم تُعدّ بعد، فهي ليست بالخزينة»
  // about a shipment its own stage badge marks «بالخزينة».
  for (const locale of ['ar', 'en'] as const) {
    it(`[${locale}] the vault’s read out or failed: says that — never «not in the vault»`, () => {
      const pending = body(undefined, true, locale, 'pending');
      expect(pending).toContain(`>${tr(locale, 'operations.distribution.card.packages')}<`);
      expect(pending).toContain('data-card-packages="pending"');
      expect(pending).toContain(tr(locale, 'operations.distribution.packagesPending'));
      expect(pending).not.toContain(tr(locale, 'operations.distribution.card.notCounted'));
      const failed = body(undefined, true, locale, 'failed');
      expect(failed).toContain('data-card-packages="failed"');
      expect(failed).toContain(tr(locale, 'operations.distribution.packagesFailed'));
      expect(failed).not.toContain(tr(locale, 'operations.distribution.card.notCounted'));
    });
  }

  it('in English, in English words', () => {
    const html = body({ bags: 0, cartons: 0, boxes: 0 }, true, 'en');
    expect(html).toContain(`>${tr('en', 'operations.distribution.card.amounts')}<`);
    expect(tr('en', 'operations.distribution.card.amounts')).toBe('Amounts');
  });
});

describe('Round 25 — a column’s filter bar', () => {
  const bar = (active: boolean) =>
    render(
      <ColumnFilterBar
        data-filter-bar="vans"
        active={active}
        shown={2}
        total={7}
        onClear={() => undefined}
      >
        <FilterTextBox
          data-filter="van-code"
          label="كود السيارة"
          value=""
          onChange={() => undefined}
        />
        <FilterAreaSelect
          data-filter="van-area"
          label="المنطقة"
          allLabel="كل المناطق"
          value=""
          options={[
            { value: 'المعادي', label: 'المعادي' },
            { value: 'none', label: 'بلا اتجاه' },
          ]}
          onChange={() => undefined}
        />
      </ColumnFilterBar>,
    );

  it('its boxes, each named for a screen reader; the areas offered after «كل المناطق»', () => {
    const html = bar(false);
    expect(html).toContain('role="search"');
    expect(html).toMatch(
      /data-filter="van-code"[^>]*aria-label="كود السيارة"|aria-label="كود السيارة"[^>]*data-filter="van-code"/,
    );
    expect(html).toContain('placeholder="كود السيارة"');
    expect(html).toMatch(
      /<option value=""[^>]*>كل المناطق<\/option><option value="المعادي">المعادي<\/option><option value="none">بلا اتجاه<\/option>/,
    );
    expect(html).not.toContain('data-filter-clear');
  });

  it('set, it says what it leaves and offers to clear', () => {
    const html = bar(true);
    expect(html).toContain('data-filter-shown="2/7"');
    expect(html).toContain(
      tr('ar', 'operations.distribution.filter.shown', {
        shown: formatNumber(2, 'ar'),
        total: formatNumber(7, 'ar'),
      }),
    );
    expect(html).toContain(`>${tr('ar', 'operations.distribution.filter.clear')}<`);
  });
});

describe('the columns', () => {
  it('three quarters for the vans on a wide screen, as many cards to a row as fit', () => {
    expect(DISTRIBUTION_COLUMNS).toContain('lg:grid-cols-[minmax(0,3fr)_minmax(17rem,1fr)]');
    expect(DISTRIBUTION_COLUMNS).not.toContain('2fr');
    expect(VAN_GRID).toContain('grid-cols-[repeat(auto-fill,minmax(min(100%,17.5rem),1fr))]');
  });

  const column = (open: boolean | null): string =>
    render(
      <DistributionColumn
        title="بلا سيارة"
        count={4}
        icon={['M0 0']}
        data-distribution-column="unplaced"
        {...(open === null ? {} : { collapse: { open, onToggle: () => undefined } })}
      >
        <p data-body="true">body</p>
      </DistributionColumn>,
    );

  it('folds on a phone: the head is a button saying whether it is open; folded, the body is hidden', () => {
    const open = column(true);
    expect(open).toContain('data-column-open="true"');
    expect(open).toMatch(
      /<button type="button" data-column-toggle="true" aria-expanded="true" aria-controls="[^"]+"/,
    );
    expect(open).not.toMatch(/hidden=""[^>]*>\s*<p data-body/);
    const folded = column(false);
    expect(folded).toContain('data-column-open="false"');
    expect(folded).toContain('aria-expanded="false"');
    expect(folded).toMatch(/hidden=""[^>]*><p data-body="true">/);
  });

  it('a computer: no fold, the head is a plain head', () => {
    const html = column(null);
    expect(html).not.toContain('data-column-toggle');
    expect(html).not.toContain('data-column-open');
    expect(html).not.toContain('hidden=""');
  });
});
