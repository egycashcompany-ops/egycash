// Round 24c — the van card of «توزيع المحصنات» and «تسليم المحصنات», and its column, rendered for real
// in both languages.
//
// THE OWNER, on the round-24 screen: «عاوز اصغر المكان اللى فيه المحصنات واكبر المكان اللى فيه المحصنة
// بالعربيه», then «عاوز احسن شكل الكارد العربيه بالمحصنة يعنى عاوز انقل الاتجاه بعد كود السيارة والوقت
// واحسن الاسماء بتاعت القادة والاخصائيين». Pinned here:
//   · the head: ONE line of code (or «بدون سيارة (n)»), time and direction — the band the direction
//     had under the head is gone — then the count; a direction cut by the line is whole on hover;
//   · the crew: each captain on a line of his own with the captain's mark, the two specialists as
//     labelled chips, an empty slot «غير معيَّن» (never «—»), every name cut to its chip and a
//     trigger of the person card; no specialist chip at all without the crew plan's grant;
//   · the column that folds on a phone: its head a button that says whether it is open, its body
//     hidden when folded.
import { describe, expect, it, vi } from 'vitest';
import { type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type Locale, type OperationsDayBoardVehicleCrewDto } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { translate } from '../../../platform/localization/i18n';
import { formatNumber } from '../../../shared/lib/format';
import { type LoadFigures } from '../lib/secured-distribution';
import {
  DISTRIBUTION_COLUMNS,
  DistributionColumn,
  VAN_GRID,
  VanCard,
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

const FIGURES: LoadFigures = { count: 3, egp: 1_500_000, usd: 0, othersSum: 0, packages: null };

const card = (
  van: OperationsDayBoardVehicleCrewDto,
  { crewPlanVisible = true, looseNumber = null, locale = 'ar' as Locale } = {},
): string =>
  render(
    <VanCard
      van={van}
      looseNumber={looseNumber}
      crewPlanVisible={crewPlanVisible}
      day="2026-11-16"
      figures={FIGURES}
    >
      <p>load</p>
    </VanCard>,
    locale,
  );

/** The head line's markup. */
const headOf = (html: string): string =>
  html.slice(html.indexOf('data-van-head="true"'), html.indexOf('</header>'));

describe('the van card’s head — one line', () => {
  for (const locale of ['ar', 'en'] as const) {
    it(`[${locale}] code, then time, then the direction, in one line — the count leads what it carries`, () => {
      const html = card(VAN, { locale });
      const head = headOf(html);
      expect(head.indexOf('data-van-code="249"')).toBeGreaterThan(-1);
      expect(head.indexOf('data-van-time="08:15"')).toBeGreaterThan(head.indexOf('data-van-code'));
      expect(head.indexOf('data-van-direction=')).toBeGreaterThan(head.indexOf('data-van-time'));
      // One flex line that does not wrap, and nothing else in the head to take its room.
      expect(html).toMatch(
        /data-van-head="true" class="flex min-w-0 flex-1 items-center gap-1\.5"/,
      );
      expect(html).not.toMatch(/data-van-head="true" class="[^"]*flex-wrap/);
      expect(head).not.toContain('data-van-count');
      // The count stays, in its own Arabic form, first on the line of the money.
      const count = `>${tr(locale, 'operations.distribution.loadCount.few', { count: formatNumber(3, locale) })}<`;
      const figures = html.slice(html.indexOf('data-van-figures='));
      expect(figures).toMatch(/^data-van-figures="cr-249"><div[^>]*><span data-van-count="3"/);
      expect(figures).toContain(count.replace(/^>/, '</svg>'));
      expect(figures.indexOf('data-van-count')).toBeLessThan(figures.indexOf('data-money="EGP"'));
      // The direction band of Round 12 is gone: the direction is in the head, nowhere else.
      expect(html.match(/data-van-direction=/g)).toHaveLength(1);
    });
  }

  it('cuts a long direction on the line and says it whole on hover and to a screen reader', () => {
    const head = headOf(card(VAN));
    const whole = 'السادس من أكتوبر - الشيخ زايد - الواحات البحرية';
    expect(head).toContain(`title="${tr('ar', 'operations.crew.direction')}: ${whole}"`);
    expect(head).toContain(`class="min-w-0 truncate">${whole}<`);
    expect(head).toContain(`class="sr-only">${tr('ar', 'operations.crew.direction')}: <`);
    // The time chip says what it is on hover too.
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
    expect(head).toContain('data-van-direction="  "');
    expect(head).toContain('bg-slate-100 font-bold text-slate-500');
    expect(head).not.toContain('data-van-time');
  });
});

describe('the van card’s crew', () => {
  it('the captain on his own green line with the captain’s mark, his name cut and a card trigger', () => {
    const html = card(VAN);
    expect(html).toMatch(
      new RegExp(
        `data-van-captain="c1" class="[^"]*bg-emerald-50[^"]*"><span data-captain-mark="true"[^>]*>[\\s\\S]*?${tr('ar', 'operations.crewPlan.role.captain')}</span><span data-van-person="c1" class="min-w-0 truncate[^"]*" tabindex="0">عبد الرحمن محمد عبد العزيز الشناوي</span>`,
      ),
    );
  });

  it('two captains: two lines, named «القادة» as a group', () => {
    const html = card({ ...VAN, captains: [P('c1', 'أحمد فتحي السيد'), P('c2', 'كريم سمير علي')] });
    expect(html).toContain(
      `role="group" aria-label="${tr('ar', 'operations.distribution.captains')}"`,
    );
    expect(html.match(/data-captain-mark="true"/g)).toHaveLength(2);
  });

  it('the specialists as two labelled chips; an empty one «غير معيَّن», never «—»', () => {
    const html = card(VAN);
    expect(html).toMatch(
      new RegExp(
        `data-van-slot="specialist1" data-van-slot-count="1"[^>]*>[\\s\\S]*?${tr('ar', 'operations.crew.slot.specialist1')}</span><span data-van-person="s1" class="min-w-0 truncate`,
      ),
    );
    expect(html).toMatch(
      new RegExp(
        `data-van-slot="specialist2" data-van-slot-count="0" class="[^"]*border-dashed[^"]*">[\\s\\S]*?${tr('ar', 'operations.crew.slot.specialist2')}</span><span data-slot-empty="true"[^>]*>${tr('ar', 'operations.distribution.slotEmpty')}</span>`,
      ),
    );
    const crew = html.slice(html.indexOf('data-van-crew='), html.indexOf('data-van-figures='));
    expect(crew).not.toContain('—');
  });

  it('several in one slot: each name on a line of its own', () => {
    const html = card({
      ...VAN,
      specialist1: [P('s1', 'وليد سيد فوزي'), P('s2', 'عمرو جمال الدين')],
    });
    expect(html).toContain('data-van-slot="specialist1" data-van-slot-count="2"');
    expect(html).toMatch(/data-van-person="s1" class="min-w-0 truncate[^"]* block /);
    expect(html).toMatch(/data-van-person="s2" class="min-w-0 truncate[^"]* block /);
  });

  it('no captain: said in red where the captain would be — the van takes nothing', () => {
    const html = card({ ...VAN, captains: [] });
    expect(html).toMatch(
      new RegExp(
        `data-van-captain="none"[^>]*text-rose-700[\\s\\S]*${tr('ar', 'operations.distribution.noCaptain')}`,
      ),
    );
    expect(html).not.toContain('data-captain-mark');
  });

  it('without the crew plan’s grant, no specialist chip at all — not «غير معيَّن» over people who ride', () => {
    const html = card({ ...VAN, specialist1: [], specialist2: [] }, { crewPlanVisible: false });
    expect(html).not.toContain('data-van-slot=');
    expect(html).not.toContain(tr('ar', 'operations.distribution.slotEmpty'));
    expect(html).toContain('data-van-captain="c1"');
  });

  it('in English, the same pieces in English words', () => {
    const html = card(VAN, { locale: 'en' });
    expect(html).toContain(`>${tr('en', 'operations.distribution.slotEmpty')}<`);
    expect(tr('en', 'operations.distribution.slotEmpty')).toBe('Not assigned');
    expect(html).toContain(`${tr('en', 'operations.crewPlan.role.captain')}</span>`);
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
