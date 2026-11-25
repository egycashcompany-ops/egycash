// Round 34 E — «لوحة التشغيلة»'s head. The owner, circling the toolbar's start (the role legend and
// the hint under it): «واسمح الحاجات اللى فوق دى وحط مكاناها الاجماليات بدل ما انت لما بختار حاجه
// بينزل سطر ل تحت».
//
// What a typecheck cannot see:
//   • the legend and the hint are gone from the board (not drawn elsewhere either) — and, since
//     Round 34 G, from «الطاقم الثابت» too;
//   • the totals — «الإجمالي», a chip per type, «بدون نوع», «صيانة» — are IN the toolbar, at its
//     start, before the acts; the bar under it holds the filters only;
//   • nothing takes a line of its own when something is picked: from 1280 the toolbar and the bar
//     never wrap, the totals scroll inside their box rather than wrap, and a chip picked up stands at
//     the totals' start on their line — its name, «إلغاء» and Escape kept, the totals still pressed;
//   • the acts keep their names (read aloud, and in the tooltip) when they show their icon only —
//     from 1280 to 1759, and below 820; between, and from 1760, their words;
//   • a reader without the planning grant is told the board is read only — «للعرض فقط», not a line;
//   • Round 34 H — a past day drops no line either: the record's notice under the bar is gone, and
//     the mark on the toolbar's line («سجل · للعرض فقط») carries its words and the work the day's end
//     left unsaved; «إضافة صف بدون سيارة» at its icon-only widths is rows and a plus, not a bare «+»;
//   • Round 34 H critic — what the mark says is reached without hover: the mark is a button whose
//     card opens on a press, a tap or the keyboard's focus (no browser `title`); below 360 the acts'
//     line keeps two rows' room in every state; the add-row drawing lands on the 14px grid.
//
// The suite runs in node with no DOM: the pieces are rendered on their own (`CrewPlanHand`,
// `FilteredCount`, `ViewOnlyMark`, `RecordMark`), the board itself is server-rendered on a seeded
// cache (a past day's record, a day to plan — Round 34 H), the strip's listeners are driven on a
// stand-in box (`lib/side-scroll.spec.ts`), and the page is read as source (as the board's own specs
// read it) — those pins say WHERE a thing is drawn. What only a browser can measure — the table's top not
// moving on any choice, no sideways page scroll, a chip reached by Tab standing clear of the fade —
// is verified on the built page, at every width from 360 to 1760, Arabic and English (Round 34 E,
// its verifier and its critic: their shoot scripts and reports in the CHANGELOG).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Locale, MeDto, OperationsCrewBoardDto } from '@ecms/contracts';
import type { ReactNode } from 'react';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { listKey } from '../../../shared/lib/query-keys';
import { PATH } from '../../fleet/components/FuelCardBoard';
import { togglePress, useHoverCard } from '../../fleet/components/HoverCardLayer';
import { SHIFT_TYPE_LIST } from '../lib/crew-plan';
import { cairoToday } from '../lib/shipment-history';
import { CrewBoardPage } from '../pages/CrewBoardPage';
import {
  COUNT_CHIP,
  CREW_PLAN_BAR_LINE,
  CrewPlanHand,
  FilteredCount,
  HEAD_CHIP,
  HEAD_FIGURE,
  HEAD_STRIP,
  PickedPill,
  RecordCardBody,
  RecordMark,
  ViewOnlyMark,
  filteredCountAt,
} from './CrewPlanFrame';
import { CrewPlanScopeProvider } from './crew-plan-scope';
import { PLAN_ICON } from './crew-plan-icons';
import { dayText } from './SecuredDistributionParts';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const BOARD = read('../pages/CrewBoardPage.tsx');
const STANDING = read('../pages/StandingCrewPage.tsx');
const FRAME = read('./CrewPlanFrame.tsx');
const CHIP = read('./CrewPlanChip.tsx');
const t = (key: string, vars?: Record<string, string>, locale: Locale = 'ar'): string =>
  translate(locale, key, vars);
const render = (node: ReactNode, locale: Locale = 'ar'): string =>
  renderToStaticMarkup(
    <Provider
      store={configureStore({
        reducer: { locale: localeSlice.reducer },
        preloadedState: {
          locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
        },
      })}
    >
      {node}
    </Provider>,
  );
const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The board's toolbar, from its mark to the bar's. */
const TOOLBAR = BOARD.slice(
  BOARD.indexOf('data-crew-plan-toolbar="true"'),
  BOARD.indexOf('data-crew-plan-bar="true"'),
);
/** The bar, from its mark to the roster's notice under it (Round 34 H: the record's notice is gone). */
const BAR = BOARD.slice(
  BOARD.indexOf('data-crew-plan-bar="true"'),
  BOARD.indexOf('<CrewRosterNotice'),
);
/** The board's acts: the span after the totals. */
const ACTS = TOOLBAR.slice(TOOLBAR.indexOf('</CrewPlanHand>'));
/** «صيانة»'s words — its codes, or that there are none. */
const WORKSHOP_WORDS = BOARD.slice(
  BOARD.indexOf('const workshopWords ='),
  BOARD.indexOf(';', BOARD.indexOf('const workshopWords =')),
);
const classesOf = (source: string, constant: string): string => {
  const at = source.indexOf(`const ${constant} =`);
  return source.slice(at, source.indexOf(';\n', at));
};

/** A strip in miniature: what the board hands its toolbar's start. */
const STRIP = (
  <div role="group" data-type-counts="true" className={HEAD_STRIP}>
    <button type="button" data-type-count="all" className={HEAD_CHIP}>
      الإجمالي ٢٦٥
    </button>
  </div>
);

describe('Round 34 E — the legend and the hint are gone from the board', () => {
  it('the board draws neither — nor its words anywhere — and no longer hands its toolbar a hint', () => {
    expect(BOARD).not.toContain('RoleLegend');
    expect(BOARD).not.toContain("'operations.crewPlan.hint'");
    expect(BOARD).not.toMatch(/<CrewPlanHand[^>]*\bhint=/u);
    // The key is gone with it: nothing else read it.
    expect(t('operations.crewPlan.hint')).toBe('operations.crewPlan.hint');
    expect(t('operations.crewPlan.hint', undefined, 'en')).toBe('operations.crewPlan.hint');
  });

  it('the role colours stay where they always were: on every chip and on the pools’ heads', () => {
    // The words of the roles are still the screen's (the chip's card and «الطاقم الثابت» read them).
    for (const role of ['captain', 'dual', 'specialist']) {
      expect(t(`operations.crewPlan.role.${role}`)).not.toBe(`operations.crewPlan.role.${role}`);
    }
  });

  // Round 34 G — REWRITTEN (was ««الطاقم الثابت» keeps its legend and its hint, unchanged»): the
  // orchestrator gave «الطاقم الثابت» the board's head — «اعمل الافضل واعمل ميرج».
  it('«الطاقم الثابت» draws neither any more (Round 34 G) — no screen has a legend or a hint to draw', () => {
    expect(STANDING).not.toContain('RoleLegend');
    expect(STANDING).not.toContain("'operations.standingCrew.hint'");
    expect(STANDING).not.toMatch(/<CrewPlanHand[^>]*\bhint=/u);
    // Its key went with it (nothing else read it); the legend itself is drawn nowhere.
    for (const locale of ['ar', 'en'] as const) {
      expect(t('operations.standingCrew.hint', undefined, locale)).toBe(
        'operations.standingCrew.hint',
      );
    }
    expect(FRAME).not.toContain('RoleLegend');
    expect(CHIP).not.toContain('export const RoleLegend');
    const head = render(
      <CrewPlanHand pickedName={null} onCancel={() => undefined}>
        {STRIP}
      </CrewPlanHand>,
    );
    expect(head).not.toContain('data-role-legend');
    expect(head).toContain('data-crew-plan-head="true"');
  });
});

describe('Round 34 E — the totals are in the toolbar, where the legend was', () => {
  it('the toolbar holds the whole strip — «الإجمالي», the types, «بدون نوع», «صيانة» — before the acts', () => {
    expect(TOOLBAR).toContain('data-type-counts="true"');
    expect(TOOLBAR).toContain("t('operations.crewPlan.total')");
    expect(TOOLBAR).toContain('strip.chips.map(({ type, count }) =>');
    expect(TOOLBAR).toContain("t('operations.crewPlan.type.untyped')");
    expect(TOOLBAR).toContain('data-workshop-count={String(workshop.length)}');
    // «صيانة»'s codes: its tooltip and what a screen reader says with it — one sentence, built once.
    expect(TOOLBAR).toContain('title={workshopWords}');
    expect(WORKSHOP_WORDS).toContain("t('operations.crewPlan.workshopHint', {");
    // At the start: the strip is the toolbar's first piece, the acts after it.
    expect(TOOLBAR.indexOf('data-type-counts="true"')).toBeLessThan(
      TOOLBAR.indexOf('data-standing-toggle="true"'),
    );
    expect(TOOLBAR.indexOf('<CrewPlanHand')).toBeLessThan(TOOLBAR.indexOf('data-type-counts'));
    expect(TOOLBAR.indexOf('data-type-counts')).toBeLessThan(TOOLBAR.indexOf('</CrewPlanHand>'));
  });

  it('the same behaviour, names and hooks: a chip filters by its type, pressed again lets go; titles kept', () => {
    expect(BOARD).toContain("onClick={() => setTypeFilter(on && filter !== '' ? '' : filter)}");
    expect(BOARD).toContain("data-type-count={filter || 'all'}");
    expect(BOARD).toContain("data-type-archived={archived ? 'true' : undefined}");
    expect(BOARD).toContain('aria-pressed={on}');
    expect(TOOLBAR).toContain('role="group"');
    expect(TOOLBAR).toContain("aria-label={t('operations.crewPlan.counts')}");
    expect(TOOLBAR).toContain("title={t('operations.crewPlan.countsHint')}");
    expect(WORKSHOP_WORDS).toContain("t('operations.crewPlan.workshopNone')");
    // The strip still counts the WHOLE day, whatever the filters show.
    expect(BOARD).toContain('const strip = shiftTypeStrip(shiftTypes, rows);');
  });

  it('the bar under it holds the filters only — no strip, no second line for it', () => {
    expect(BAR).not.toContain('data-type-counts');
    expect(BAR).not.toContain('data-workshop-count');
    expect(BAR).not.toContain('1900px');
    for (const filter of [
      '<DayBox',
      "t('operations.crewPlan.filter.van')",
      "t('operations.crewPlan.filter.person')",
      "t('operations.crewPlan.filter.direction')",
      "t('operations.crewPlan.typeAll')",
      '<FilteredCount',
    ]) {
      expect(BAR, filter).toContain(filter);
    }
  });

  it('every word of the strip in Arabic and English', () => {
    for (const key of [
      'operations.crewPlan.total',
      'operations.crewPlan.counts',
      'operations.crewPlan.countsHint',
      'operations.crewPlan.type.untyped',
      'operations.crewPlan.workshop',
      'operations.crewPlan.workshopNone',
    ]) {
      for (const locale of ['ar', 'en'] as const) {
        expect(t(key, undefined, locale), `${locale} ${key}`).not.toBe(key);
      }
    }
    // Shorter in English, so more of the line is seen: «Workshop», «No type».
    expect(t('operations.crewPlan.workshop', undefined, 'en')).toBe('Workshop');
    expect(t('operations.crewPlan.type.untyped', undefined, 'en')).toBe('No type');
    expect(t('operations.crewPlan.workshop')).toBe('صيانة');
    expect(t('operations.crewPlan.type.untyped')).toBe('بدون نوع');
  });
});

describe('Round 34 E — nothing takes a line of its own when something is picked', () => {
  it('from 1280 the toolbar and its acts never wrap; the totals’ line never wraps at all', () => {
    expect(BOARD).toContain(
      'className="flex flex-wrap items-center gap-2 min-[1280px]:flex-nowrap"\n          data-crew-plan-toolbar="true"',
    );
    expect(ACTS).toContain('min-[1280px]:flex-nowrap');
    // The strip: one line, the acts' height, sideways inside its own box — never a wrap.
    expect(HEAD_STRIP).toContain('flex-nowrap');
    expect(HEAD_STRIP).toContain('h-[34px]');
    expect(HEAD_STRIP).toContain('overflow-x-auto');
    expect(HEAD_STRIP).toContain('overflow-y-hidden');
    expect(HEAD_STRIP).not.toMatch(/(^|\s)flex-wrap/u);
    // No scrollbar to give the box a height of its own when the line outgrows it.
    expect(HEAD_STRIP).toContain('[scrollbar-width:none]');
    expect(HEAD_STRIP).toContain('[&::-webkit-scrollbar]:hidden');
    // The fade says the line goes on; a wheel moves it.
    expect(BOARD).toContain('const stripEdges = useSideScroll(stripRef);');
    expect(BOARD).toContain("const stripFade = sideFade(stripEdges, locale === 'ar');");
    expect(TOOLBAR).toContain('style={{ maskImage: stripFade, WebkitMaskImage: stripFade }}');
  });

  it('the bar is ONE line from 1280: «المعروض N من M» comes at its end, in room the line keeps', () => {
    expect(BAR.startsWith('data-crew-plan-bar="true"')).toBe(true);
    expect(BOARD).toContain('<div className={CREW_PLAN_BAR_LINE} data-crew-plan-bar="true">');
    // Round 34 G — the line is the frame's now, shared with «الطاقم الثابت» (was the board's own).
    expect(classesOf(FRAME, 'CREW_PLAN_BAR_LINE')).toMatch(
      /cn\(\s*CREW_PLAN_BAR,\s*'min-\[1280px\]:flex-nowrap min-\[1280px\]:gap-x-2',?\s*\)/u,
    );
    expect(CREW_PLAN_BAR_LINE).toContain('min-[1280px]:flex-nowrap min-[1280px]:gap-x-2');
    expect(BAR).toContain('<span className="flex shrink-0 min-[1280px]:ms-auto">');
    // The person box gives 32px back below 1366, so the pair fits at 1280.
    expect(BAR).toContain('className="w-full shrink-0 sm:w-56 min-[1280px]:max-[1365px]:w-48"');
  });

  it('a chip picked up stands at the totals’ start, ON their line: its name, «إلغاء», said aloud — the totals still seen and pressed', () => {
    const html = render(
      <CrewPlanHand pickedName="احمد سيد بركة محمد" onCancel={() => undefined}>
        {STRIP}
      </CrewPlanHand>,
    );
    // One line: the head is a row — the pill, then the totals — never a line of its own.
    expect(html).toMatch(/^<div class="flex min-w-0 items-center" data-crew-plan-head="true">/u);
    // The pill first (the line's start), in the spoken region; at most 70% of the line, no taller
    // than it (30px, the line 34).
    expect(html).toMatch(
      /^<div[^>]*><div aria-live="polite" data-crew-plan-head-hand="true" class="flex min-w-0 items-center max-w-\[70%\] shrink-0 pe-2"><p data-crew-picked="true" class="[^"]*\bh-\[30px\] min-w-0 !py-0\b/u,
    );
    expect(text(html)).toContain(t('operations.crewPlan.picked', { name: 'احمد سيد بركة محمد' }));
    expect(html).toContain('data-crew-picked-cancel="true"');
    expect(text(html)).toContain(t('operations.crewPlan.cancelPick'));
    // The totals after it: seen, in the keyboard's way and the pointer's — a type chip narrows the
    // rows while somebody is held, as it did before Round 34 E.
    expect(html.indexOf('data-crew-picked="true"')).toBeLessThan(html.indexOf('data-type-counts'));
    expect(html).toContain(
      '<div class="flex min-w-0 flex-1 items-center gap-2" data-crew-plan-head-idle="true">',
    );
    expect(html).not.toMatch(/\binvisible\b|aria-hidden="true"[^>]*data-crew-plan-head-idle/u);
  });

  it('nothing picked: the totals shown, the spoken region there and empty — no width, no gap', () => {
    const html = render(
      <CrewPlanHand pickedName={null} onCancel={() => undefined}>
        {STRIP}
      </CrewPlanHand>,
    );
    expect(html).toContain(
      '<div aria-live="polite" data-crew-plan-head-hand="true" class="flex min-w-0 items-center"></div>',
    );
    expect(html).toContain(
      '<div class="flex min-w-0 flex-1 items-center gap-2" data-crew-plan-head-idle="true">',
    );
    expect(html).not.toContain('data-crew-picked');
  });

  it('the board wires it: «إلغاء» and Escape put the chip down', () => {
    expect(TOOLBAR).toContain('pickedName={pickedName}');
    expect(TOOLBAR).toContain('onCancel={() => setSelected(null)}');
    expect(BOARD).toContain("if (event.key === 'Escape') setSelected(null);");
  });

  // Round 34 G — REWRITTEN (was «… and «الطاقم الثابت» keeps it in its toolbar’s start»): the
  // standing crew's pill stands at its counters' start, on their line, as the board's does.
  it('the pill reads the same in English, and «الطاقم الثابت» holds it at its counters’ start, as the board', () => {
    const en = text(render(<PickedPill name="Ahmed" onCancel={() => undefined} />, 'en'));
    expect(en).toContain(t('operations.crewPlan.picked', { name: 'Ahmed' }, 'en'));
    expect(en).toContain(t('operations.crewPlan.cancelPick', undefined, 'en'));
    const standing = render(
      <CrewPlanHand pickedName="احمد" onCancel={() => undefined}>
        <div role="group" data-standing-counts="true" className={HEAD_STRIP}>
          <button type="button" data-standing-count="all" className={HEAD_CHIP}>
            السيارات ١٤
          </button>
        </div>
      </CrewPlanHand>,
    );
    expect(standing).toContain('data-crew-plan-head="true"');
    expect(standing.indexOf('data-crew-picked="true"')).toBeGreaterThan(0);
    expect(standing.indexOf('data-crew-picked="true"')).toBeLessThan(
      standing.indexOf('data-standing-counts'),
    );
  });
});

describe('Round 34 E — the chips compact, the acts their icons', () => {
  it('a total’s chip: 4px inside, 3px between dot, name and number, 10.5px (11px from 1440)', () => {
    for (const piece of [
      'h-[26px]',
      'px-1',
      'gap-[3px]',
      'text-[10.5px]',
      'min-[1440px]:text-[11px]',
      'whitespace-nowrap',
      'shrink-0',
      // drawn inside: the strip's box clips what lies outside it
      'focus-visible:ring-inset',
    ]) {
      expect(HEAD_CHIP, piece).toContain(piece);
    }
    // «المعروض» keeps the shared chip; Round 34 G — «الطاقم الثابت»'s counters wear the compact one,
    // and the figure beside a total is the frame's (was the board's own `HEAD_FIGURE`).
    expect(COUNT_CHIP).toContain('px-1 py-1 text-[11.5px]');
    expect(BOARD).not.toContain('COUNT_CHIP');
    expect(STANDING).not.toContain('COUNT_CHIP');
    expect(HEAD_FIGURE).toBe('text-[11px] font-black min-[1440px]:text-[11.5px]');
    expect(FRAME).toContain(
      "export const HEAD_FIGURE = 'text-[11px] font-black min-[1440px]:text-[11.5px]';",
    );
    expect(BOARD).not.toContain('const HEAD_FIGURE =');
    for (const page of [BOARD, STANDING]) {
      expect(page).toContain("cn(NUM, HEAD_FIGURE, 'text-slate-900 dark:text-white')");
    }
  });

  it('from 1280 to 1759 — and below 820 — each act but «حفظ» is its icon; its word its name, and its tooltip', () => {
    // Round 34 critic: only where the one-line head needs the room (1280–1759), and where the words
    // do not fit one line (below 820). From 820 to 1279 the acts have a line of their own: words.
    expect(classesOf(BOARD, 'ACT_WORD')).toContain(
      "'max-[819px]:sr-only min-[1280px]:max-[1759px]:sr-only'",
    );
    const icon = classesOf(BOARD, 'ICON_ACT');
    for (const piece of [
      'min-[1280px]:max-[1759px]:h-[34px]',
      'min-[1280px]:max-[1759px]:w-[34px]',
      // A finger's size where they are icons on a phone or a tablet held upright.
      'max-[819px]:h-11',
      'max-[819px]:w-11',
    ]) {
      expect(icon, piece).toContain(piece);
    }
    // Never a bare `max-[1759px]:` — that took the words from 820–1279, where they fit.
    expect(icon).not.toMatch(/(^|[\s'])max-\[1759px\]:/u);
    expect(classesOf(BOARD, 'ACT_WORD')).not.toMatch(/(^|[\s'])max-\[1759px\]:/u);
    for (const [mark, word] of [
      ['data-standing-toggle="true"', "t('operations.crewPlan.standing')"],
      ['data-type-colours-open="true"', "t('operations.crewPlan.typeColours.open')"],
      ['data-add-loose-row="true"', "t('operations.crewPlan.addRow')"],
      ['data-crew-plan-excel="true"', 'Excel'],
      ['data-crew-plan-discard="true"', "t('operations.crewPlan.discard')"],
    ] as const) {
      const act = ACTS.slice(ACTS.indexOf(mark), ACTS.indexOf('</button>', ACTS.indexOf(mark)));
      expect(act, mark).toContain('ICON_ACT');
      expect(act, mark).toContain(
        `<span className={ACT_WORD}>${word === 'Excel' ? word : `{${word}}`}</span>`,
      );
      expect(act, mark).toMatch(/title=/u);
    }
    // The standing crew's tooltip names it before saying why.
    expect(ACTS).toContain("title={`${t('operations.crewPlan.standing')} — ${");
    // «حفظ (n)» keeps its word and its count at every width — as high as the icons below 820.
    const save = ACTS.slice(ACTS.indexOf('data-crew-plan-save='));
    expect(save.slice(0, save.indexOf('</button>'))).not.toContain('ACT_WORD');
    expect(save.slice(0, save.indexOf('</button>'))).not.toContain('ICON_ACT');
    expect(save.slice(0, save.indexOf('</button>'))).toContain('WORD_ACT');
    expect(classesOf(BOARD, 'WORD_ACT')).toContain("'max-[819px]:h-11'");
  });

  // Round 34 H — REWRITTEN (title kept): the mark is `RecordMark` (it carries the notice's words), so
  // its words are read off its render, not off the page's source. Round 34 H critic — REWRITTEN
  // again (title kept): the mark is a button now, its words its name, seen and said (no longer
  // `aria-hidden` beside a hidden sentence).
  it('a past day keeps its mark and «العودة إلى اليوم» in words, in the acts’ place', () => {
    const record = ACTS.slice(ACTS.indexOf('{isRecord && ('), ACTS.indexOf('{canPlan && ('));
    expect(record).toMatch(
      /<RecordMark\s+day=\{day\}\s+dayLabel=\{dayText\(`\$\{day\}T00:00:00\.000Z`\)\}\s+lost=\{lostOnRecord\}\s+className=\{cn\(WORD_ACT, NARROW_WORD_ACT\)\}\s+iconClassName=\{NARROW_WORD_ICON\}\s+\/>/u,
    );
    expect(record).toContain("{t('operations.crewPlan.record.today')}");
    // Below 400 the two words stand without their icons, 2px less inside: on a 360 phone the mark,
    // «العودة إلى اليوم», «ألوان الأنواع» and «Excel» asked 331px in Arabic and 345 in English of 328.
    expect(classesOf(BOARD, 'NARROW_WORD_ACT')).toContain("'max-[399px]:px-1.5'");
    expect(classesOf(BOARD, 'NARROW_WORD_ICON')).toContain("'max-[399px]:hidden'");
    expect(record).toContain('className={cn(BRAND_BUTTON, WORD_ACT, NARROW_WORD_ACT)}');
    expect(record).toContain("className={cn('h-3.5 w-3.5', NARROW_WORD_ICON)}");
    expect(record).not.toContain('ACT_WORD');
    const mark = render(
      <RecordMark
        day="2025-03-10"
        dayLabel="10/03/2025"
        lost={0}
        iconClassName="max-[399px]:hidden"
      />,
    );
    expect(mark).toContain('data-crew-record-mark="true"');
    expect(mark).toContain('class="h-3.5 w-3.5 max-[399px]:hidden"');
    const toggle = mark.slice(mark.indexOf('<button'), mark.indexOf('</button>'));
    expect(toggle).toContain(`<span>${t('operations.crewPlan.record.mark')}</span>`);
    // The board's classes (`WORD_ACT`, `NARROW_WORD_ACT`) land on the button: the box that is seen.
    const sized = render(
      <RecordMark day="2025-03-10" dayLabel="x" lost={0} className="max-[819px]:h-11" />,
    );
    expect(tagOf(sized, 'data-crew-record-toggle="true"')).toContain('max-[819px]:h-11');
  });
});

describe('Round 34 E — a reader without the planning grant: a mark, not a line', () => {
  it('stands first among the acts: a lock and «للعرض فقط» in words — why in full its tooltip and what is said', () => {
    // Round 34 critic: the lock alone told it only in a hover's tooltip — nothing on a phone, nothing
    // to the keyboard. Its words are seen now, as the past day's «سجل · للعرض فقط» is.
    expect(ACTS.indexOf('{!canPlan && !isRecord && <ViewOnlyMark className={WORD_ACT} />}')).toBe(
      ACTS.indexOf('{!canPlan'),
    );
    expect(ACTS.indexOf('<ViewOnlyMark')).toBeLessThan(ACTS.indexOf('{isRecord && ('));
    for (const locale of ['ar', 'en'] as const) {
      const html = render(<ViewOnlyMark />, locale);
      expect(html).toContain('data-crew-view-only="true"');
      expect(html).toContain(`title="${t('operations.crewPlan.viewOnly', undefined, locale)}"`);
      // Seen: the words (not read twice — the sentence below says it all).
      expect(html).toContain(
        `<span aria-hidden="true">${t('operations.crewPlan.viewOnlyMark', undefined, locale)}</span>`,
      );
      // Said: the whole sentence.
      expect(html).toContain(
        `<span class="sr-only">${t('operations.crewPlan.viewOnly', undefined, locale)}</span>`,
      );
    }
    expect(t('operations.crewPlan.viewOnlyMark')).toBe('للعرض فقط');
    expect(t('operations.crewPlan.viewOnlyMark', undefined, 'en')).toBe('View only');
    // The grant is still read in one place only (Round 32's gate).
    expect(BOARD.match(/mayPlan/gu)?.length).toBe(2);
    expect(t('operations.crewPlan.viewOnly')).toBe(
      'يمكنك الاطلاع على التشغيلة؛ أما التوزيع فيحتاج صلاحية تخطيط الطاقم.',
    );
    expect(t('operations.crewPlan.viewOnly', undefined, 'en')).toBe(
      'You can view the plan; planning needs the crew-planning permission.',
    );
  });
});

// Round 34 verifier — measured on the real stack: below 1280, from about 1060px (1242 is a 1366
// screen at 110%), the bar's five filters fill its first line, and «المعروض N من M» wrapped onto a
// line of its own — the table 35px down on every choice, Arabic and English, a plan and a record:
// «لما بختار حاجه بينزل سطر ل تحت». There the toolbar has a second line already (the totals take the
// first, the acts the second) with room at its start: the count stands there.
describe('Round 34 verifier — below 1280 «المعروض N من M» takes no line of its own either', () => {
  it('from 1280 at the bar’s end; below it — a phone too — at the end of the totals’ line', () => {
    expect(filteredCountAt({ oneLineHead: true })).toBe('bar');
    expect(filteredCountAt({ oneLineHead: false })).toBe('head');
  });

  it('the board asks it once, by the toolbar’s own width (1280), and draws the count in ONE place', () => {
    expect(BOARD).toContain('const countAt = filteredCountAt({ oneLineHead: useMinWidth(1280) });');
    // In the toolbar: inside the totals' line (the hand's children), after the strip — a line that
    // never wraps, so the count can never add one; the acts' line keeps its width for their words.
    const hand = TOOLBAR.slice(
      TOOLBAR.indexOf('<CrewPlanHand'),
      TOOLBAR.indexOf('</CrewPlanHand>'),
    );
    const strip = hand.indexOf('data-type-counts="true"');
    const count = hand.indexOf("{filtering && countAt === 'head' && (");
    expect(strip).toBeGreaterThan(0);
    expect(count).toBeGreaterThan(strip);
    expect(hand.slice(count)).toMatch(
      /<FilteredCount\s+shown=\{shown\.length\}\s+total=\{rows\.length\}\s+onClear=\{clearFilters\}\s+compact=\{phone\}\s+\/>/u,
    );
    expect(ACTS).not.toContain('<FilteredCount');
    // In the bar: only where the bar has the room — from 1280.
    expect(BAR).toContain("{filtering && countAt === 'bar' && (");
    expect(BOARD.match(/<FilteredCount\b/gu)?.length).toBe(2);
    // The bar no longer seats the type and the count together on a phone: the type has its line.
    expect(BAR).not.toContain('sm:contents');
    expect(BAR).toContain('className="w-full shrink-0 sm:w-40"');
  });
});

// Round 34 critic — what E left for the keyboard, a phone and a touch screen: a chip reached by Tab
// stood under the fade (`lib/side-scroll.spec.ts` drives the strip's listeners), «صيانة» could not be
// reached at all, and on a phone the count squeezed the type's box to its icon.
describe('Round 34 critic — «صيانة» is reached by Tab, its codes said', () => {
  it('it takes the focus, so Tab carries the line to its end; its codes describe it', () => {
    const chip = TOOLBAR.slice(
      TOOLBAR.indexOf('data-workshop-count='),
      TOOLBAR.indexOf('>', TOOLBAR.indexOf('data-workshop-count=')),
    );
    expect(chip).toContain('tabIndex={0}');
    expect(chip).toContain('aria-describedby={workshopWordsId}');
    expect(chip).toContain('title={workshopWords}');
    expect(BOARD).toContain('const workshopWordsId = useId();');
    // The words it points to: outside the scrolling box (nothing hidden in it adds to its width).
    const strip = TOOLBAR.slice(TOOLBAR.indexOf('data-type-counts="true"'));
    const words = strip.indexOf('<span id={workshopWordsId} className="sr-only">');
    expect(words).toBeGreaterThan(strip.indexOf('</div>'));
    expect(strip.slice(words)).toMatch(
      /^<span id=\{workshopWordsId\} className="sr-only">\s*\{workshopWords\}/u,
    );
    // Its focus ring drawn inside it, as every chip's: the strip clips what lies outside.
    expect(HEAD_CHIP).toContain('focus-visible:ring-inset');
  });

  it('the strip brings a chip reached by Tab clear of the fade — the board uses the hook that does', () => {
    expect(BOARD).toContain('const stripEdges = useSideScroll(stripRef);');
    expect(FRAME).toContain('a chip reached by Tab is\n * brought clear of the edge and its fade');
  });
});

describe('Round 34 critic — on a phone the count is figures only, beside the totals; the type keeps its box', () => {
  it('compact: «١٢ من ٢٦٥» seen, the whole sentence said and in its tooltip; «مسح التصفية» an ✕ named', () => {
    for (const locale of ['ar', 'en'] as const) {
      const html = render(
        <FilteredCount shown={12} total={265} onClear={() => undefined} compact />,
        locale,
      );
      const figures =
        locale === 'ar' ? { shown: '١٢', total: '٢٦٥' } : { shown: '12', total: '265' };
      const words = t('operations.crewPlan.filter.shown', figures, locale);
      const clear = t('operations.crewPlan.filter.clear', undefined, locale);
      expect(html).toContain(`title="${words}"`);
      expect(html).toContain(
        `<span aria-hidden="true">${t('operations.crewPlan.filter.shownShort', figures, locale)}</span><span class="sr-only">${words}</span>`,
      );
      expect(html).toContain(`aria-label="${clear}" title="${clear}"`);
      // The ✕ alone: no word drawn beside it.
      const button = html.slice(html.indexOf('<button'), html.indexOf('</button>'));
      expect(text(button)).toBe('');
      expect(button).toContain('h-[26px] w-[26px] justify-center !px-0');
    }
    expect(t('operations.crewPlan.filter.shownShort', { shown: '١٢', total: '٢٦٥' })).toBe(
      '١٢ من ٢٦٥',
    );
  });

  it('elsewhere (and on «الطاقم الثابت») the count keeps its words, as before', () => {
    const html = render(<FilteredCount shown={12} total={265} onClear={() => undefined} />);
    expect(text(html)).toBe(
      `${t('operations.crewPlan.filter.shown', { shown: '١٢', total: '٢٦٥' })} ${t('operations.crewPlan.filter.clear')}`,
    );
    expect(html).not.toContain('sr-only');
    expect(html).not.toContain('aria-label');
  });
});

describe('Round 34 critic — the owner’s words are quoted as he wrote them', () => {
  it('no comment puts a corrected paraphrase in quote marks as his', () => {
    const I18N_SPEC = read('../operations-i18n.spec.ts');
    for (const [name, source] of [
      ['CrewBoardPage', BOARD],
      ['CrewPlanFrame', FRAME],
      ['operations-i18n.spec', I18N_SPEC],
    ] as const) {
      expect(source, name).not.toContain('«امسح الحاجات');
      expect(source, name).not.toContain('وحط مكانها الاجماليات');
    }
    expect(BOARD).toContain('«واسمح الحاجات اللى فوق دى وحط مكاناها الاجماليات»');
    expect(FRAME).toContain('«واسمح الحاجات اللى فوق دى وحط مكاناها الاجماليات»');
    expect(I18N_SPEC).toContain('«واسمح الحاجات اللى فوق دى»');
  });
});

// ── Round 34 G and H ─────────────────────────────────────────────────────────────────────────────
// The owner's answer to the five open questions: «اعمل الافضل واعمل ميرج». «الطاقم الثابت» took the
// board's head (G — its page's own render in `pages/standing-crew-page.spec.tsx`); here, what the
// two share, and the board's past day (H).

describe('Round 34 G — what the two heads share', () => {
  it('`ViewOnlyMark` says why in the words of the screen it is on', () => {
    const board = render(<ViewOnlyMark />);
    expect(board).toContain(`title="${t('operations.crewPlan.viewOnly')}"`);
    for (const locale of ['ar', 'en'] as const) {
      const standing = render(
        <CrewPlanScopeProvider value="standing">
          <ViewOnlyMark />
        </CrewPlanScopeProvider>,
        locale,
      );
      const why = t('operations.standingCrew.viewOnly', undefined, locale);
      expect(standing).toContain(`title="${why}"`);
      expect(standing).toContain(`<span class="sr-only">${why}</span>`);
      expect(standing).toContain(
        `<span aria-hidden="true">${t('operations.crewPlan.viewOnlyMark', undefined, locale)}</span>`,
      );
    }
    expect(t('operations.standingCrew.viewOnly')).toBe(
      'يمكنك الاطلاع على الطاقم الثابت؛ أما تعديله فيحتاج صلاحية تخطيط الطاقم.',
    );
  });

  it('`CrewPlanHand` always holds the page’s totals: no legend branch is left to draw', () => {
    // `children` is required now: the hand is the totals' line, on both screens.
    expect(FRAME).toMatch(
      /children: ReactNode;\n\s+className\?: string;\n\}\): JSX\.Element => \{\n\s+const holding/u,
    );
    expect(FRAME).not.toContain('hint?: ReactNode');
  });
});

/** The board, server-rendered on a seeded cache: a day's read, its roster, the types, the areas. */
const me = (permissions: readonly string[]): MeDto =>
  ({
    id: 'u-1',
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization'])),
  }) as unknown as MeDto;
const PLANNER = ['operationsCrew.view', 'operationsCrew.plan'];
const boardOn = (day: string, past: boolean): OperationsCrewBoardDto =>
  ({
    date: `${day}T00:00:00.000Z`,
    today: `${cairoToday()}T00:00:00.000Z`,
    past,
    day: null,
    rows: [],
    vehiclelessRows: [],
    workshopVehicles: [{ vehicleId: 'v-310', vehicleCode: '310' }],
    freeVehicles: [],
    unidentifiedVehicles: 0,
  }) as unknown as OperationsCrewBoardDto;
const renderBoard = (day: string, past: boolean, locale: Locale = 'ar'): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(listKey('operations', 'crewBoard', { date: day }), boardOn(day, past));
  qc.setQueryData(listKey('operations', 'crewDirectory', { date: day }), {
    date: `${day}T00:00:00.000Z`,
    members: [],
    rosterIsDerived: true,
  });
  qc.setQueryData(listKey('operations', 'standingCrew', {}), {
    rows: [],
    available: [],
    unidentifiedVehicles: 0,
    availableIsFiltered: true,
  });
  qc.setQueryData(listKey('operations', 'areas', { whole: true, isActive: true }), ['مدينة نصر']);
  qc.setQueryData(listKey('operations', 'shiftTypes', SHIFT_TYPE_LIST), {
    items: [],
    meta: { page: 1, pageSize: 100, totalItems: 0, totalPages: 1 },
  });
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(PLANNER), status: 'signedIn' as const },
      ui: { theme: 'dark' as const, sidebarOpen: false },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/operations/crew-board?date=${day}`]}>
          <Routes>
            <Route path="/operations/crew-board" element={<CrewBoardPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};
/** An element's opening tag, by an attribute it carries. */
const tagOf = (html: string, mark: string): string => {
  const at = html.indexOf(mark);
  expect(at, mark).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
};
const PAST = '2025-03-10';
const AHEAD = '2099-01-15';

// Round 34 H — opening a past day dropped a line: Round 32's notice under the bar (62px and its gap —
// the table 78px down, up to 142px on a phone in English). «بدل ما انت لما بختار حاجه بينزل سطر ل تحت».
describe('Round 34 H — a past day takes no line of its own: the mark on the toolbar’s line says it all', () => {
  it('the record renders no notice under the bar — the bar is followed by the grid, nothing between', () => {
    for (const locale of ['ar', 'en'] as const) {
      const html = renderBoard(PAST, true, locale);
      expect(html, locale).not.toContain('data-record-title');
      const bar = html.indexOf('data-crew-plan-bar="true"');
      const grid = html.indexOf('data-crew-plan-grid="true"');
      expect(bar).toBeGreaterThan(-1);
      expect(html.slice(bar, grid)).not.toContain('data-crew-record');
      expect(html.slice(bar, grid)).not.toContain('role="status"');
      expect(html.slice(bar, grid)).not.toContain(
        t('operations.crewPlan.record.body', undefined, locale),
      );
    }
    expect(BOARD).not.toContain('RecordNotice');
  });

  // Round 34 H critic — REWRITTEN: «the mark — in the toolbar, before «العودة إلى اليوم» — names the
  // day, says what a record is, and is said aloud». The day and what a record is were the mark's
  // `title` — the mouse's alone; they are its card's now (a press, a tap, the keyboard) and what is
  // said (`aria-describedby`).
  it('the mark — in the toolbar, before «العودة إلى اليوم» — a button whose card names the day and says what a record is; no hover-only title; said aloud', () => {
    for (const locale of ['ar', 'en'] as const) {
      const html = renderBoard(PAST, true, locale);
      const toolbar = html.slice(
        html.indexOf('data-crew-plan-toolbar="true"'),
        html.indexOf('data-crew-plan-bar="true"'),
      );
      const mark = tagOf(toolbar, 'data-crew-record-mark="true"');
      const title = t(
        'operations.crewPlan.record.title',
        { day: dayText(`${PAST}T00:00:00.000Z`) },
        locale,
      );
      const body = t('operations.crewPlan.record.body', undefined, locale);
      // The day the probes and the specs read, kept on the mark.
      expect(mark, locale).toContain(`data-crew-record="${PAST}"`);
      expect(mark).toContain('role="status"');
      expect(mark).not.toContain('data-crew-record-lost');
      // A button — a tap and the keyboard reach it — closed at first; nothing in a browser `title`.
      const whole = toolbar.slice(
        toolbar.indexOf('data-crew-record-mark="true"'),
        toolbar.indexOf('data-crew-record-today'),
      );
      expect(whole).not.toContain('title=');
      const toggle = tagOf(whole, 'data-crew-record-toggle="true"');
      expect(toggle).toMatch(/^<button type="button"/u);
      expect(toggle).toContain('aria-expanded="false"');
      // What is said: the day and what a record is, the words the button is described by.
      const words = /aria-describedby="([^"]+)"/u.exec(toggle)?.[1] ?? '';
      expect(words).not.toBe('');
      expect(whole).toContain(`<span id="${words}" class="sr-only">${title} ${body}</span>`);
      expect(whole).toContain(
        `<span>${t('operations.crewPlan.record.mark', undefined, locale)}</span>`,
      );
      // What is seen when it opens: the card, both lines in words — none of it hidden.
      const card = render(
        <RecordCardBody dayLabel={dayText(`${PAST}T00:00:00.000Z`)} lost={0} />,
        locale,
      );
      expect(card).toContain('data-crew-record-card="true"');
      expect(text(card)).toBe(`${title} ${body}`);
      expect(card).not.toContain('sr-only');
      expect(card).not.toContain('data-crew-record-card-unsaved');
      expect(toolbar.indexOf('data-crew-record-mark')).toBeLessThan(
        toolbar.indexOf('data-crew-record-today'),
      );
      // A record has no acts: no add-row, no save.
      expect(toolbar).not.toContain('data-add-loose-row');
      expect(toolbar).not.toContain('data-crew-plan-save');
    }
  });

  // Round 34 H critic — REWRITTEN: «work the day’s end left unsaved stays on the mark: amber,
  // counted, its sentence in the tooltip and said». The sentence was the `title`'s third line — on a
  // phone and to a sighted keyboard user, once the toast had gone, an amber «١» said nothing more.
  it('work the day’s end left unsaved stays on the mark: amber, counted, its sentence in its card and said', () => {
    for (const locale of ['ar', 'en'] as const) {
      const html = render(<RecordMark day={PAST} dayLabel="10/03/2025" lost={3} />, locale);
      const mark = tagOf(html, 'data-crew-record-mark="true"');
      const toggle = tagOf(html, 'data-crew-record-toggle="true"');
      const unsaved = t(
        'operations.crewPlan.record.unsaved',
        { count: locale === 'ar' ? '٣' : '3' },
        locale,
      );
      expect(mark).toContain('data-crew-record-lost="3"');
      expect(html).not.toContain('title=');
      expect(toggle).toContain('border-amber-300 bg-amber-50 text-amber-900');
      expect(toggle).toContain('dark:bg-amber-400/10');
      expect(toggle).not.toContain('border-sky-200');
      // Its card, opened by a press, a tap or the keyboard: the sentence in words, in amber.
      const card = render(<RecordCardBody dayLabel="10/03/2025" lost={3} />, locale);
      expect(tagOf(card, 'data-crew-record-card-unsaved="true"')).toContain(
        'border-amber-300 bg-amber-50',
      );
      expect(text(card)).toBe(
        `${t('operations.crewPlan.record.title', { day: '10/03/2025' }, locale)} ${t('operations.crewPlan.record.body', undefined, locale)} ${unsaved}`,
      );
      expect(html).toMatch(
        new RegExp(
          `<span aria-hidden="true" data-crew-record-lost-count="true" class="[^"]*">${locale === 'ar' ? '٣' : '3'}</span>`,
          'u',
        ),
      );
      // Said: the button is described by the three sentences.
      const words = /aria-describedby="([^"]+)"/u.exec(toggle)?.[1] ?? '';
      const said = html.slice(html.indexOf(`<span id="${words}" class="sr-only">`));
      expect(said.slice(0, said.indexOf('</span>'))).toContain(
        `${t('operations.crewPlan.record.body', undefined, locale)} ${unsaved}`,
      );
    }
    // None lost: the calm sky mark, no badge.
    const calm = render(<RecordMark day={PAST} dayLabel="x" lost={0} />);
    expect(tagOf(calm, 'data-crew-record-toggle="true"')).toContain(
      'border-sky-200 bg-sky-50 text-sky-800',
    );
    expect(calm).not.toContain('data-crew-record-lost');
    // The board hands the mark its count, and still says the loss once by a toast as it happens.
    expect(BOARD).toContain('lost={lostOnRecord}');
    expect(BOARD).toContain("t('operations.crewPlan.record.unsavedTitle'),");
    expect(BOARD).toContain('}, [lostOnRecord]);');
  });

  it('«العودة إلى اليوم» brings no line back: a day to plan renders no mark and no notice either', () => {
    const html = renderBoard(AHEAD, false);
    expect(html).not.toContain('data-crew-record');
    expect(html).not.toContain('data-record-title');
    expect(html).toContain('data-add-loose-row="true"');
  });

  it('the record’s notice is still the distribution’s and the handover’s (not part of this change)', () => {
    for (const page of ['../pages/SecuredDistributionPage.tsx', '../pages/VaultHandoverPage.tsx']) {
      expect(read(page), page).toContain('<RecordNotice');
    }
  });
});

describe('Round 34 H — «إضافة صف بدون سيارة» is rows and a plus, never a bare «+»', () => {
  it('its icon is the board’s own drawing, not the plain plus — its word its name and its tooltip', () => {
    for (const locale of ['ar', 'en'] as const) {
      const html = renderBoard(AHEAD, false, locale);
      const start = html.indexOf('data-add-loose-row="true"');
      const button = html.slice(
        html.lastIndexOf('<button', start),
        html.indexOf('</button>', start),
      );
      const word = t('operations.crewPlan.addRow', undefined, locale);
      expect(button).toContain(`title="${word}"`);
      // The word stays — the screen reader's name, seen in words where the acts have them.
      expect(button).toContain(`>${word}</span>`);
      for (const d of PLAN_ICON.addRow) expect(button, d).toContain(`d="${d}"`);
      expect(button).not.toContain(`d="${PATH.plus[0]}"`);
      // Mirrored in Arabic: the plus at the rows' end.
      expect(button).toContain('rtl:-scale-x-100');
    }
    expect(PLAN_ICON.addRow).not.toEqual(PATH.plus);
    // More than a plus: three rows of the table beside it. (Round 34 H critic — the rows' heights are
    // no longer whole numbers: read with their fraction.)
    expect(PLAN_ICON.addRow.filter((d) => /^M4 [\d.]+h/u.test(d))).toHaveLength(3);
  });
});

/**
 * Every straight line of a drawing that runs along the grid: a horizontal one at its height `y`, a
 * vertical one at its `x` — read off the path's M, H, V, h, v, l and a commands (an arc only moves
 * the pen; a slanted line is not counted).
 */
const gridLines = (paths: readonly string[]): { along: 'h' | 'v'; at: number }[] => {
  const found: { along: 'h' | 'v'; at: number }[] = [];
  for (const d of paths) {
    let x = 0;
    let y = 0;
    for (const [, command = '', args = ''] of d.matchAll(/([MmHhVvLlAaZz])([^MmHhVvLlAaZz]*)/gu)) {
      const n = (args.match(/-?\d*\.?\d+/gu) ?? []).map(Number);
      const at = (i: number): number => n[i] ?? 0;
      if (command === 'M') [x, y] = [at(0), at(1)];
      else if (command === 'm') [x, y] = [x + at(0), y + at(1)];
      else if (command === 'H' || command === 'h') {
        found.push({ along: 'h', at: y });
        x = command === 'H' ? at(0) : x + at(0);
      } else if (command === 'V' || command === 'v') {
        found.push({ along: 'v', at: x });
        y = command === 'V' ? at(0) : y + at(0);
      } else if (command === 'L') [x, y] = [at(0), at(1)];
      else if (command === 'l') [x, y] = [x + at(0), y + at(1)];
      else if (command === 'a') [x, y] = [x + at(5), y + at(6)];
      else if (command === 'A') [x, y] = [at(5), at(6)];
    }
  }
  return found;
};

// Round 34 H critic — at 1x the add-row icon's middle row was a 2px grey smear and its plus 4px.
describe('Round 34 H critic — the add-row and add-van drawings land on the pixels they are drawn on', () => {
  it('drawn at 14px, every row and every arm of the plus lies on a pixel’s middle — none on an edge', () => {
    // Shown at 14px (`h-3.5`): 7/12 of the 24 units. A 2-unit stroke is 1.17px — sharp only centred
    // on a pixel (× 7/12 = n + ½); on a pixel's edge it is two half-grey pixels.
    expect(BOARD).toContain(
      '<BoardIcon d={PLAN_ICON.addRow} className="h-3.5 w-3.5 rtl:-scale-x-100" />',
    );
    expect(STANDING).toContain(
      '<BoardIcon d={PLAN_ICON.addVan} className="h-3.5 w-3.5 rtl:-scale-x-100" />',
    );
    for (const [name, paths] of [
      ['addRow', PLAN_ICON.addRow],
      ['addVan', PLAN_ICON.addVan],
    ] as const) {
      const lines = gridLines(paths);
      expect(lines.length, name).toBeGreaterThanOrEqual(5);
      for (const line of lines) {
        const pixel = (line.at * 14) / 24;
        expect(Math.abs((pixel % 1) - 0.5), `${name} ${line.along} at ${line.at}`).toBeLessThan(
          0.02,
        );
      }
    }
    // The rows: three, 4px apart; the plus 8 units across (4.7px at 14px, was 7: 4px).
    const rows = gridLines(PLAN_ICON.addRow).filter((line) => line.along === 'h');
    expect(rows.map((row) => Math.round((row.at * 14) / 24 - 0.5))).toEqual([2, 6, 10, 8]);
    expect(PLAN_ICON.addRow).toContain('M14 14.57h8');
    expect(PLAN_ICON.addRow).toContain('M18 10.57v8');
  });

  it('«إضافة سيارة» is a van and a plus — not the board’s rows, not a bare «+»', () => {
    expect(PLAN_ICON.addVan).not.toEqual(PLAN_ICON.addRow);
    expect(PLAN_ICON.addVan).not.toEqual(PATH.plus);
    // Two wheels (rings), a body and a plus.
    expect(PLAN_ICON.addVan.filter((d) => /a1\.5 1\.5/u.test(d))).toHaveLength(2);
    expect(STANDING).not.toContain('d={PATH.plus}');
  });
});

// Round 34 H critic — once the toast had gone, the mark's meaning lived in a `title`: the mouse's
// alone. A phone has no hover, and the keyboard's focus shows no `title`.
describe('Round 34 H critic — the record mark’s card is reached without hover: a press, a tap, the keyboard', () => {
  it('a press opens a closed card, holds one the pointer opened, and closes one a press or the keyboard opened', () => {
    expect(togglePress(false, 'hover')).toBe('show');
    expect(togglePress(false, 'focus')).toBe('show');
    expect(togglePress(false, 'press')).toBe('show');
    // Opened under the pointer: a press keeps it (held; the pointer may then leave).
    expect(togglePress(true, 'hover')).toBe('show');
    expect(togglePress(true, 'focus')).toBe('close');
    expect(togglePress(true, 'press')).toBe('close');
  });

  it('a toggle’s trigger answers a press (its click); every other card still closes on one', () => {
    const Probe = ({ toggle }: { toggle: boolean }): JSX.Element => {
      const card = useHoverCard(true, { toggle, focusable: !toggle });
      return <i>{Object.keys(card.triggerProps).sort().join(' ')}</i>;
    };
    const keys = (toggle: boolean): string[] =>
      text(renderToStaticMarkup(<Probe toggle={toggle} />)).split(' ');
    expect(keys(true)).toContain('onClick');
    expect(keys(true)).not.toContain('onMouseDown');
    expect(keys(true)).not.toContain('tabIndex');
    expect(keys(false)).toContain('onMouseDown');
    expect(keys(false)).not.toContain('onClick');
    // The press that opens it is not a press elsewhere: its own trigger's is let through.
    expect(read('../../fleet/components/HoverCardLayer.tsx')).toContain(
      'if (toggle && target instanceof Node && anchor.current?.contains(target) === true) return;',
    );
  });

  it('the mark is that toggle: a button, its card in the hover cards’ layer — nothing in a `title`', () => {
    const mark = FRAME.slice(
      FRAME.indexOf('export const RecordMark'),
      FRAME.indexOf('export const RecordCardBody'),
    );
    expect(mark).toContain('const card = useHoverCard(true, { toggle: true, focusable: false });');
    expect(mark).toContain('<HoverCardLayer id={card.id} anchor={card.anchor} mark="crew-record">');
    expect(mark).toContain('<RecordCardBody dayLabel={dayLabel} lost={lost} />');
    expect(mark).not.toMatch(/\btitle=/u);
    for (const locale of ['ar', 'en'] as const) {
      const html = render(<RecordMark day={PAST} dayLabel="x" lost={2} />, locale);
      expect(tagOf(html, 'data-crew-record-toggle="true"'), locale).toMatch(
        /^<button type="button" aria-expanded="false" aria-describedby="[^"]+"/u,
      );
      expect(html).not.toContain('title=');
    }
  });
});

// Round 34 H critic — at 320–359 the acts took one line in one state and two in another: opening a
// past day, «العودة إلى اليوم» and the first change moved the table 48px.
describe('Round 34 H critic — below 360 the acts’ line keeps two rows’ room, whatever it holds', () => {
  it('two 44px rows and the 4px between them (92px), on a day to plan and on a past day alike', () => {
    expect(classesOf(BOARD, 'NARROW_ACTS_ROOM')).toContain("'max-[359px]:min-h-[92px]'");
    // 92 = 44 (`WORD_ACT`, `ICON_ACT` below 820) × 2 + 4 (`gap-1`).
    expect(classesOf(BOARD, 'WORD_ACT')).toContain("'max-[819px]:h-11'");
    expect(classesOf(BOARD, 'ICON_ACT')).toContain('max-[819px]:h-11');
    for (const [day, past] of [
      [AHEAD, false],
      [PAST, true],
    ] as const) {
      for (const locale of ['ar', 'en'] as const) {
        const acts = tagOf(renderBoard(day, past, locale), 'data-crew-plan-acts="true"');
        expect(acts, `${day} ${locale}`).toContain('max-[359px]:min-h-[92px]');
        expect(acts).toContain('flex-wrap');
        expect(acts).toContain('gap-1');
      }
    }
  });
});
