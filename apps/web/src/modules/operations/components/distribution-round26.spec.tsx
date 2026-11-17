// Round 26 on «توزيع المحصنات» and «تسليم المحصنات», rendered for real in both languages. The owner:
//   · «عاوز الفلاتر دول يكونوا جمبب السيارات و بلا سيارات» — each column's filter boxes on its title's
//     line, no row of their own;
//   · «لما اقف على العربية يطلع كارت بقى بالقادة والاخصائيين اللى على العربيه والسواقيين» — the van's
//     card: every captain, both specialist slots, the drivers, and what it carries;
//   · «عاوزك تضيف الوان عشان حاسس ان مش اقدر اميز اوى العربيه والمحصنات اللى عليها والاعداد وكدا» —
//     each van in its colour, every chip on it in the same, the counts each in theirs.
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
import { type Packaging } from '../lib/secured-distribution';
import { type VanAccent } from '../lib/van-accent';
import {
  ColumnFilterBar,
  CountChip,
  DistributionColumn,
  FilterAreaSelect,
  FilterTextBox,
  ShipmentCardBody,
  ShipmentChip,
  VAN_GRID,
  VanCard,
  VanCrewCardBody,
} from './SecuredDistributionParts';
import { COUNT_LOOK, COUNT_ZERO, SHIPMENTS_BADGE, VAN_ACCENT_LOOK } from './distribution-look';
import { SHIFT_TYPE_TONE } from './shift-type-look';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const tr = (locale: Locale, key: string, vars?: Record<string, string>): string =>
  translate(locale, key, vars);
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const PARTS = read('./SecuredDistributionParts.tsx');
const HOVER = read('../../fleet/components/HoverCardLayer.tsx');
const DIST = read('../pages/SecuredDistributionPage.tsx');
const HANDOVER = read('../pages/VaultHandoverPage.tsx');

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

/** Two captains, two in «أخصائي 1», one in «أخصائي 2», two drivers. */
const VAN: OperationsDayBoardVehicleCrewDto = {
  crewAssignmentId: 'cr-112',
  vehicleId: 'v-112',
  vehicleCode: '112',
  drivers: [
    { employeeId: 'd1', fullNameAr: 'أيمن فاروق شحاتة' },
    { employeeId: 'd2', fullNameAr: 'طارق محمود سليمان' },
  ],
  captains: [P('c7', 'عبد الرحمن الشناوي', 'BR-107'), P('c8', 'كريم سمير علي', 'BR-108')],
  specialist1: [P('s1', 'وليد سيد فوزي', 'SP-1'), P('s3', 'ياسر عبد الحميد', 'SP-3')],
  specialist2: [P('s4', 'إسلام مسعد عويس', 'SP-4')],
  direction: 'السادس من أكتوبر - الشيخ زايد',
  plannedTime: '07:15',
};

const PACKAGES: Packaging = { bags: 4, cartons: 2, boxes: 0 };

const vanCard = (
  over: Partial<OperationsDayBoardVehicleCrewDto> = {},
  {
    locale = 'ar',
    crewPlanVisible = true,
    looseNumber = null,
    accent = 'forest',
  }: {
    locale?: Locale;
    crewPlanVisible?: boolean;
    looseNumber?: string | null;
    accent?: VanAccent | null;
  } = {},
): string =>
  render(
    <VanCrewCardBody
      van={{ ...VAN, ...over }}
      looseNumber={looseNumber}
      accent={accent}
      crewPlanVisible={crewPlanVisible}
      count={2}
      packages={PACKAGES}
    />,
    locale,
  );

/** One slot of the van's card. */
const slotOf = (html: string, slot: string): string => {
  const at = html.indexOf(`data-van-card-slot="${slot}"`);
  expect(at, slot).toBeGreaterThan(-1);
  const next = html.indexOf('data-van-card-slot="', at + 10);
  return html.slice(at, next === -1 ? html.indexOf('data-van-card-counts') : next);
};

describe('A — the filters on the title’s line', () => {
  const column = (
    filtersFit: 'wide' | 'narrow',
    collapse: { open: boolean } | null = null,
  ): string =>
    render(
      <DistributionColumn
        title="بلا سيارة"
        count={3}
        icon={['M0 0']}
        data-distribution-column="unplaced"
        filtersFit={filtersFit}
        {...(collapse === null
          ? {}
          : { collapse: { open: collapse.open, onToggle: () => undefined } })}
        filters={
          <ColumnFilterBar
            data-filter-bar="unplaced"
            narrow={filtersFit === 'narrow'}
            active={false}
            shown={3}
            total={3}
            onClear={() => undefined}
          >
            <FilterTextBox
              data-filter="unplaced-search"
              label={tr('ar', 'operations.distribution.filter.search')}
              placeholder={tr('ar', 'operations.distribution.filter.searchShort')}
              fit="narrow"
              value=""
              onChange={() => undefined}
            />
            <FilterAreaSelect
              data-filter="unplaced-area"
              label={tr('ar', 'operations.distribution.filter.area')}
              allLabel={tr('ar', 'operations.distribution.filter.allAreasShort')}
              fit="narrow"
              value=""
              options={[{ value: 'm', label: 'المعادي' }]}
              onChange={() => undefined}
            />
          </ColumnFilterBar>
        }
      >
        <p data-body="true">body</p>
      </DistributionColumn>,
    );

  it('puts the boxes INSIDE the head, after the title and its count — no filter row of their own', () => {
    const html = column('narrow');
    const head = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    expect(head.indexOf('data-column-title="true"')).toBeGreaterThan(-1);
    expect(head.indexOf('data-column-filters="narrow"')).toBeGreaterThan(
      head.indexOf('data-column-title="true"'),
    );
    expect(head).toContain('data-filter="unplaced-search"');
    expect(head).toContain('data-filter="unplaced-area"');
    // Nothing between the head and the body.
    expect(html.slice(html.indexOf('</header>'))).not.toContain('data-column-filters');
    expect(html).toMatch(/<\/header><div[^>]*id="[^"]+"[^>]*><p data-body="true">/);
  });

  it('the left column’s quarter: compact boxes that share the title’s line at every computer width', () => {
    const html = column('narrow');
    // R26 critic — a fixed 9.25rem basis wrapped the boxes under the title again once the count
    // had three figures («بلا سيارة 113») or the words were English («Not on a van»): the bar now
    // takes what the line has left (basis 0 — it never wraps), and its two boxes share it on ONE
    // row, shrinking together.
    expect(html).toMatch(/data-column-filters="narrow" class="flex min-w-0 flex-1 basis-0"/);
    expect(html).toMatch(
      /<div data-filter-boxes="true" class="flex w-full min-w-0 flex-nowrap items-center gap-1\.5">/,
    );
    expect(html).not.toContain('basis-[9.25rem]');
    // The head is a container: narrower than its title and two boxes, it drops its drawing.
    expect(html).toContain('[container-type:inline-size]');
    expect(html).toContain('[@container(max-width:20.5rem)]:hidden');
    // The title is as tall as the boxes, on their line.
    expect(html).toContain('data-column-title="true" class="flex min-h-[2.125rem]');
    // The whole names stay — for a screen reader and on hover; the boxes say less.
    expect(html).toContain(`aria-label="${tr('ar', 'operations.distribution.filter.search')}"`);
    expect(html).toContain(`title="${tr('ar', 'operations.distribution.filter.search')}"`);
    expect(html).toContain(
      `placeholder="${tr('ar', 'operations.distribution.filter.searchShort')}"`,
    );
    expect(html).toContain(`aria-label="${tr('ar', 'operations.distribution.filter.area')}"`);
    expect(html).toContain(`>${tr('ar', 'operations.distribution.filter.allAreasShort')}</option>`);
    expect(html).toContain('!text-[12px]');
  });

  it('the vans’ wide head gives its three boxes room to sit beside the title', () => {
    expect(column('wide')).toMatch(
      /data-column-filters="wide" class="flex min-w-0 flex-1 basis-\[26rem\]"/,
    );
  });

  it('R26 critic — the column’s drawing gives way only to a narrow filter bar: a head with none keeps it', () => {
    // «تسليم المحصنات»'s left column has no filter bar: its head is narrower than 20.5rem at every
    // computer width, and its drawing went for nothing.
    const bare = render(
      <DistributionColumn title="بلا سيارة" count={6} icon={['M0 0']} data-distribution-column="x">
        <p>body</p>
      </DistributionColumn>,
    );
    expect(bare).not.toContain('[@container(max-width:20.5rem)]:hidden');
    expect(column('wide')).not.toContain('[@container(max-width:20.5rem)]:hidden');
    expect(column('narrow')).toContain('[@container(max-width:20.5rem)]:hidden');
  });

  it('R26 critic — every count on these screens in the figures’ face: «113», never «١١٣» beside a «113»', () => {
    // The page's bar writes 113 (`formatAmount`, so a 0 is never a dot); the column's own count and
    // «المعروض … من …» said ١١٣ — the same figure in two numeral systems on one screen.
    const html = render(
      <DistributionColumn
        title="بلا سيارة"
        count={113}
        icon={['M0 0']}
        data-distribution-column="x"
      >
        <p>body</p>
      </DistributionColumn>,
    );
    expect(html).toContain('>113</span>');
    expect(html).not.toMatch(/[\u0660-\u0669]/);
    const bar = render(
      <ColumnFilterBar active narrow shown={112} total={113} onClear={() => undefined}>
        <span />
      </ColumnFilterBar>,
    );
    expect(bar).toContain(
      tr('ar', 'operations.distribution.filter.shown', { shown: '112', total: '113' }),
    );
    expect(bar).not.toMatch(/[\u0660-\u0669]/);
    // The pages: a count goes through `formatAmount` — only a crew's NAME («بدون سيارة (n)», the
    // board's own words) keeps the locale's digits.
    for (const page of [DIST, HANDOVER]) {
      const uses = page.match(/formatNumber\([^)]*\)/g) ?? [];
      expect(uses).toEqual(['formatNumber(number, locale)']);
    }
    expect(PARTS.match(/formatNumber\(/g) ?? []).toHaveLength(0);
  });

  it('a phone: the boxes on a line of their own under the fold’s toggle; folded, gone with the body', () => {
    const open = column('narrow', { open: true });
    expect(open).toMatch(/data-column-filters="narrow" class="flex min-w-0 flex-1 basis-full"/);
    expect(open.indexOf('data-column-toggle')).toBeLessThan(open.indexOf('data-column-filters'));
    const folded = column('narrow', { open: false });
    expect(folded).not.toContain('data-column-filters');
    expect(folded).toContain('aria-expanded="false"');
  });

  it('a filter in use: «المعروض … · مسح التصفية» under the left’s boxes, at the end of the vans’ line', () => {
    const bar = (narrow: boolean) =>
      render(
        <ColumnFilterBar active narrow={narrow} shown={1} total={3} onClear={() => undefined}>
          <span />
        </ColumnFilterBar>,
      );
    // R26 verify: in the left's quarter the line is as wide as its two boxes (156px at 1024,
    // 170 at 1280) while «المعروض ٣ من ٦» + «مسح التصفية» need ~172 — it wraps, never runs past
    // the column's edge (it ran 16px out at 1024).
    expect(bar(true)).toMatch(
      /<span data-filter-active="narrow" class="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-0\.5">/,
    );
    expect(bar(false)).toMatch(
      /<span data-filter-active="wide" class="flex min-w-0 items-center gap-2 ms-auto shrink-0">/,
    );
    expect(bar(true)).toContain('data-filter-clear="true"');
    // R26 critic — and inside it, neither part is wider than the bar: «المعروض ١١٢ من ١١٣» and
    // «Clear the filter» may each break onto a second line in the narrow bar (both were nowrap,
    // and «مسح التصفية» ran 3–24px past the column's edge at 1280–1440).
    const narrow = bar(true);
    expect(narrow).toMatch(/data-filter-shown="1\/3" class="min-w-0 break-words text-\[11px\]/);
    expect(narrow).toMatch(
      /data-filter-clear="true" class="inline-flex min-w-0 items-start gap-1 rounded-md px-1\.5 py-0\.5 text-start/,
    );
    const wide = bar(false);
    expect(wide).toMatch(/data-filter-shown="1\/3" class="whitespace-nowrap/);
    expect(wide).toMatch(/data-filter-clear="true" class="inline-flex shrink-0/);
  });

  for (const locale of ['ar', 'en'] as const) {
    it(`[${locale}] the short words exist in both languages, and are shorter`, () => {
      const short = tr(locale, 'operations.distribution.filter.searchShort');
      const whole = tr(locale, 'operations.distribution.filter.search');
      expect(short).not.toBe('operations.distribution.filter.searchShort');
      expect(short.length).toBeLessThan(whole.length);
      const allShort = tr(locale, 'operations.distribution.filter.allAreasShort');
      expect(allShort.length).toBeLessThan(
        tr(locale, 'operations.distribution.filter.allAreas').length,
      );
    });
  }
});

describe('B — the van’s card', () => {
  for (const locale of ['ar', 'en'] as const) {
    it(`[${locale}] every captain in the order put on the row, the first marked as the one shown`, () => {
      const html = vanCard({}, { locale });
      expect(html).toContain('data-van-card="cr-112"');
      const captains = slotOf(html, 'captains');
      expect(captains).toContain('data-van-card-count="2"');
      expect(captains.indexOf('data-van-card-person="c7"')).toBeLessThan(
        captains.indexOf('data-van-card-person="c8"'),
      );
      expect(captains).toContain('عبد الرحمن الشناوي');
      expect(captains).toContain('BR-107');
      expect(captains).toContain('كريم سمير علي');
      // The mark sits with the first one only.
      const first = captains.slice(0, captains.indexOf('data-van-card-person="c8"'));
      expect(first).toContain('data-van-card-shown="true"');
      expect(first).toContain(tr(locale, 'operations.distribution.vanCard.shown'));
      expect(captains.match(/data-van-card-shown/g)).toHaveLength(1);
      expect(html).toContain(`>${tr(locale, 'operations.distribution.captains')}<`);
    });

    it(`[${locale}] both specialist slots, everyone in each, then the drivers by name`, () => {
      const html = vanCard({}, { locale });
      const one = slotOf(html, 'specialist1');
      expect(one).toContain('data-van-card-count="2"');
      expect(one).toContain('وليد سيد فوزي');
      expect(one).toContain('ياسر عبد الحميد');
      const two = slotOf(html, 'specialist2');
      expect(two).toContain('data-van-card-count="1"');
      expect(two).toContain('إسلام مسعد عويس');
      const drivers = slotOf(html, 'drivers');
      expect(drivers).toContain('أيمن فاروق شحاتة');
      expect(drivers).toContain('طارق محمود سليمان');
      for (const key of [
        'operations.crew.slot.specialist1',
        'operations.crew.slot.specialist2',
        'operations.board.card.drivers',
      ]) {
        expect(html).toContain(`>${tr(locale, key)}<`);
      }
      // In the order: captains, specialist 1, specialist 2, drivers.
      const at = ['captains', 'specialist1', 'specialist2', 'drivers'].map((slot) =>
        html.indexOf(`data-van-card-slot="${slot}"`),
      );
      expect([...at].sort((a, b) => a - b)).toEqual(at);
    });

    it(`[${locale}] the van, its time and its direction head the card, in their colours`, () => {
      const html = vanCard({}, { locale });
      const head = html.slice(0, html.indexOf('<dl'));
      expect(head).toContain('data-van-swatch="forest"');
      expect(head).toContain('data-van-code="112"');
      expect(head).toContain(VAN_ACCENT_LOOK.forest.pill);
      expect(head).toContain('data-van-time="07:15"');
      expect(head).toContain('data-van-direction="السادس من أكتوبر - الشيخ زايد"');
      // The direction whole on the card — never cut.
      expect(head).toContain('class="min-w-0 break-words">السادس من أكتوبر - الشيخ زايد<');
    });

    it(`[${locale}] what it carries: the محصنات badge, then the packages each in its colour`, () => {
      const html = vanCard({}, { locale });
      const counts = html.slice(html.indexOf('data-van-card-counts'));
      expect(counts).toContain('data-van-card-count-of="shipments"');
      expect(counts).toContain(
        `>${tr(locale, locale === 'ar' ? 'operations.distribution.loadCount.two' : 'operations.distribution.loadCount.other', { count: '2' })}<`,
      );
      for (const kind of ['cartons', 'bags', 'boxes'] as const) {
        expect(counts).toContain(`data-van-card-count-of="${kind}"`);
        expect(counts).toContain(tr(locale, `operations.distribution.${kind}`));
      }
      // 2 cartons, 4 bags in their colours; 0 boxes grey.
      expect(counts).toMatch(
        new RegExp(
          `data-van-card-count-of="cartons" data-count-kind="cartons" class="[^"]*${literal(COUNT_LOOK.cartons.chip)}`,
        ),
      );
      expect(counts).toMatch(
        new RegExp(
          `data-van-card-count-of="boxes" data-count-kind="boxes" data-count-zero="true" class="[^"]*${literal(COUNT_ZERO)}`,
        ),
      );
    });

    it(`[${locale}] an empty slot says «لا يوجد»; a slot withheld says who may see it`, () => {
      const empty = vanCard({ specialist2: [], drivers: [] }, { locale });
      expect(slotOf(empty, 'specialist2')).toContain('data-van-card-state="empty"');
      expect(slotOf(empty, 'specialist2')).toContain(
        tr(locale, 'operations.distribution.vanCard.none'),
      );
      expect(slotOf(empty, 'drivers')).toContain(
        tr(locale, 'operations.distribution.vanCard.none'),
      );
      const hidden = vanCard(
        { specialist1: [], specialist2: [], drivers: [] },
        { locale, crewPlanVisible: false },
      );
      for (const slot of ['specialist1', 'specialist2', 'drivers']) {
        expect(slotOf(hidden, slot)).toContain('data-van-card-state="hidden"');
        expect(slotOf(hidden, slot)).toContain(
          tr(locale, 'operations.distribution.vanCard.hidden'),
        );
      }
      // The captains are every reader's.
      expect(slotOf(hidden, 'captains')).toContain('عبد الرحمن الشناوي');
      const none = vanCard({ captains: [] }, { locale });
      expect(slotOf(none, 'captains')).toContain(
        tr(locale, 'operations.distribution.vanCard.none'),
      );
    });

    it(`[${locale}] a crew without a van: «بدون سيارة (n)», and no van to drive`, () => {
      const html = vanCard(
        { crewAssignmentId: 'cr-loose', vehicleId: null, vehicleCode: null, drivers: [] },
        { locale, looseNumber: '2' },
      );
      expect(html).toContain(`>${tr(locale, 'operations.crewPlan.looseRow', { n: '2' })}<`);
      expect(slotOf(html, 'drivers')).toContain('data-van-card-state="noVan"');
      expect(slotOf(html, 'drivers')).toContain(
        tr(locale, 'operations.distribution.vanCard.noVan'),
      );
    });
  }

  it('one captain: no «shown» mark — there is no other to tell him from', () => {
    expect(vanCard({ captains: [P('c1', 'أحمد فتحي')] })).not.toContain('data-van-card-shown');
  });

  it('opens on the head and the captain’s line — not on the packages, not on a chip — through the shared layer', () => {
    const html = render(
      <VanCard
        van={VAN}
        crewPlanVisible
        day="2026-11-17"
        count={2}
        packages={PACKAGES}
        accent="forest"
      >
        <p data-the-load="true">load</p>
      </VanCard>,
    );
    const zone = html.slice(
      html.indexOf('data-van-hover="cr-112"'),
      html.indexOf('data-van-packages='),
    );
    expect(zone).toContain('data-van-head="true"');
    expect(zone).toContain('data-van-captain-line="cr-112"');
    expect(zone).not.toContain('data-the-load');
    // A keyboard reaches it; a screen reader hears what it opens.
    expect(html).toMatch(/tabindex="0" data-van-hover="cr-112" role="group" aria-label="[^"]+"/);
    expect(html).toContain(
      `aria-label="${tr('ar', 'operations.distribution.vanCard.label', { van: tr('ar', 'operations.distribution.vanLabel', { code: '112' }) })}"`,
    );
    // Not open until then.
    expect(html).not.toContain('data-van-card=');
    // The drop's mark is still the whole card's.
    expect(html).toMatch(/^<article data-distribution-van="cr-112" data-drop-van="cr-112"/);
    expect(PARTS).toContain('mark="secured-van"');
    expect(HOVER).toContain("| 'secured-van'");
  });

  it('never opens while a drag is on, over an open «نقل إلى…» menu, or on the captain’s own name', () => {
    expect(PARTS).toContain(
      'when: () => vanHoverAllowed({ dragging: dragOn, menuOpen: moveMenuOpen(), onPerson: false }),',
    );
    expect(PARTS).toContain("document.querySelector('[data-move-menu]') !== null");
    expect(PARTS).toContain("target.closest('[data-van-person]') !== null");
    expect(PARTS).toContain("window.addEventListener('dragstart', () => (dragOn = true), true);");
    // The shared hook asks `when` as the pointer comes AND when the delay ends.
    expect(HOVER).toMatch(
      /const show = \(\): void => \{\s*clear\(\);\s*if \(allowed\.current !== undefined && !allowed\.current\(\)\) return;/,
    );
    expect(HOVER).toMatch(
      /const arm = \(\): void => \{\s*if \(allowed\.current !== undefined && !allowed\.current\(\)\) return;/,
    );
    // A tap on a phone opens it too — R26 critic: but not on the captain's own name (his card):
    // a tap there closes the van's card if it was open, and leaves the name to open his.
    expect(PARTS).toMatch(
      /onClick=\{\(event\) => \{\s*(?:\/\/[^\n]*\n\s*)?const onPerson = onPersonName\(event\.target\);\s*if \(onPerson\) setTapped\(false\);\s*if \(!vanTapAllowed\(\{ touch: pointer\.current === 'touch', onPerson \}\)\) return;\s*setTapped\(\(open\) => !open\);/,
    );
  });

  it('R26 critic — on a phone, a tap on the captain’s name opens HIS card, as resting on it does', () => {
    // The name had no tap at all: on a phone it opened the van's card (the critic), then nothing.
    const name = PARTS.slice(
      PARTS.indexOf('const PersonName = ('),
      PARTS.indexOf('const PersonCardBody = ('),
    );
    expect(name).toContain('const { tapped, setTapped, pointer } = useTapCard(hover.anchor);');
    expect(name).toMatch(
      /onPointerDown=\{\(event\) => \{\s*pointer\.current = event\.pointerType;\s*\}\}\s*onClick=\{\(\) => \{\s*if \(pointer\.current !== 'touch'\) return;\s*setTapped\(\(open\) => !open\);/,
    );
    expect(name).toContain('{(hover.open || tapped) && (');
    // One rule for every tap card on the screen: a tap elsewhere, or Escape, closes it.
    expect(PARTS.match(/useTapCard\(hover\.anchor\)/g)).toHaveLength(3);
  });
});

describe('C — each van in its colour, every chip on it in the same', () => {
  const card = (accent: VanAccent | null) =>
    render(
      <VanCard
        van={VAN}
        crewPlanVisible
        day="2026-11-17"
        count={2}
        packages={PACKAGES}
        accent={accent}
      >
        <p>load</p>
      </VanCard>,
    );

  it('the stripe at its start edge is the palette’s own dot; its head on a band of it; its code on a pill of it', () => {
    for (const accent of ['forest', 'gold', 'navy'] as const) {
      const html = card(accent);
      expect(html).toContain(`data-van-accent="${accent}"`);
      expect(html).toContain(
        `data-van-stripe="${accent}" class="pointer-events-none absolute inset-y-0 start-0 w-[5px] ${SHIFT_TYPE_TONE[accent].dot}"`,
      );
      expect(html).toContain(
        `data-van-band="${accent}" class="flex min-w-0 items-center rounded-lg px-1.5 py-1 ${VAN_ACCENT_LOOK[accent].band}"`,
      );
      expect(html).toMatch(
        new RegExp(`data-van-code="112" class="[^"]*${literal(VAN_ACCENT_LOOK[accent].pill)}`),
      );
      // The card cuts the stripe to its round corners.
      expect(html).toMatch(
        /^<article[^>]*class="relative flex min-w-0 flex-col gap-2 overflow-hidden rounded-xl/,
      );
    }
  });

  it('no colour given: drawn neutral — no stripe', () => {
    const html = card(null);
    expect(html).not.toContain('data-van-stripe');
    expect(html).not.toContain('data-van-accent');
    expect(html).toContain('data-van-band="none"');
  });

  it('the counts: the محصنات badge indigo, each package its colour, a 0 grey; the time sky, the direction violet', () => {
    const html = card('forest');
    // R26 critic — the badge was solid indigo-600, the very pill of an indigo van's code right
    // above it: a count is now drawn as a count (a light ground, ringed and marked in its colour),
    // never as a van.
    expect(html).toMatch(
      new RegExp(
        `<span data-van-count="2" data-count-kind="shipments" class="[^"]*${literal(SHIPMENTS_BADGE.some)}`,
      ),
    );
    for (const accent of Object.values(VAN_ACCENT_LOOK)) {
      expect(SHIPMENTS_BADGE.some).not.toContain(accent.pill.split(' ')[0] as string);
    }
    expect(SHIPMENTS_BADGE.some).toMatch(/^bg-white /);
    expect(html).toMatch(
      new RegExp(
        `data-van-package="bags" data-count-kind="bags" class="[^"]*${literal(COUNT_LOOK.bags.chip)}`,
      ),
    );
    expect(html).toMatch(
      new RegExp(
        `data-van-package="boxes" data-count-kind="boxes" data-count-zero="true" class="[^"]*${literal(COUNT_ZERO)}`,
      ),
    );
    expect(html).toMatch(/data-van-time="07:15"[^>]*class="[^"]*text-sky-800/);
    expect(html).toMatch(/data-van-direction="[^"]*"[^>]*class="[^"]*text-violet-800/);
    const zero = render(
      <VanCard
        van={VAN}
        crewPlanVisible
        day="2026-11-17"
        count={0}
        packages={PACKAGES}
        accent="forest"
      >
        <p>load</p>
      </VanCard>,
    );
    // A 0 muted as every 0 (`COUNT_ZERO`) — lighter than a count, never heavier.
    expect(zero).toMatch(
      new RegExp(
        `<span data-van-count="0" data-count-kind="shipments" class="[^"]*${literal(COUNT_ZERO)}`,
      ),
    );
  });

  it('the captain’s line stays the captain’s green on any van', () => {
    for (const accent of ['forest', 'crimson', 'gold'] as const) {
      expect(card(accent)).toMatch(
        /data-van-captain-line="cr-112" class="[^"]*bg-emerald-50 ring-emerald-200/,
      );
    }
  });

  const ROW = {
    id: 's-1',
    status: 'inVault',
    mainBankId: 'b',
    securedStage: 'inVault',
    origin: null,
    destination: { id: 'd', name: 'فرع المعادي', code: 'D', bankId: 'b', bankName: 'الأهلي' },
    areaName: 'المعادي',
    deliveryDate: '2026-11-17T00:00:00.000Z',
    overdue: false,
    vaultReceiptNumber: null,
    lines: [],
  } as unknown as OperationsSecuredDistributionRowDto;
  const chip = (accent: VanAccent | null, tone?: 'proposed' | 'moved') =>
    render(
      <ShipmentChip
        row={ROW}
        bankName="الأهلي"
        branchName="فرع المعادي"
        accent={accent}
        tone={tone}
        card={<p>card</p>}
      />,
    );

  it('a chip on a van wears its van’s colour — a stripe at its start and a thin ground of it', () => {
    const html = chip('forest');
    expect(html).toContain('data-chip-accent="forest"');
    expect(html).toContain(
      `data-chip-stripe="forest" class="pointer-events-none absolute inset-y-0 start-0 w-[3px] ${SHIFT_TYPE_TONE.forest.dot}"`,
    );
    expect(html).toContain(VAN_ACCENT_LOOK.forest.chip);
    expect(html).not.toContain('bg-white dark:bg-[#0f1a3a]');
  });

  it('on the left — on no van — a chip stays neutral', () => {
    const html = chip(null);
    expect(html).not.toContain('data-chip-accent');
    expect(html).not.toContain('data-chip-stripe');
    expect(html).toContain('bg-white dark:bg-[#0f1a3a]');
  });

  it('a proposal on a van keeps its «مقترحة» look — dashed amber on its own amber ground — the van only its stripe', () => {
    // R26 critic — the van's ground had replaced the proposal's amber-50: on an orange van the
    // dashed edge and a small icon were all that was left of «مقترحة».
    const html = chip('orange', 'proposed');
    expect(html).toContain('data-shipment-tone="proposed"');
    expect(html).toContain('border-dashed border-amber-500');
    expect(html).toContain('data-chip-stripe="orange"');
    expect(html).toContain('bg-amber-50 dark:bg-amber-400/[0.06]');
    expect(html).not.toContain(VAN_ACCENT_LOOK.orange.chip);
    // An unsaved move keeps its own ground as well.
    const moved = chip('orange', 'moved');
    expect(moved).toContain('data-chip-stripe="orange"');
    expect(moved).toContain('bg-brand-50/60 dark:bg-brand-500/[0.08]');
    expect(moved).not.toContain(VAN_ACCENT_LOOK.orange.chip);
    // Off a van, a proposal's own ground.
    expect(chip(null, 'proposed')).toContain('bg-amber-50');
  });

  it('a chip’s card names its van with the van’s swatch, and counts its packages in their colours', () => {
    const html = render(
      <ShipmentCardBody
        row={ROW}
        bankName="الأهلي"
        money={[]}
        packages={{ bags: 1, cartons: 0, boxes: 2 }}
        packagesRead="ready"
        place="السيارة 112 · مع كريم"
        placeAccent="forest"
        notes={[]}
      />,
    );
    expect(html).toContain('data-card-van-accent="forest"');
    expect(html).toMatch(/data-van-swatch="forest"[\s\S]*السيارة 112 · مع كريم/);
    expect(html).toMatch(
      new RegExp(`data-count-kind="boxes" class="[^"]*${literal(COUNT_LOOK.boxes.chip)}`),
    );
    expect(html).toMatch(
      new RegExp(
        `data-count-kind="cartons" data-count-zero="true" class="[^"]*${literal(COUNT_ZERO)}`,
      ),
    );
    // On no van: no swatch.
    const left = render(
      <ShipmentCardBody
        row={ROW}
        bankName="الأهلي"
        money={[]}
        packages={undefined}
        packagesRead="forbidden"
        place={null}
        notes={[]}
      />,
    );
    expect(left).not.toContain('data-van-swatch');
  });

  it('a count writes its figure in the figures’ face — a 0 as «0», «…» while it is read', () => {
    const zero = render(
      <CountChip kind="bags" value={0}>
        bags
      </CountChip>,
    );
    expect(zero).toMatch(/dir="ltr"[^>]*>0</);
    expect(
      render(
        <CountChip kind="bags" value="…">
          bags
        </CountChip>,
      ),
    ).toMatch(/dir="ltr"[^>]*>…</);
  });
});

describe('R26 critic — the vans’ grid never lays more than four a row', () => {
  it('four at 1920 and on any wider screen: the card above is one to four places back, which the order keeps apart', () => {
    // auto-fill at 17.5rem put six a row at 2560 — the card above six places back, which the order
    // does not keep apart. The column's width over four is the floor of a card's width.
    expect(VAN_GRID).toContain(
      'grid-cols-[repeat(auto-fill,minmax(min(100%,max(17.5rem,calc((100%_-_2.25rem)/4))),1fr))]',
    );
    expect(VAN_GRID).toContain('gap-3');
  });
});

describe('both screens take their colours from the same list', () => {
  it('the colour is the van’s place in the day’s WHOLE list — never the filtered one', () => {
    expect(DIST).toContain('const accents = vanAccents(vans);');
    expect(HANDOVER).toContain('const accents = vanAccents(vans);');
    expect(DIST).not.toMatch(/vanAccents\(vansShown/);
    expect(DIST).toContain('accent={accentOf(van.crewAssignmentId)}');
    expect(HANDOVER).toContain('accent={accentOf(van.crewAssignmentId)}');
    // A chip is its van's colour — on the left, none.
    expect(DIST).toContain('accent={van === undefined ? null : accentOf(van.crewAssignmentId)}');
    expect(HANDOVER).toContain(
      'accent={van === undefined ? null : accentOf(van.crewAssignmentId)}',
    );
    expect(DIST).toContain(
      'placeAccent={van === undefined ? null : accentOf(van.crewAssignmentId)}',
    );
    // «نقل إلى…» names each van beside its swatch, as its card does.
    expect(DIST).toContain('accent: accentOf(van.crewAssignmentId),');
    expect(PARTS).toMatch(
      /choice\.accent !== undefined && choice\.accent !== null && \(\s*<VanSwatch accent=\{choice\.accent\} \/>/,
    );
  });

  it('the printed sheet stays black on white — no colour reaches it', () => {
    const sheet = read('../lib/van-load-sheet.ts');
    expect(sheet).not.toMatch(/accent|VAN_ACCENT_LOOK|COUNT_LOOK/);
  });
});

/** A class list as a regular expression, literally. */
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
