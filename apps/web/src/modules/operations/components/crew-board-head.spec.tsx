// Round 34 E — «لوحة التشغيلة»'s head. The owner, circling the toolbar's start (the role legend and
// the hint under it): «واسمح الحاجات اللى فوق دى وحط مكاناها الاجماليات بدل ما انت لما بختار حاجه
// بينزل سطر ل تحت».
//
// What a typecheck cannot see:
//   • the legend and the hint are gone from the board (not drawn elsewhere either); «الطاقم الثابت»
//     keeps its own;
//   • the totals — «الإجمالي», a chip per type, «بدون نوع», «صيانة» — are IN the toolbar, at its
//     start, before the acts; the bar under it holds the filters only;
//   • nothing takes a line of its own when something is picked: from 1280 the toolbar and the bar
//     never wrap, the totals scroll inside their box rather than wrap, and a chip picked up stands at
//     the totals' start on their line — its name, «إلغاء» and Escape kept, the totals still pressed;
//   • the acts keep their names (read aloud, and in the tooltip) when they show their icon only —
//     from 1280 to 1759, and below 820; between, and from 1760, their words;
//   • a reader without the planning grant is told the board is read only — «للعرض فقط», not a line.
//
// The suite runs in node with no DOM: the pieces are rendered on their own (`CrewPlanHand`,
// `FilteredCount`, `ViewOnlyMark`), the strip's listeners are driven on a stand-in box
// (`lib/side-scroll.spec.ts`), and the page is read as source (as the board's own specs read it) —
// those pins say WHERE a thing is drawn. What only a browser can measure — the table's top not
// moving on any choice, no sideways page scroll, a chip reached by Tab standing clear of the fade —
// is verified on the built page, at every width from 360 to 1760, Arabic and English (Round 34 E,
// its verifier and its critic: their shoot scripts and reports in the CHANGELOG).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import type { Locale } from '@ecms/contracts';
import type { ReactNode } from 'react';
import { localeSlice } from '../../../store/localeSlice';
import { translate } from '../../../platform/localization/i18n';
import {
  COUNT_CHIP,
  CrewPlanHand,
  FilteredCount,
  HEAD_CHIP,
  HEAD_STRIP,
  PickedPill,
  ViewOnlyMark,
  filteredCountAt,
} from './CrewPlanFrame';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const BOARD = read('../pages/CrewBoardPage.tsx');
const STANDING = read('../pages/StandingCrewPage.tsx');
const FRAME = read('./CrewPlanFrame.tsx');
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
/** The bar, from its mark to the record's notice. */
const BAR = BOARD.slice(
  BOARD.indexOf('data-crew-plan-bar="true"'),
  BOARD.indexOf("{/* Round 32 — a past day: the record's notice, calm, under the bar. */}"),
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

  it('«الطاقم الثابت» keeps its legend and its hint, unchanged', () => {
    const hand = STANDING.slice(STANDING.indexOf('<CrewPlanHand'));
    expect(hand.slice(0, hand.indexOf('/>'))).toContain("t('operations.standingCrew.hint')");
    const legend = render(
      <CrewPlanHand pickedName={null} onCancel={() => undefined} hint="تلميح" />,
    );
    expect(legend).toContain('data-role-legend="true"');
    expect(text(legend)).toContain('تلميح');
    expect(legend).not.toContain('data-crew-plan-head');
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
    expect(classesOf(BOARD, 'CREW_PLAN_BAR_LINE')).toContain(
      "cn(CREW_PLAN_BAR, 'min-[1280px]:flex-nowrap min-[1280px]:gap-x-2')",
    );
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

  it('the pill reads the same in English, and «الطاقم الثابت» keeps it in its toolbar’s start', () => {
    const en = text(render(<PickedPill name="Ahmed" onCancel={() => undefined} />, 'en'));
    expect(en).toContain(t('operations.crewPlan.picked', { name: 'Ahmed' }, 'en'));
    expect(en).toContain(t('operations.crewPlan.cancelPick', undefined, 'en'));
    const standing = render(<CrewPlanHand pickedName="احمد" onCancel={() => undefined} hint="x" />);
    expect(standing).toContain('data-crew-picked="true"');
    expect(standing).not.toContain('data-crew-plan-head');
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
    // «الطاقم الثابت» and «المعروض» keep the shared chip.
    expect(COUNT_CHIP).toContain('px-1 py-1 text-[11.5px]');
    expect(BOARD).not.toContain('COUNT_CHIP');
    expect(BOARD).toContain(
      "const HEAD_FIGURE = 'text-[11px] font-black min-[1440px]:text-[11.5px]';",
    );
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

  it('a past day keeps its mark and «العودة إلى اليوم» in words, in the acts’ place', () => {
    const record = ACTS.slice(ACTS.indexOf('{isRecord && ('), ACTS.indexOf('{canPlan && ('));
    expect(record).toContain('data-crew-record-mark="true"');
    expect(record).toContain("{t('operations.crewPlan.record.mark')}");
    expect(record).toContain("{t('operations.crewPlan.record.today')}");
    expect(record).not.toContain('ACT_WORD');
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
