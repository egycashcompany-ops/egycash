// Round 32 C — «تبديل بين سيارتين» on «لوحة التشغيلة»: «انا عاوز بقى اقدر اعمل اسوابنج بين عربيتين
// واقدر احدد هنقل ايه بالظبط للعربيه التانيه … ف ممكن تعملى سامبل كل عربيه بالبيانات على كارد جمب بعض
// الاتنين».
//
// The window as drawn (the suite runs in node with no DOM: the portal made a plain child, the page
// read as source): the two cards side by side with a box on every item, the three arrows between
// them, the second van's list — and, since Round 34 D, the cards as the window's WORKING COPY: what a
// press moved («من 213»), what it replaced (struck), what a rule kept back (rose, and named under
// the arrows), in both languages; the arrows as actions (their hues at rest, filled under the
// pointer and while held, why one cannot act); the footer's «تطبيق», «إلغاء» and «تراجع عن آخر نقل»;
// and the board's wiring: the row's «⇄» only where the board may be planned, «تطبيق» one operation
// of «تراجع». The window's state itself is driven in `lib/crew-swap-window.spec.ts`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import {
  type Locale,
  type MeDto,
  type OperationsCrewMemberDto,
  type OperationsShiftTypeDto,
} from '@ecms/contracts';
import type * as DesignDialogModule from '../../fleet/components/DesignDialog';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { translate } from '../../../platform/localization/i18n';
import { formatNumber } from '../../../shared/lib/format';
import { vehiclelessRow, type PlanRow } from '../lib/crew-plan';
import {
  fieldItem,
  personItem,
  replaySwap,
  type SwapMode,
  type SwapPicks,
  type SwapRules,
  type SwapStep,
} from '../lib/crew-swap';
import type * as SwapWindowModule from '../lib/crew-swap-window';
import {
  SWAP_HOLD_MS,
  SWAP_WINDOW_START,
  swapWindowReducer,
  type SwapWindow,
  type SwapWindowState,
} from '../lib/crew-swap-window';
import type * as SwapArrowsModule from './crew-swap-arrows';
import { CrewSwapDialog, SwapCloseAsk, SwapFooter } from './CrewSwapDialog';
import { NO_COLOUR_TONE, SHIFT_TYPE_TONE } from './shift-type-look';
import {
  SWAP_ARROW_LOOK,
  SwapArrows,
  swapArrowAim,
  swapArrowClasses,
  swapArrowTone,
  swapArrowTurn,
  type ArrowWay,
} from './crew-swap-arrows';

(globalThis as Record<string, unknown>).document ??= { body: {} };
// The window moves the focus on the next frame (the close question's «تطبيق»); no frames in node.
(globalThis as Record<string, unknown>).requestAnimationFrame ??= () => 0;
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});
// Round 34 D — the window's frame, kept as it is, its props seen: ✕ and Escape close through its
// `onClose`, the footer is the window's `SwapFooter`.
const frame = vi.hoisted(() => ({
  props: null as null | { onClose: () => void; footer: unknown },
}));
// Round 34 D critic — the window's store and its arrows, kept as they are, seen: a press is the
// arrows' own handler, and what it does lands in the store the window made (`createSwapWindow`).
const wiring = vi.hoisted(() => ({
  store: null as null | SwapWindow,
  arrows: null as null | { onPress: (mode: SwapMode) => void; held: SwapMode | null },
}));
vi.mock('../lib/crew-swap-window', async () => {
  const actual = await vi.importActual<typeof SwapWindowModule>('../lib/crew-swap-window');
  return {
    ...actual,
    createSwapWindow: (...args: Parameters<typeof actual.createSwapWindow>) => {
      const store = actual.createSwapWindow(...args);
      wiring.store = store;
      return store;
    },
  };
});
vi.mock('./crew-swap-arrows', async () => {
  const actual = await vi.importActual<typeof SwapArrowsModule>('./crew-swap-arrows');
  return {
    ...actual,
    SwapArrows: (props: Parameters<typeof actual.SwapArrows>[0]) => {
      wiring.arrows = props;
      return actual.SwapArrows(props);
    },
  };
});
vi.mock('../../fleet/components/DesignDialog', async () => {
  const actual = await vi.importActual<typeof DesignDialogModule>(
    '../../fleet/components/DesignDialog',
  );
  return {
    ...actual,
    DesignDialog: (props: Parameters<typeof actual.DesignDialog>[0]) => {
      frame.props = props;
      return actual.DesignDialog(props);
    },
  };
});

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const t = (key: string, vars?: Record<string, string>, locale: Locale = 'ar'): string =>
  translate(locale, key, vars);
const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const van = (code: string, over: Partial<PlanRow> = {}): PlanRow => ({
  key: `van:v-${code}`,
  vehicleId: `v-${code}`,
  vehicleCode: code,
  onRoster: true,
  crewId: `crew-${code}`,
  drivers: [],
  slots: { captain: [], specialist1: [], specialist2: [] },
  direction: null,
  plannedTime: null,
  shiftTypeId: null,
  rowColour: null,
  notes: null,
  ...over,
});

const NAMES: Record<string, string> = {
  c1: 'أحمد سيد بركة',
  c2: 'محمد عبد الواحد',
  s1: 'وائل صلاح بشير',
  s2: 'شهاب عزمي محمد',
  s3: 'كريم فتحي',
};
const member = (employeeId: string): OperationsCrewMemberDto =>
  ({
    employeeId,
    code: `01-${employeeId}`,
    fullNameAr: NAMES[employeeId] ?? employeeId,
    status: 'active',
    jobTitle: null,
    phone: null,
    branchId: null,
    requirements: null,
    assignedVehicleId: null,
  }) as OperationsCrewMemberDto;

const shiftType = (
  id: string,
  name: string,
  nameEn: string,
  colour: OperationsShiftTypeDto['colour'],
  sortOrder: number,
): OperationsShiftTypeDto => ({
  id,
  name,
  nameEn,
  colour,
  sortOrder,
  isActive: true,
  version: 1,
  createdAt: '',
  updatedAt: '',
});
const TYPES = [
  shiftType('t-daily', 'يومي', 'Daily', 'navy', 0),
  shiftType('t-res', 'احتياطي', 'Reserve', 'teal', 1),
];

const V150 = van('150', {
  slots: { captain: ['c1'], specialist1: ['s1'], specialist2: ['s2'] },
  direction: 'المعادي',
  plannedTime: '07:30',
  shiftTypeId: 't-daily',
  rowColour: 'navy',
  notes: 'تسليم البنك الأهلي',
  drivers: [{ employeeId: 'd1', fullNameAr: 'سعيد السائق' }],
});
const V213 = van('213', {
  slots: { captain: ['c2'], specialist1: ['s3'], specialist2: [] },
  direction: 'حلوان',
  plannedTime: '09:00',
  shiftTypeId: 't-res',
});
const LOOSE: PlanRow = { ...vehiclelessRow(1), key: 'loose:c-9', crewId: 'c-9' };
const ROWS = [V150, V213, LOOSE];

const rules = (away: Record<string, 'absent' | 'onLeave'> = {}): SwapRules => ({
  roleOf: (id) => (id.startsWith('c') ? 'captain' : 'specialist'),
  awayOf: (id) => away[id] ?? null,
  typeMayGo: () => true,
});

type Initial = { bKey: string } & Partial<SwapWindowState>;
const render = (
  options: {
    locale?: Locale;
    initial?: Initial;
    away?: Record<string, 'absent' | 'onLeave'>;
    rows?: readonly PlanRow[];
    rules?: SwapRules;
    onApply?: (bKey: string, steps: readonly SwapStep[]) => void;
    onClose?: () => void;
  } = {},
): string => {
  const locale = options.locale ?? 'ar';
  return renderToStaticMarkup(
    <Provider
      store={configureStore({
        reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
        preloadedState: {
          locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
          auth: {
            me: { id: 'u1', permissions: {} } as unknown as MeDto,
            status: 'signedIn' as const,
          },
        },
      })}
    >
      <CrewSwapDialog
        aKey={V150.key}
        rows={options.rows ?? ROWS}
        rowName={(row) =>
          row.vehicleCode ?? translate(locale, 'operations.crewPlan.looseRow', { n: '1' })
        }
        member={member}
        rules={options.rules ?? rules(options.away)}
        shiftTypes={TYPES}
        colourName={(colour) =>
          translate(locale, `operations.catalogs.shiftType.colours.${colour}`)
        }
        locale={locale}
        onApply={options.onApply ?? (() => undefined)}
        onClose={options.onClose ?? (() => undefined)}
        {...(options.initial === undefined ? {} : { initial: options.initial })}
      />
    </Provider>,
  );
};

/**
 * The window after presses, as the window makes them (`swapWindowReducer` on the working copy):
 * each `[mode, picks]` pressed in turn on what the one before left. `held` — the last one still
 * playing (the arrow filled); otherwise settled.
 */
const pressed = (
  presses: readonly (readonly [SwapMode, SwapPicks])[],
  options: { rows?: { a: PlanRow; b: PlanRow }; rules?: SwapRules; held?: boolean } = {},
): SwapWindowState => {
  const base = options.rows ?? { a: V150, b: V213 };
  const judge = options.rules ?? rules();
  let state = SWAP_WINDOW_START;
  for (const [mode, picks] of presses) {
    state = swapWindowReducer(state, { type: 'settle' });
    // The working copy the press sees: the steps so far replayed — exactly as the window does.
    const now = replaySwap(base.a, base.b, state.steps, judge);
    state = swapWindowReducer(
      { ...state, picks },
      { type: 'press', mode, rows: { a: now.a, b: now.b }, rules: judge },
    );
  }
  return options.held === false ? swapWindowReducer(state, { type: 'settle' }) : state;
};

/**
 * «تطبيق» off with its reason (Round 34 D critic): reachable and named why — `aria-disabled`, not a
 * native `disabled` that hid the reason from the keyboard and the screen reader.
 */
const applyOff = (html: string, count: string, why: string): void => {
  const at = html.indexOf(`data-swap-apply="${count}"`);
  expect(at).toBeGreaterThan(-1);
  const markup = html.slice(html.lastIndexOf('<button', at), html.indexOf('>', at) + 1);
  expect(markup).toContain('aria-disabled="true"');
  expect(markup).not.toMatch(/\sdisabled=""/);
  expect(markup).toContain(`title="${why}"`);
  expect(markup).toContain(`aria-label="${t('operations.crewPlan.swap.apply')} — ${why}"`);
};

/** The markup of one card, by its mark. */
const card = (html: string, mark: string): string => {
  const at = html.indexOf(mark);
  expect(at).toBeGreaterThan(-1);
  const end = html.indexOf('</section>', at);
  return html.slice(at, end);
};

describe('the window opens on the row it was pressed on — the second van still to pick', () => {
  const html = render();

  it('the first card is that row, every item with its own box; the second is the board’s other rows', () => {
    const first = card(html, 'data-swap-card="a"');
    expect(text(first)).toContain('150');
    expect(text(first)).toContain(t('operations.crewPlan.swap.first'));
    // 3 people + 5 fields = 8 boxes, each named by what it moves and where.
    // Round 34 critic — REWRITTEN: before the second van is chosen it is «السيارة الثانية», not
    // «—» (the box read «نقل … إلى —»).
    expect(first.match(/type="checkbox"/g)).toHaveLength(8);
    expect(first).toContain(
      `aria-label="${t('operations.crewPlan.swap.item', {
        item: `${NAMES.c1} — ${t('operations.crewPlan.columns.captain')}`,
        to: t('operations.crewPlan.swap.secondVan'),
      })}"`,
    );
    expect(first).not.toMatch(/aria-label="[^"]*—"/);
    // The drivers stay with the van: said, never ticked.
    expect(text(first)).toContain(t('operations.crewPlan.swap.drivers', { names: 'سعيد السائق' }));
    const chooser = card(html, 'data-swap-chooser="true"');
    expect(chooser).toContain('data-swap-choose="van:v-213"');
    expect(chooser).toContain('data-swap-choose="loose:c-9"');
    expect(text(chooser)).toContain(t('operations.crewPlan.looseRow', { n: '1' }));
    expect(chooser).not.toContain('data-swap-choose="van:v-150"');
  });

  // Round 34 D — REWRITTEN: «… and no preview until the second van is picked». The window has no
  // preview any more (the cards themselves change as the arrows are pressed); «تطبيق» says why it
  // is off. Round 34 D critic — REWRITTEN (title kept): off by `aria-disabled` with its reason in
  // its name, no longer a native `disabled` (`applyOff`).
  it('nothing to apply until the second van is picked — and no preview section at all', () => {
    applyOff(html, '0', t('operations.crewPlan.swap.pickSecondFirst'));
    expect(html).not.toContain('data-swap-after');
    expect(html).not.toContain('data-swap-preview');
    expect(text(html)).toContain(t('operations.crewPlan.swap.pickSecondFirst'));
  });

  it('never shows a raw key', () => {
    expect(text(html)).not.toMatch(/operations\.crewPlan/);
  });
});

// Round 34 D — REWRITTEN describe: «two cards side by side, the ticks, the ways and the preview AFTER».
describe('two cards side by side, the ticks and the arrows between them — the cards are the working copy', () => {
  const picks: SwapPicks = {
    a: [personItem('c1'), personItem('s2'), fieldItem('direction'), fieldItem('notes')],
    b: [personItem('c2'), fieldItem('direction'), fieldItem('plannedTime')],
  };
  const html = render({ initial: { bKey: V213.key, picks } });

  // Round 34 D — REWRITTEN: it also held the preview's two cards in the same order; there is none.
  it('the first card BEFORE the second in the markup — on the right in Arabic, on the left in English', () => {
    expect(html.indexOf('data-swap-card="a"')).toBeLessThan(html.indexOf('data-swap-modes'));
    expect(html.indexOf('data-swap-modes')).toBeLessThan(html.indexOf('data-swap-card="b"'));
  });

  // Round 34 D — REWRITTEN: a field ticked in «تبديل المحدد ⇄» showed ticked on both cards (5 on
  // 150). No way is chosen now: each card's ticks are its own (4 on 150, 3 on 213) and every box
  // can be ticked — the arrow pressed decides which ticks it reads.
  it('the ticked items are checked; each card has «الكل» · «الطاقم فقط» · «لا شيء»; every box live', () => {
    const first = card(html, 'data-swap-card="a"');
    const second = card(html, 'data-swap-card="b"');
    expect(first.match(/data-swap-ticked="true"/g)).toHaveLength(4);
    expect(second.match(/data-swap-ticked="true"/g)).toHaveLength(3);
    expect(first).not.toMatch(/data-swap-item="field:plannedTime" data-swap-ticked="true"/);
    for (const pick of ['all', 'crew', 'none']) {
      expect(html).toContain(`data-swap-quick="a:${pick}"`);
      expect(html).toContain(`data-swap-quick="b:${pick}"`);
    }
    expect(text(first)).toContain(t('operations.crewPlan.swap.quick.crew'));
    expect(second.match(/type="checkbox"/g)).toHaveLength(5);
    expect(html).not.toMatch(/type="checkbox"[^>]*disabled=""/);
    expect(html).not.toMatch(/data-swap-quick="[^"]+"[^>]*disabled=""/);
  });

  // Round 34 A → Round 34 D — REWRITTEN: «the three ways are a radio group, the swap on — each named
  // by what it does with both vans». The owner: «أنا يعتبر محدد اللي في النص» — nothing is chosen
  // any more; the three are buttons that ACT.
  it('the three arrows are ACTIONS — a toolbar of buttons, no radio, nothing «selected» — each named by what it does with both vans', () => {
    expect(html).not.toContain('role="radiogroup"');
    expect(html).not.toContain('role="radio"');
    expect(html).not.toContain('aria-checked');
    expect(html).toContain('role="toolbar"');
    const arrows = html.match(/data-swap-mode="(\w+)"/g)?.map((one) => one.split('"')[1]);
    expect(arrows).toEqual(['aToB', 'swap', 'bToA']);
    expect(html).not.toContain('data-swap-held');
    expect(t('operations.crewPlan.swap.mode.aToB', { a: '150', b: '213' })).toBe(
      'نقل المحدد من 150 إلى 213',
    );
    expect(t('operations.crewPlan.swap.mode.bToA', { a: '150', b: '213' })).toBe(
      'نقل المحدد من 213 إلى 150',
    );
    expect(t('operations.crewPlan.swap.mode.swap', { a: '150', b: '213' })).toBe(
      'تبديل المحدد بين 150 و213 في الاتجاهين',
    );
    expect(t('operations.crewPlan.swap.mode.aToB', { a: '150', b: '213' }, 'en')).toBe(
      'Move selected from 150 to 213',
    );
  });

  // Round 34 D — REWRITTEN: «the preview: who arrives «من 213» / «من 150», the fields exchanged —
  // nothing thrown away — what goes». The preview is gone: a press MOVES, and the cards show it.
  it('a press of the swap moves at once: each card holds what arrived «من 213» / «من 150» — the fields exchanged, nothing thrown away — and the ticks clear', () => {
    const after = render({
      initial: { bKey: V213.key, ...pressed([['swap', picks]], { held: false }) },
    });
    const on150 = card(after, 'data-swap-card="a"');
    const on213 = card(after, 'data-swap-card="b"');
    // c2 is on 150 now and c1, s2 on 213; the directions and the times exchanged; 150's notes moved.
    expect(on150).toContain('data-swap-arrived="person:c2"');
    expect(on150).toContain('data-swap-arrived="field:direction"');
    expect(on150).toContain('data-swap-arrived="field:plannedTime"');
    expect(text(on150)).toContain(t('operations.crewPlan.swap.from', { row: '213' }));
    expect(on213).toContain('data-swap-arrived="person:c1"');
    expect(on213).toContain('data-swap-arrived="person:s2"');
    expect(on213).toContain('data-swap-arrived="field:notes"');
    expect(text(on213)).toContain('المعادي');
    expect(text(on213)).toContain('07:30');
    expect(text(on150)).toContain('09:00');
    expect(text(on150)).toContain('حلوان');
    expect(on150).not.toContain('data-swap-item="person:c1"');
    expect(on213).not.toContain('data-swap-item="person:c2"');
    // An exchange replaces nothing; the ticks are gone.
    expect(after).not.toContain('data-swap-replaced');
    expect(after).not.toContain('data-swap-ticked');
    // The footer counts what crossed: 3 people + direction both ways + time both ways + notes.
    expect(after).toContain('data-swap-apply="8"');
    expect(text(after)).toContain(
      t('operations.crewPlan.swap.summary', {
        moved: formatNumber(8, 'ar'),
        kept: formatNumber(0, 'ar'),
      }),
    );
    // Round 34 D critic — REWRITTEN (title kept): the separator was «·», read as the zero «٠»
    // beside the Arabic digits («نُقل: ٢ · بقي: ١»); a dash now. And «تطبيق» on: no `aria-disabled`.
    expect(t('operations.crewPlan.swap.summary', { moved: '٨', kept: '٠' })).toBe(
      'نُقل: ٨ — بقي: ٠',
    );
    expect(after).not.toMatch(/data-swap-apply="8"[^>]*(\sdisabled=""|aria-disabled="true")/);
  });

  // Round 34 D — REWRITTEN: the struck value was the preview's; it is on the card now, after the press.
  it('one way: a field moved onto a value names the value it replaces, struck', () => {
    const oneWay = render({
      initial: {
        bKey: V213.key,
        ...pressed([['aToB', { a: [fieldItem('plannedTime')], b: [] }]], { held: false }),
      },
    });
    const on213 = card(oneWay, 'data-swap-card="b"');
    expect(on213).toContain('data-swap-replaced="plannedTime"');
    expect(on213).toMatch(/<s[^>]*>09:00<\/s>/);
    expect(text(on213)).toContain('07:30');
    // 150 is left without one — «—».
    expect(card(oneWay, 'data-swap-card="a"')).not.toContain('data-swap-item="field:plannedTime"');
  });

  // Round 34 D — REWRITTEN: «a rule keeps an item back — shown on the preview with its reason,
  // counted as staying». Now: it flashes rose on its own card while the press plays, the notice
  // under the arrows names it and why, the footer counts it, and «تطبيق» stays off — nothing changed.
  it('a rule keeps an item back — rose «لم يُنقل» on its card, named with its reason under the arrows, counted in the footer', () => {
    const kept = render({
      away: { c1: 'absent' },
      initial: {
        bKey: V213.key,
        ...pressed([['aToB', { a: [personItem('c1')], b: [] }]], {
          rules: rules({ c1: 'absent' }),
        }),
      },
    });
    const on150 = card(kept, 'data-swap-card="a"');
    expect(on150).toContain('data-swap-kept="person:c1"');
    expect(text(on150)).toContain(t('operations.crewPlan.swap.kept'));
    expect(on150).toMatch(/data-swap-item="person:c1"[^>]*class="[^"]*rose/);
    const notice = kept.slice(kept.indexOf('data-swap-notice="true"'));
    expect(kept).toContain('data-swap-notice="true"');
    expect(text(notice)).toContain(
      t('operations.crewPlan.swap.keptLine', {
        item: NAMES.c1 ?? '',
        reason: t('operations.crewPlan.swap.reason.absent'),
      }),
    );
    // Round 34 D critic — REWRITTEN (title kept): off by `aria-disabled`, saying why (`applyOff`).
    applyOff(kept, '0', t('operations.crewPlan.swap.nothingChanged'));
    expect(text(kept)).toContain(
      t('operations.crewPlan.swap.summary', {
        moved: formatNumber(0, 'ar'),
        kept: formatNumber(1, 'ar'),
      }),
    );
    // Settled, the rose flash is gone; the notice stays to be read.
    const settled = render({
      away: { c1: 'absent' },
      initial: {
        bKey: V213.key,
        ...pressed([['aToB', { a: [personItem('c1')], b: [] }]], {
          rules: rules({ c1: 'absent' }),
          held: false,
        }),
      },
    });
    expect(settled).not.toContain('data-swap-kept=');
    expect(settled).toContain('data-swap-notice="true"');
  });

  // Round 34 D — REWRITTEN: «one way: the receiving card says so and its boxes are not read». No way
  // is chosen, so no card is «the receiving one» at rest; while a press plays, the card(s) it sends
  // to say «تستقبل», framed in the arrow's hue.
  it('while an arrow plays, the card(s) it sends to say «تستقبل», framed in its hue; at rest neither', () => {
    expect(html).not.toContain('data-swap-receiving');
    const oneWay = render({
      initial: { bKey: V213.key, ...pressed([['aToB', { a: [personItem('s1')], b: [] }]]) },
    });
    const on213 = card(oneWay, 'data-swap-card="b"');
    expect(oneWay).toMatch(
      /data-swap-card="b"[^>]*data-swap-receiving="true"[^>]*class="[^"]*ring-sky-500/,
    );
    expect(card(oneWay, 'data-swap-card="a"')).not.toContain('data-swap-receiving-tag');
    expect(text(on213)).toContain(t('operations.crewPlan.swap.receiving'));
    const both = render({
      initial: { bKey: V213.key, ...pressed([['swap', { a: [personItem('s1')], b: [] }]]) },
    });
    expect(both).toMatch(
      /data-swap-card="a"[^>]*data-swap-receiving="true"[^>]*class="[^"]*ring-orange-500/,
    );
    expect(both).toMatch(
      /data-swap-card="b"[^>]*data-swap-receiving="true"[^>]*class="[^"]*ring-orange-500/,
    );
  });

  // Round 34 D — REWRITTEN: it read «After applying — preview»; there is no preview.
  it('English: the same window in its own words', () => {
    const en = render({
      locale: 'en',
      away: { c1: 'absent' },
      initial: {
        bKey: V213.key,
        ...pressed([['aToB', { a: [personItem('c1'), personItem('s1')], b: [] }]], {
          rules: rules({ c1: 'absent' }),
        }),
      },
    });
    expect(text(en)).toContain('Swap between two vehicles');
    expect(text(en)).toContain('from 150');
    expect(text(en)).toContain(`${NAMES.c1} was not moved — absent on this day`);
    // Round 34 D critic — REWRITTEN (title kept): the separator is a dash.
    expect(text(en)).toContain('Moved: 1 — Kept back: 1');
    expect(text(en)).toContain('Undo last move');
    expect(text(en)).not.toContain('After applying');
    expect(text(en)).not.toMatch(/operations\.crewPlan/);
  });
});

describe('Round 32 critic — the window', () => {
  // Round 34 D — REWRITTEN: «in «تبديل المحدد ⇄» a field ticked on one card shows ticked on both —
  // the pair’s exchange, named so». Each card's ticks are its own now; the swap arrow still makes a
  // field ONE exchange (ticked on either card, both values cross — `planSwap`), a one-way arrow
  // moves it.
  it('a field ticked on one card is that card’s own tick — the swap exchanges the pair, nothing thrown away', () => {
    const ticked = render({
      initial: { bKey: V213.key, picks: { a: [fieldItem('direction')], b: [] } },
    });
    expect(card(ticked, 'data-swap-card="a"')).toMatch(
      /data-swap-item="field:direction" data-swap-ticked="true"/,
    );
    expect(card(ticked, 'data-swap-card="b"')).not.toContain('data-swap-ticked');
    const swapped = render({
      initial: {
        bKey: V213.key,
        ...pressed([['swap', { a: [fieldItem('direction')], b: [] }]], { held: false }),
      },
    });
    expect(card(swapped, 'data-swap-card="a"')).toContain('data-swap-arrived="field:direction"');
    expect(text(card(swapped, 'data-swap-card="a"'))).toContain('حلوان');
    expect(card(swapped, 'data-swap-card="b"')).toContain('data-swap-arrived="field:direction"');
    expect(text(card(swapped, 'data-swap-card="b"'))).toContain('المعادي');
    expect(swapped).not.toContain('data-swap-replaced');
  });

  // Round 34 D — REWRITTEN: the reasons were the preview's; the notice under the arrows says them.
  it('an archived type in an exchange: both rows keep theirs, each named why', () => {
    const archivedRules = { ...rules(), typeMayGo: (id: string) => id !== 't-daily' };
    const archived = render({
      rules: archivedRules,
      initial: {
        bKey: V213.key,
        ...pressed([['swap', { a: [fieldItem('shiftTypeId')], b: [] }]], {
          rules: archivedRules,
        }),
      },
    });
    expect(card(archived, 'data-swap-card="a"')).toContain('data-swap-kept="field:shiftTypeId"');
    expect(card(archived, 'data-swap-card="b"')).toContain('data-swap-kept="field:shiftTypeId"');
    expect(text(card(archived, 'data-swap-card="a"'))).toContain('يومي');
    expect(text(card(archived, 'data-swap-card="b"'))).toContain('احتياطي');
    const notice = text(archived.slice(archived.indexOf('data-swap-notice="true"')));
    expect(notice).toContain(t('operations.crewPlan.swap.reason.archivedType'));
    expect(notice).toContain(t('operations.crewPlan.swap.reason.archivedPair', { row: '150' }));
    expect(archived).not.toContain('data-swap-replaced');
    // Round 34 D critic — REWRITTEN (title kept): off by `aria-disabled`, saying why.
    applyOff(archived, '0', t('operations.crewPlan.swap.nothingChanged'));
  });

  // Round 34 D — REWRITTEN: the note was on the preview's card; it is on the working card now, once
  // the move has changed the row's captains or its direction.
  it('says how many محصنات ride a row — and that they stay once its captain or its direction has left', () => {
    const holding = { ...V150, shipments: 6 };
    const opened = render({
      rows: [holding, V213, LOOSE],
      initial: { bKey: V213.key, picks: { a: [personItem('c1')], b: [] } },
    });
    expect(text(card(opened, 'data-swap-card="a"'))).toContain(
      t('operations.crewPlan.swap.shipments', { count: formatNumber(6, 'ar') }),
    );
    expect(card(opened, 'data-swap-card="b"')).not.toContain('data-swap-shipments');
    // Not yet moved: nothing to say.
    expect(opened).not.toContain('data-swap-shipments-stay');
    const moved = render({
      rows: [holding, V213, LOOSE],
      initial: {
        bKey: V213.key,
        ...pressed([['aToB', { a: [personItem('c1')], b: [] }]], {
          rows: { a: holding, b: V213 },
        }),
      },
    });
    const on150 = card(moved, 'data-swap-card="a"');
    expect(on150).toContain('data-swap-shipments-stay="a"');
    expect(text(on150)).toContain(
      t('operations.crewPlan.swap.shipmentsStay', { row: '150', count: formatNumber(6, 'ar') }),
    );
    // Only a specialist leaving: nothing to say.
    const quiet = render({
      rows: [holding, V213, LOOSE],
      initial: {
        bKey: V213.key,
        ...pressed([['aToB', { a: [personItem('s1')], b: [] }]], {
          rows: { a: holding, b: V213 },
        }),
      },
    });
    expect(quiet).not.toContain('data-swap-shipments-stay');
  });

  // Round 34 D — REWRITTEN title: «… on the preview — …» (there is none; the cards are the rule's).
  it('the notes start their own line on the cards — never under the label column', () => {
    const html = render({
      initial: { bKey: V213.key, picks: { a: [fieldItem('direction')], b: [] } },
    });
    const notesLabels = [...html.matchAll(/<span class="([^"]*)">ملاحظات<\/span>/g)].map(
      (match) => match[1] ?? '',
    );
    expect(notesLabels.length).toBeGreaterThan(1);
    for (const classes of notesLabels) expect(classes).toContain('sm:col-start-1');
  });

  // Round 34 critic → Round 34 D — REWRITTEN: «the arrow keys read the language: the window’s ways
  // step as its locale reads». No way is chosen: the keys move the FOCUS along the toolbar, read in
  // the window's language.
  it('the arrow keys read the language: the window’s arrows move the focus as its locale reads', () => {
    for (const [locale, rtl] of [
      ['ar', true],
      ['en', false],
    ] as const) {
      const html = render({ locale, initial: { bKey: V213.key, picks: { a: [], b: [] } } });
      expect(html).toContain(`data-swap-points="${swapArrowAim('aToB', rtl).wide.join(' ')}"`);
      const moved: [SwapMode, string][] = [];
      const arrows = SwapArrows({
        rtl,
        label: 'g',
        nameOf: (one) => one,
        whyOf: () => null,
        held: null,
        focusWay: 'swap',
        onFocusWay: (one, by) => moved.push([one, by]),
        onPress: () => undefined,
      });
      (arrows.props as { onKeyDown: (e: unknown) => void }).onKeyDown({
        key: 'ArrowLeft',
        preventDefault: () => undefined,
      });
      // ← is the next arrow in Arabic (the row runs right to left), the one before in English.
      expect(moved, locale).toEqual([[rtl ? 'bToA' : 'aToB', 'key']]);
    }
  });
});

// Round 34 A — «السواب عايز يكون أسهم اللي أنا ببدل ما بينهم وبين عربيتين، اللي هو السهم الشمال أو
// السهم اليمين أو السهمين اللي تحت بعض، يكون السهمين اليمين والشمال نفس اللون والسهم اللي في النص
// لون مختلف».
describe('Round 34 A — the three ways are ARROWS between the two cards', () => {
  const picks: SwapPicks = { a: [personItem('c1')], b: [personItem('c2')] };
  const ar = render({ initial: { bKey: V213.key, picks } });
  const en = render({ locale: 'en', initial: { bKey: V213.key, picks } });
  /** One way's button, whole. */
  const button = (html: string, mode: SwapMode): string => {
    const at = html.indexOf(`data-swap-mode="${mode}"`);
    expect(at).toBeGreaterThan(-1);
    const start = html.lastIndexOf('<button', at);
    return html.slice(start, html.indexOf('</button>', at) + '</button>'.length);
  };
  const attr = (markup: string, name: string): string =>
    (markup.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
  const MODES: readonly SwapMode[] = ['aToB', 'swap', 'bToA'];

  it('each way is an arrow — an svg, no word on the button', () => {
    for (const html of [ar, en]) {
      for (const mode of MODES) {
        const one = button(html, mode);
        expect(one.match(/<svg/g), mode).toHaveLength(1);
        expect(one).toContain(`data-swap-arrow="${mode === 'swap' ? 'swap' : 'oneWay'}"`);
        // Nothing to read on it: the old word labels and their short lines are gone.
        expect(text(one), mode).toBe('');
      }
    }
    expect(ar).not.toContain('نقل المحدد ←');
    expect(ar).not.toContain('تبديل المحدد ⇄');
    expect(en).not.toContain('Move selected →');
  });

  it('each arrow’s name and tooltip say what it does, with both vans — in Arabic and in English', () => {
    const names: Record<Locale, Record<SwapMode, string>> = {
      ar: {
        aToB: 'نقل المحدد من 150 إلى 213',
        swap: 'تبديل المحدد بين 150 و213 في الاتجاهين',
        bToA: 'نقل المحدد من 213 إلى 150',
      },
      en: {
        aToB: 'Move selected from 150 to 213',
        swap: 'Swap selected between 150 and 213, both ways',
        bToA: 'Move selected from 213 to 150',
      },
    };
    for (const [locale, html] of [
      ['ar', ar],
      ['en', en],
    ] as const) {
      for (const mode of MODES) {
        const one = button(html, mode);
        expect(attr(one, 'aria-label'), `${locale} ${mode}`).toBe(names[locale][mode]);
        expect(attr(one, 'title'), `${locale} ${mode}`).toBe(names[locale][mode]);
      }
      // The group keeps its own name.
      expect(html).toContain(
        `aria-label="${translate(locale, 'operations.crewPlan.swap.mode.group')}"`,
      );
    }
  });

  // Round 34 D — REWRITTEN: «the two one-way arrows share ONE hue (sky), the swap another (the
  // brand’s) — off and on». The owner: «السهم اللي فوق رصاصي والسهم اللي تحت رصاصي واللي في النص
  // بنفسجي … البنفسجي ده هو اللون الأشمل للويب سايت. أنا عايز تكون ألوان مختلفة». The swap is orange
  // now, nothing is «on»: at rest each arrow in its hue, under the pointer / the focus and while held
  // solid in it with a white glyph — and none of it the brand's or grey.
  it('the two one-way arrows share ONE hue (sky), the swap another (orange) — at rest, under the pointer and held; never the brand’s, never grey', () => {
    const HUES =
      /\b(sky|orange|brand|indigo|violet|purple|emerald|rose|amber|slate|gray|zinc|neutral|cyan)-\d{2,3}\b/g;
    const huesOf = (classes: string): string[] => [
      ...new Set((classes.match(HUES) ?? []).map((one) => one.split('-')[0] ?? '')),
    ];
    for (const html of [ar, en]) {
      for (const one of MODES) {
        const classes = attr(button(html, one), 'class');
        // Its own hue only — the focus outline aside (a neutral slate / white, outside the ring).
        const own = huesOf(classes.replace(/\S*outline-slate-900\S*/g, ''));
        expect(own, one).toEqual([one === 'swap' ? 'orange' : 'sky']);
        const hue = one === 'swap' ? 'orange' : 'sky';
        // At rest: a tinted fill, a coloured border and glyph — dark and light.
        for (const rest of [
          `bg-${hue}-50`,
          `border-${hue}-500`,
          `text-${hue}-700`,
          `dark:bg-${hue}-400/15`,
          `dark:text-${hue}-300`,
        ]) {
          expect(classes, `${one} rest`).toContain(rest);
        }
        // Under the pointer and the keyboard's focus: solid in its hue, the glyph white.
        for (const active of [
          `hover:bg-${hue}-600`,
          `hover:text-white`,
          `focus-visible:bg-${hue}-600`,
          `focus-visible:text-white`,
          `dark:hover:bg-${hue}-600`,
          `dark:focus-visible:bg-${hue}-600`,
        ]) {
          expect(classes, `${one} active`).toContain(active);
        }
        expect(classes, one).not.toContain('bg-white');
      }
      // The two one-way arrows wear the very same classes; the swap others.
      expect(attr(button(html, 'aToB'), 'class')).toBe(attr(button(html, 'bToA'), 'class'));
      expect(attr(button(html, 'swap'), 'class')).not.toBe(attr(button(html, 'aToB'), 'class'));
    }
    // Held — just pressed: solid in its hue, the glyph white, a ring in the hue.
    for (const one of MODES) {
      const hue = one === 'swap' ? 'orange' : 'sky';
      const held = swapArrowClasses(one, { held: true, disabled: true });
      for (const on of [
        `bg-${hue}-600`,
        'text-white',
        `ring-${hue}-500/60`,
        `dark:bg-${hue}-600`,
      ]) {
        expect(held, `${one} held`).toContain(on);
      }
      expect(held).not.toContain(`bg-${hue}-50 `);
      expect(huesOf(held.replace(/\S*outline-slate-900\S*/g, ''))).toEqual([hue]);
      // Off (cannot act): still its hue, whole — never greyed. Round 34 D critic — REWRITTEN: it was
      // softened to 60% («opacity-60», 2.6:1 and 2.5:1 at opening), the look the window shows most;
      // now the rest glyph on no tint. Round 34 H critic — REWRITTEN (title kept): under the pointer
      // it took a soft tint of its own (`hover:bg-…-100`, dark `…-400/15`) — the very fill of an
      // arrow that acts, at rest; now it has no `hover:` at all (the next describe reads the look).
      const off = swapArrowClasses(one, { held: false, disabled: true });
      for (const look of [
        `text-${hue}-700`,
        'bg-white',
        `border-${hue}-300`,
        `dark:text-${hue}-300`,
        'dark:bg-transparent',
        'cursor-not-allowed',
      ]) {
        expect(off, `${one} off`).toContain(look);
      }
      expect(off).not.toMatch(/opacity-/);
      expect(off.split(/\s+/u).filter((c) => c.includes('hover:'))).toEqual([]);
      expect(huesOf(off.replace(/\S*outline-slate-900\S*/g, ''))).toEqual([hue]);
    }
    expect(SWAP_ARROW_LOOK.oneWay).not.toEqual(SWAP_ARROW_LOOK.swap);
    expect(JSON.stringify(SWAP_ARROW_LOOK)).not.toMatch(
      /brand-|indigo-|violet-|purple-|slate-|gray-/,
    );
  });

  // ── Where the arrows point, read off the drawing itself ─────────────────────────────────────
  //
  // Round 34 critic — REWRITTEN, the three cases below. They pinned the turn's Tailwind strings
  // («rotate-90 lg:rotate-180» …) and the dialog's source, so an equivalent refactor broke them,
  // while a real wrong direction in a layout they did not model passed: in English, stacked, the
  // swap read ↓ (↑↓) ↑ — each of its arrows against the one-way arrow beside it. Now: the glyph's
  // own arrowheads (its svg paths), turned by the matrix its classes give in each layout (Tailwind's
  // `rotate(θ) scaleX(s)`), laid out as the window lays the ways out.

  /** A unit-ish vector as a way on the screen (y grows downward). */
  const wayOf = ([x, y]: readonly [number, number]): ArrowWay =>
    Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up';
  type Layout = 'wide' | 'stacked';
  const LAYOUTS: readonly Layout[] = ['wide', 'stacked'];
  /** The turn the classes give in a layout: below lg the bare ones, from lg those overridden by `lg:`. */
  const matrixOf = (classes: string, layout: Layout): { deg: number; sx: number } => {
    let deg = 0;
    let sx = 1;
    const read = (name: string): void => {
      const rot = /^(-?)rotate-(\d+)$/.exec(name);
      if (rot) deg = (rot[1] === '-' ? -1 : 1) * Number(rot[2]);
      const scale = /^(-?)scale-x-(\d+)$/.exec(name);
      if (scale) sx = ((scale[1] === '-' ? -1 : 1) * Number(scale[2])) / 100;
    };
    const all = classes.split(/\s+/);
    for (const name of all.filter((one) => !one.includes(':'))) read(name);
    if (layout === 'wide') {
      for (const name of all.filter((one) => one.startsWith('lg:'))) read(name.slice(3));
    }
    return { deg, sx };
  };
  /** `rotate(θ) scaleX(s)` on a point: the mirror first, then the turn (clockwise on screen). */
  const turn = (
    [x, y]: readonly [number, number],
    { deg, sx }: { deg: number; sx: number },
  ): [number, number] => {
    const r = (deg * Math.PI) / 180;
    const mx = x * sx;
    return [mx * Math.cos(r) - y * Math.sin(r), mx * Math.sin(r) + y * Math.cos(r)];
  };
  /** The arrowheads a glyph draws — each «M x y l dx1 dy1 dx2 dy2» chevron: its tip, and its way. */
  const headsOf = (svg: string): { at: [number, number]; way: [number, number] }[] =>
    [...svg.matchAll(/d="M(-?\d+) (-?\d+)l([^"]+)"/g)].map((m) => {
      const [x, y] = [Number(m[1]), Number(m[2])];
      const [dx1, dy1, dx2, dy2] = (m[3]?.match(/-?\d+/g) ?? []).map(Number) as [
        number,
        number,
        number,
        number,
      ];
      const tip: [number, number] = [x + dx1 - 12, y + dy1 - 12];
      const mid: [number, number] = [x + (dx1 + dx2) / 2 - 12, y + (dy1 + dy2) / 2 - 12];
      return { at: tip, way: [tip[0] - mid[0], tip[1] - mid[1]] };
    });
  /** Where a way's arrows point on screen, in a layout: the swap's two top first (wide), left first (stacked). */
  const drawn = (html: string, mode: SwapMode, layout: Layout): ArrowWay[] => {
    const one = button(html, mode);
    const glyph = one.slice(one.indexOf('data-swap-arrow'));
    const m = matrixOf(attr(glyph, 'class'), layout);
    return headsOf(glyph)
      .map((head) => ({ at: turn(head.at, m), way: wayOf(turn(head.way, m)) }))
      .sort((p, q) => (layout === 'wide' ? p.at[1] - q.at[1] : p.at[0] - q.at[0]))
      .map((head) => head.way);
  };
  /** The ways as the eye meets them: wide, a column top to bottom; stacked, a row in the reading direction. */
  const onScreen = (html: string, layout: Layout, rtl: boolean): SwapMode[] => {
    const group = html.slice(html.lastIndexOf('<div', html.indexOf('data-swap-modes')));
    const classes = attr(group, 'class').split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['flex-row', 'lg:flex-col']));
    const order = [...html.matchAll(/data-swap-mode="(\w+)"/g)].map((m) => m[1] as SwapMode);
    return layout === 'stacked' && rtl ? [...order].reverse() : order;
  };
  const LANGS = [
    ['ar', true, ar],
    ['en', false, en],
  ] as const;

  it('the arrows point where they say: the drawing, turned by its classes, against `data-swap-points`', () => {
    for (const [locale, , html] of LANGS) {
      for (const mode of MODES) {
        const one = button(html, mode);
        const glyph = one.slice(one.indexOf('data-swap-arrow'));
        expect(drawn(html, mode, 'wide'), `${locale} ${mode} wide`).toEqual(
          attr(glyph, 'data-swap-points').split(' '),
        );
        expect(drawn(html, mode, 'stacked'), `${locale} ${mode} stacked`).toEqual(
          attr(glyph, 'data-swap-points-stacked').split(' '),
        );
      }
    }
  });

  it('each one-way arrow points from the sending card to the receiving one, in every layout and language', () => {
    for (const [locale, rtl, html] of LANGS) {
      // Side by side the first card is on the start side — the right in Arabic; stacked, on top.
      const toB: Record<Layout, ArrowWay> = { wide: rtl ? 'left' : 'right', stacked: 'down' };
      const toA: Record<Layout, ArrowWay> = { wide: rtl ? 'right' : 'left', stacked: 'up' };
      for (const layout of LAYOUTS) {
        expect(drawn(html, 'aToB', layout), `${locale} ${layout}`).toEqual([toB[layout]]);
        expect(drawn(html, 'bToA', layout), `${locale} ${layout}`).toEqual([toA[layout]]);
      }
    }
  });

  it('the swap’s two arrows each point as the one-way arrow beside them — ⇄ in the column, ↑ ⇅ ↓ / ↓ ⇅ ↑ in the row', () => {
    for (const [locale, rtl, html] of LANGS) {
      for (const layout of LAYOUTS) {
        const [first, middle, last] = onScreen(html, layout, rtl) as [SwapMode, SwapMode, SwapMode];
        expect(middle).toBe('swap');
        const ways = drawn(html, 'swap', layout);
        expect(ways, `${locale} ${layout}`).toEqual([
          ...drawn(html, first, layout),
          ...drawn(html, last, layout),
        ]);
      }
    }
    // As the owner reads them on a phone: in Arabic ↑ ⇅ ↓ (the row right to left), in English ↓ ⇅ ↑.
    const row = (html: string, rtl: boolean): string =>
      onScreen(html, 'stacked', rtl)
        .flatMap((mode) => drawn(html, mode, 'stacked'))
        .join(' ');
    expect(row(ar, true)).toBe('up up down down');
    expect(row(en, false)).toBe('down down up up');
  });

  it('the words and the drawing agree for every way, language and layout — and the two hues', () => {
    for (const rtl of [true, false]) {
      for (const mode of MODES) {
        const aim = swapArrowAim(mode, rtl);
        for (const layout of LAYOUTS) {
          const m = matrixOf(swapArrowTurn(mode, rtl), layout);
          // The drawing: one → , or the swap's → above ← .
          const heads: { at: [number, number]; way: [number, number] }[] =
            mode === 'swap'
              ? [
                  { at: [7, -4], way: [1, 0] },
                  { at: [-7, 4], way: [-1, 0] },
                ]
              : [{ at: [7, 0], way: [1, 0] }];
          const ways = heads
            .map((head) => ({ at: turn(head.at, m), way: wayOf(turn(head.way, m)) }))
            .sort((p, q) => (layout === 'wide' ? p.at[1] - q.at[1] : p.at[0] - q.at[0]))
            .map((head) => head.way);
          expect(ways, `${rtl ? 'ar' : 'en'} ${mode} ${layout}`).toEqual([...aim[layout]]);
        }
      }
    }
    expect(swapArrowTone('aToB')).toBe(swapArrowTone('bToA'));
    expect(swapArrowTone('swap')).not.toBe(swapArrowTone('aToB'));
  });

  // Round 34 critic → Round 34 D — REWRITTEN: «the keyboard: one way in the Tab order, and each
  // arrow key moves to the way that lies that way». The arrows are a toolbar of actions: one arrow
  // in the Tab order, the arrow keys move the FOCUS (nothing is chosen), Enter and Space press the
  // focused one — a real button.
  it('the keyboard: a toolbar — one arrow in the Tab order, each arrow key moves the focus to the arrow that lies that way, a press is the button’s own', () => {
    for (const html of [ar, en]) {
      expect(attr(button(html, 'swap'), 'tabindex')).toBe('0');
      expect(attr(button(html, 'aToB'), 'tabindex')).toBe('-1');
      expect(attr(button(html, 'bToA'), 'tabindex')).toBe('-1');
      for (const mode of MODES) expect(attr(button(html, mode), 'type')).toBe('button');
    }
    const key = (rtl: boolean, from: SwapMode, name: string): SwapMode | null => {
      let focused: SwapMode | null = null;
      let prevented = false;
      const arrows = SwapArrows({
        rtl,
        label: 'g',
        nameOf: (one) => one,
        whyOf: () => null,
        held: null,
        focusWay: from,
        onFocusWay: (one, by) => {
          expect(by).toBe('key');
          focused = one;
        },
        onPress: () => {
          throw new Error('a key that moves the focus presses nothing');
        },
      });
      (arrows.props as { onKeyDown: (e: unknown) => void }).onKeyDown({
        key: name,
        preventDefault: () => {
          prevented = true;
        },
      });
      expect(prevented, name).toBe(focused !== null);
      return focused;
    };
    for (const [locale, rtl, html] of LANGS) {
      // The row (a phone): ← and → reach the arrow on that side of the swap.
      const [left, , right] = onScreen(html, 'stacked', rtl);
      expect(key(rtl, 'swap', 'ArrowLeft'), locale).toBe(left);
      expect(key(rtl, 'swap', 'ArrowRight'), locale).toBe(right);
      // The column (a computer): ↓ and ↑ reach the arrow below and above.
      const [above, , below] = onScreen(html, 'wide', rtl);
      expect(key(rtl, 'swap', 'ArrowDown'), locale).toBe(below);
      expect(key(rtl, 'swap', 'ArrowUp'), locale).toBe(above);
      // Round at the ends; Enter, Space and the rest are the button's own.
      expect(key(rtl, 'bToA', 'ArrowDown'), locale).toBe('aToB');
      for (const name of ['Enter', ' ', 'Tab', 'a']) expect(key(rtl, 'swap', name)).toBeNull();
    }
    // A click (Enter and Space click a button) presses that arrow — when it can act — and nothing
    // when it cannot; the focus reaching an arrow by Tab makes it the toolbar's stop.
    const pressedWays: SwapMode[] = [];
    const focusedBy: [SwapMode, string][] = [];
    const arrows = SwapArrows({
      rtl: true,
      label: 'g',
      nameOf: (one) => one,
      whyOf: (one) => (one === 'bToA' ? 'لا شيء' : null),
      held: null,
      focusWay: 'swap',
      onFocusWay: (one, by) => focusedBy.push([one, by]),
      onPress: (one) => pressedWays.push(one),
    });
    const buttons = (
      arrows.props as {
        children: {
          props: { onClick: () => void; onFocus: () => void; 'aria-disabled'?: boolean };
        }[];
      }
    ).children;
    buttons[0]?.props.onClick();
    buttons[2]?.props.onClick();
    buttons[2]?.props.onFocus();
    expect(pressedWays).toEqual(['aToB']);
    expect(buttons[2]?.props['aria-disabled']).toBe(true);
    expect(buttons[0]?.props['aria-disabled']).toBeUndefined();
    expect(focusedBy).toEqual([['bToA', 'focus']]);
  });

  // Round 34 critic → Round 34 D — REWRITTEN: «no second van yet: the arrows are there, the swap
  // marked, none to press — each named without a dash, and why». Nothing is «marked» any more.
  it('no second van yet: the arrows are there, none marked, none to press — each named without a dash, and why', () => {
    const html = render();
    for (const mode of MODES) {
      expect(button(html, mode)).toContain('aria-disabled="true"');
      expect(button(html, mode)).not.toContain('aria-checked');
      expect(button(html, mode)).not.toContain('data-swap-held');
    }
    const pending = t('operations.crewPlan.swap.pickSecondFirst');
    const second = t('operations.crewPlan.swap.secondVan');
    expect(attr(button(html, 'aToB'), 'aria-label')).toBe(
      `نقل المحدد من 150 إلى ${second} — ${pending}`,
    );
    expect(attr(button(html, 'bToA'), 'aria-label')).toBe(
      `نقل المحدد من ${second} إلى 150 — ${pending}`,
    );
    expect(attr(button(html, 'swap'), 'aria-label')).toBe(
      `تبديل المحدد بين 150 و${second} في الاتجاهين — ${pending}`,
    );
    for (const mode of MODES) {
      expect(attr(button(html, mode), 'title')).toBe(attr(button(html, mode), 'aria-label'));
      expect(attr(button(html, mode), 'aria-label')).not.toMatch(/(^| )—$|إلى —/);
    }
    const english = render({ locale: 'en' });
    expect(attr(button(english, 'aToB'), 'aria-label')).toBe(
      'Move selected from 150 to the second vehicle — Choose the second vehicle first',
    );
  });
});

// Round 34 D — «أنا مش عايز كده … أنا يعتبر محدد اللي في النص … ولما أنا أبقى هوفر يبقى يجيلي اللون
// ده، أو لو أنا اخترت شمال أو يمين مثلا يفضل موجود لحد ما الداتا تتنقل ثانية أو ثانيتين ويقوم جاي
// متشال».
describe('Round 34 D — the arrows are ACTIONS; the window works on a copy until «تطبيق»', () => {
  const button = (html: string, mode: SwapMode): string => {
    const at = html.indexOf(`data-swap-mode="${mode}"`);
    expect(at).toBeGreaterThan(-1);
    const start = html.lastIndexOf('<button', at);
    return html.slice(start, html.indexOf('</button>', at) + '</button>'.length);
  };
  const attr = (markup: string, name: string): string =>
    (markup.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');

  it('just pressed: that arrow held — solid in its hue, the glyph nudging toward the receiving card (motion-safe only) — the others off, saying a move is playing', () => {
    const html = render({
      initial: { bKey: V213.key, ...pressed([['aToB', { a: [personItem('s1')], b: [] }]]) },
    });
    const held = button(html, 'aToB');
    expect(held).toContain('data-swap-held="true"');
    expect(attr(held, 'class')).toContain('bg-sky-600');
    expect(attr(held, 'class')).toContain('text-white');
    // The glyph's arrow nudges along itself — `motion-safe:` only, so none under reduced motion.
    expect(held).toContain('data-swap-nudge="0"');
    expect(held).toMatch(/<g[^>]*class="motion-safe:animate-swap-nudge"/);
    expect(held).not.toMatch(/class="animate-swap/);
    const playing = t('operations.crewPlan.swap.why.playing');
    for (const other of ['swap', 'bToA'] as const) {
      expect(button(html, other)).toContain('aria-disabled="true"');
      expect(attr(button(html, other), 'title').endsWith(` — ${playing}`)).toBe(true);
      expect(button(html, other)).not.toContain('data-swap-nudge');
    }
    // The swap's two arrows nudge each its own way.
    const swap = render({
      initial: { bKey: V213.key, ...pressed([['swap', { a: [personItem('s1')], b: [] }]]) },
    });
    expect(button(swap, 'swap')).toMatch(/class="motion-safe:animate-swap-nudge"/);
    expect(button(swap, 'swap')).toMatch(/class="motion-safe:animate-swap-nudge-back"/);
    // What it brought settles in (motion-safe) on the receiving card.
    expect(card(html, 'data-swap-card="b"')).toMatch(
      /data-swap-item="person:s1"[^>]*class="[^"]*motion-safe:animate-swap-arrive/,
    );
    // Settled: back at rest — no hold, no nudge, nothing settling.
    const settled = render({
      initial: {
        bKey: V213.key,
        ...pressed([['aToB', { a: [personItem('s1')], b: [] }]], { held: false }),
      },
    });
    expect(settled).not.toContain('data-swap-held');
    expect(settled).not.toContain('data-swap-nudge');
    expect(settled).not.toContain('animate-swap-arrive');
  });

  // Round 34 D critic — REWRITTEN (title kept): off was «opacity-60», faded; now its colour whole.
  // Round 34 H critic — REWRITTEN again (title kept): no soft tint under the pointer either.
  it('each arrow off with its reason: nothing ticked on the card(s) it sends from', () => {
    const onA = render({ initial: { bKey: V213.key, picks: { a: [personItem('c1')], b: [] } } });
    expect(button(onA, 'aToB')).not.toContain('aria-disabled');
    expect(button(onA, 'swap')).not.toContain('aria-disabled');
    expect(attr(button(onA, 'bToA'), 'title')).toBe(
      `نقل المحدد من 213 إلى 150 — ${t('operations.crewPlan.swap.why.nothingOn', { row: '213' })}`,
    );
    const none = render({ initial: { bKey: V213.key } });
    expect(attr(button(none, 'swap'), 'title')).toBe(
      `تبديل المحدد بين 150 و213 في الاتجاهين — ${t('operations.crewPlan.swap.why.nothingEither')}`,
    );
    expect(attr(button(none, 'aToB'), 'aria-label')).toBe(
      `نقل المحدد من 150 إلى 213 — ${t('operations.crewPlan.swap.why.nothingOn', { row: '150' })}`,
    );
    // Off, still in its own colour — whole, on no tint, and so under the pointer too: nothing of an
    // arrow that acts, neither its tint nor its solid fill.
    expect(attr(button(none, 'aToB'), 'class')).toContain('text-sky-700');
    expect(attr(button(none, 'aToB'), 'class')).not.toMatch(/opacity-/);
    expect(attr(button(none, 'aToB'), 'class')).not.toMatch(/(^|\s)(dark:)?hover:/u);
    expect(attr(button(none, 'swap'), 'class')).not.toMatch(/(^|\s)(dark:)?hover:/u);
  });

  // Round 34 H critic — the orchestrator kept it: «a swap arrow that cannot act stays faint on hover
  // (it does nothing, so it must not look pressable)». Under the pointer it took a tint (light
  // sky-100 / orange-100, stronger than an acting arrow's sky-50 at rest; dark the very 15% tint of
  // one) — it lit up as if it could be pressed. Read as the browser resolves the classes: the
  // pointer on or off, dark or light, the most specific variant wins.
  it('an arrow that cannot act looks the same under the pointer as away from it — both hues, both themes — and never like one that acts', () => {
    const resolve = (
      classes: string,
      prop: 'bg' | 'border' | 'text',
      { hover, dark }: { hover: boolean; dark: boolean },
    ): string | undefined => {
      const list = classes.split(/\s+/u);
      const variants = [
        ...(dark && hover ? ['dark:hover:'] : []),
        ...(dark ? ['dark:'] : []),
        ...(hover ? ['hover:'] : []),
        '',
      ];
      for (const variant of variants) {
        const hit = list
          .filter((c) => c.startsWith(`${variant}${prop}-`))
          .filter((c) => !c.slice(variant.length).includes(':'))
          .at(-1);
        if (hit !== undefined) return hit.slice(variant.length);
      }
      return undefined;
    };
    for (const one of ['aToB', 'swap', 'bToA'] as const) {
      const off = swapArrowClasses(one, { held: false, disabled: true });
      const acting = swapArrowClasses(one, { held: false, disabled: false });
      expect(off, one).toContain('cursor-not-allowed');
      for (const dark of [false, true]) {
        for (const prop of ['bg', 'border', 'text'] as const) {
          const away = resolve(off, prop, { hover: false, dark });
          expect(away, `${one} ${prop} ${dark ? 'dark' : 'light'}`).toBeDefined();
          expect(resolve(off, prop, { hover: true, dark }), `${one} ${prop} hovered`).toBe(away);
        }
        // Its fill is never an acting arrow's — at rest or under the pointer.
        const fill = resolve(off, 'bg', { hover: true, dark });
        expect(fill, `${one} ${dark ? 'dark' : 'light'}`).not.toBe(
          resolve(acting, 'bg', { hover: false, dark }),
        );
        expect(fill).not.toBe(resolve(acting, 'bg', { hover: true, dark }));
        expect(fill).toBe(dark ? 'bg-transparent' : 'bg-white');
      }
    }
  });

  // Round 34 D critic — REWRITTEN (title kept): the footer counts what differs from the opening, not
  // the sum of the presses — there and back is «0», no longer «2» beside «لم يتغيّر شيء بعد»; the
  // time 150 lost is said apart («استُبدل: ١»); and «تطبيق» off by `aria-disabled`.
  it('several moves in a row: the cards show them one on top of the other, «من …» against the opening', () => {
    const html = render({
      initial: {
        bKey: V213.key,
        ...pressed(
          [
            ['aToB', { a: [personItem('s1')], b: [] }],
            ['bToA', { a: [], b: [personItem('c2'), fieldItem('plannedTime')] }],
          ],
          { held: false },
        ),
      },
    });
    const on150 = card(html, 'data-swap-card="a"');
    const on213 = card(html, 'data-swap-card="b"');
    expect(on213).toContain('data-swap-arrived="person:s1"');
    expect(on150).toContain('data-swap-arrived="person:c2"');
    expect(on150).toContain('data-swap-arrived="field:plannedTime"');
    // 150's own time replaced by 213's — named, struck.
    expect(on150).toMatch(/<s[^>]*>07:30<\/s>/);
    expect(html).toContain('data-swap-undo="2"');
    expect(html).toContain('data-swap-apply="3"');
    expect(text(html)).toContain(
      t('operations.crewPlan.swap.summaryReplaced', {
        moved: formatNumber(3, 'ar'),
        replaced: formatNumber(1, 'ar'),
        kept: formatNumber(0, 'ar'),
      }),
    );
    expect(text(html)).toContain('نُقل: ٣ — استُبدل: ١ — بقي: ٠');
    // Moved there and back: home again, no tag — and nothing to apply.
    const back = render({
      initial: {
        bKey: V213.key,
        ...pressed(
          [
            ['aToB', { a: [personItem('s1')], b: [] }],
            ['bToA', { a: [], b: [personItem('s1')] }],
          ],
          { held: false },
        ),
      },
    });
    expect(back).not.toContain('data-swap-arrived');
    applyOff(back, '0', t('operations.crewPlan.swap.nothingChanged'));
    expect(text(back)).toContain(
      t('operations.crewPlan.swap.summary', {
        moved: formatNumber(0, 'ar'),
        kept: formatNumber(0, 'ar'),
      }),
    );
    // No «·» anywhere a figure stands: it read as the Arabic zero «٠».
    expect(text(back)).not.toContain('·');
  });

  // Round 34 D critic — REWRITTEN: «the footer: «تطبيق» hands over the presses (off while nothing
  // changed, saying so); «إلغاء» only closes; «تراجع عن آخر نقل» names the last move, off with none».
  // ✕, Escape and «إلغاء» dropped every move without a word while the cards showed the data moved:
  // with moves that change something they ASK now; the off buttons say why (`aria-disabled`); the
  // undo's spoken name begins with the words it shows.
  it('the footer: «تطبيق» hands over the presses (off while nothing changed, saying so); ✕, Escape and «إلغاء» close with nothing changed and ASK when the moves change something; «تراجع عن آخر نقل» names the last move, off with none', () => {
    const applied: [string, readonly SwapStep[]][] = [];
    let closed = 0;
    const state = pressed([['aToB', { a: [personItem('s1')], b: [] }]], { held: false });
    const html = render({
      initial: { bKey: V213.key, ...state },
      onApply: (bKey, steps) => applied.push([bKey, steps]),
      onClose: () => {
        closed += 1;
      },
    });
    const store = wiring.store as SwapWindow;
    // ✕ and Escape reach the window through the frame's `onClose`; the moves change 150 and 213,
    // so the window asks instead of closing.
    const props = frame.props as {
      onClose: () => void;
      footer: { props: Record<string, unknown> };
    };
    props.onClose();
    expect(closed).toBe(0);
    expect(store.getState().closing).toBe(true);
    // The footer the frame draws is the window's `SwapFooter`, its handlers the window's.
    const footer = props.footer.props as {
      applyWhy: string | null;
      onApply: () => void;
      onCancel: () => void;
      undoName: string;
      steps: number;
      hint: string | null;
    };
    footer.onCancel();
    expect(closed).toBe(0);
    expect(applied).toEqual([]);
    expect(footer.applyWhy).toBeNull();
    footer.onApply();
    expect(applied).toEqual([[V213.key, state.steps]]);
    expect(footer.steps).toBe(1);
    expect(footer.undoName).toBe(
      t('operations.crewPlan.swap.undoLastTitle', {
        what: t('operations.crewPlan.undo.kind.move', { from: '150', to: '213' }),
      }),
    );
    expect(text(html)).toContain(t('operations.crewPlan.swap.undoLast'));
    // While the moves change something, the footer says where they go, and when.
    expect(footer.hint).toBe(t('operations.crewPlan.swap.applyHint'));
    expect(html).toContain('data-swap-apply-hint="true"');
    expect(text(html)).toContain('تنتقل التغييرات إلى اللوحة عند «تطبيق»');
    // The question, in the footer's place: «تطبيق» hands the moves over, «تجاهل التغييرات» closes
    // with nothing handed over, «متابعة التعديل» — and ✕ / Escape on it — go back to the window.
    const asked = render({
      initial: { bKey: V213.key, ...state, closing: true },
      onApply: (bKey, steps) => applied.push([bKey, steps]),
      onClose: () => {
        closed += 1;
      },
    });
    expect(asked).toContain('data-swap-close-ask="true"');
    expect(asked).not.toContain('data-swap-summary');
    expect(text(asked)).toContain(t('operations.crewPlan.swap.closeAsk'));
    const askedStore = wiring.store as SwapWindow;
    const ask = (frame.props as { footer: { props: Record<string, unknown> } }).footer.props as {
      onApply: () => void;
      onDiscard: () => void;
      onStay: () => void;
    };
    ask.onApply();
    expect(applied).toHaveLength(2);
    ask.onDiscard();
    expect(closed).toBe(1);
    (frame.props as { onClose: () => void }).onClose();
    expect(closed).toBe(1);
    expect(askedStore.getState().closing).toBe(false);
    ask.onStay();
    expect(askedStore.getState().closing).toBe(false);
    // Nothing pressed yet: ✕ / Escape and «إلغاء» close at once; «تطبيق» off and says so, the
    // undo off, no line about the board.
    const fresh = render({
      initial: { bKey: V213.key, picks: { a: [personItem('s1')], b: [] } },
      onClose: () => {
        closed += 1;
      },
    });
    const quiet = (frame.props as { footer: { props: Record<string, unknown> } }).footer.props;
    expect(quiet.applyWhy).toBe(t('operations.crewPlan.swap.nothingChanged'));
    expect(quiet.steps).toBe(0);
    expect(quiet.undoName).toBe(t('operations.crewPlan.swap.undoNone'));
    expect(quiet.hint).toBeNull();
    expect(fresh).not.toContain('data-swap-apply-hint');
    (quiet.onCancel as () => void)();
    expect(closed).toBe(2);
    (frame.props as { onClose: () => void }).onClose();
    expect(closed).toBe(3);
    // Moved there and back changes nothing: closing asks nothing.
    render({
      initial: {
        bKey: V213.key,
        ...pressed(
          [
            ['aToB', { a: [personItem('s1')], b: [] }],
            ['bToA', { a: [], b: [personItem('s1')] }],
          ],
          { held: false },
        ),
      },
      onClose: () => {
        closed += 1;
      },
    });
    (frame.props as { onClose: () => void }).onClose();
    expect(closed).toBe(4);
    // The footer's own buttons: each its handler; the undo and «تطبيق» off as said — reachable,
    // named why — and the undo named by the words it shows first (WCAG 2.5.3).
    const calls: string[] = [];
    const footerOf = (steps: number, applyWhy: string | null) =>
      (
        SwapFooter({
          applyLabel: 'apply',
          applyWhy,
          moved: 0,
          onApply: () => calls.push('apply'),
          onCancel: () => calls.push('cancel'),
          undoLabel: 'undo',
          undoName: steps === 0 ? 'none' : 'the move',
          steps,
          onUndo: () => calls.push('undo'),
          summary: 's',
          hint: null,
        }).props as { children: { props: Record<string, unknown> }[] }
      ).children;
    const [save, cancel, undo] = footerOf(0, 'why');
    expect(save?.props.why).toBe('why');
    expect(save?.props.disabled).toBeUndefined();
    expect(undo?.props.disabled).toBeUndefined();
    expect(undo?.props['aria-disabled']).toBe(true);
    expect(undo?.props['aria-label']).toBe('undo — none');
    expect(undo?.props.title).toBe('none');
    (cancel?.props.onClick as () => void)();
    (undo?.props.onClick as () => void)();
    expect(calls).toEqual(['cancel']);
    const [liveSave, , liveUndo] = footerOf(1, null);
    expect(liveSave?.props.why).toBeUndefined();
    expect(liveUndo?.props['aria-disabled']).toBeUndefined();
    expect(liveUndo?.props['aria-label']).toBe('undo — the move');
    (liveUndo?.props.onClick as () => void)();
    expect(calls).toEqual(['cancel', 'undo']);
    // The question's own buttons, each its handler.
    const question = SwapCloseAsk({
      question: 'q',
      applyLabel: 'apply',
      discardLabel: 'discard',
      stayLabel: 'stay',
      onApply: () => calls.push('q-apply'),
      onDiscard: () => calls.push('q-discard'),
      onStay: () => calls.push('q-stay'),
    });
    const [, qApply, qDiscard, qStay] = (
      question.props as { children: { props: Record<string, unknown> }[] }
    ).children;
    (qApply?.props.onClick as () => void)();
    (qDiscard?.props.onClick as () => void)();
    (qStay?.props.onClick as () => void)();
    expect(calls.slice(2)).toEqual(['q-apply', 'q-discard', 'q-stay']);
  });

  // Round 34 D critic — REWRITTEN (title kept): off by `aria-disabled` with its reason in its name and
  // its tooltip, no longer a native `disabled` that hid the reason from the keyboard.
  it('«تغيير» the second van is off while moves stand — «تطبيق» or take them back first', () => {
    const html = render({
      initial: {
        bKey: V213.key,
        ...pressed([['aToB', { a: [personItem('s1')], b: [] }]], { held: false }),
      },
    });
    const change = html.slice(
      html.lastIndexOf('<button', html.indexOf('data-swap-change="true"')),
      html.indexOf('>', html.indexOf('data-swap-change="true"')) + 1,
    );
    expect(change).toContain('aria-disabled="true"');
    expect(change).not.toMatch(/\sdisabled=""/);
    expect(change).toContain(`title="${t('operations.crewPlan.swap.changeLocked')}"`);
    expect(change).toContain(
      `aria-label="${t('operations.crewPlan.swap.changeLabel')} — ${t('operations.crewPlan.swap.changeLocked')}"`,
    );
    const fresh = render({ initial: { bKey: V213.key } });
    expect(fresh).not.toMatch(/data-swap-change="true"[^>]*aria-disabled="true"/);
  });

  // Round 34 D critic — moved there and back with his own slot taken meanwhile, a man came home in
  // the other «أخصائي», unmarked. Now he says so on his line.
  it('home in the other «أخصائي» (his own taken meanwhile): his line says «من أخصائي 1»', () => {
    const A150: PlanRow = {
      ...V150,
      slots: { captain: ['c1'], specialist1: ['s1', 's4'], specialist2: [] },
    };
    const rows = { a: A150, b: V213 };
    const html = render({
      rows: [A150, V213, LOOSE],
      initial: {
        bKey: V213.key,
        ...pressed(
          [
            ['aToB', { a: [personItem('s1')], b: [] }],
            ['bToA', { a: [], b: [personItem('s3')] }],
            ['bToA', { a: [], b: [personItem('s1')] }],
          ],
          { rows, held: false },
        ),
      },
    });
    const on150 = card(html, 'data-swap-card="a"');
    expect(on150).toContain('data-swap-reseated="person:s1"');
    expect(on150).not.toContain('data-swap-arrived="person:s1"');
    expect(text(on150)).toContain(
      t('operations.crewPlan.swap.fromSlot', {
        slot: t('operations.crewPlan.columns.specialist1'),
      }),
    );
    expect(on150).toContain('data-swap-arrived="person:s3"');
    // A change: «تطبيق» on, and counted.
    expect(html).toContain('data-swap-apply="2"');
    expect(html).not.toMatch(/data-swap-apply="2"[^>]*aria-disabled="true"/);
  });

  // Round 34 verifier (D) — on the real stack, a time moved onto another («08:00» onto 61's
  // «09:00»), in the narrow «التوقيت» cell, was drawn OVER its own «من 213» tag: the value's
  // wrapper was `min-w-0 flex-1`, so the box's wrap counted it as no width at all, laid the tag
  // and «بدلًا من 09:00» on the same line, and squeezed it to 11px while its 41px of digits (which
  // never shorten — no ellipsis) spilled across the tag. A time now keeps its width, so what follows
  // it wraps to the next line; a value that shortens with an ellipsis still gives way.
  it('a moved time keeps its width beside «من 213» and «بدلًا من …» — only a value that shortens gives way', () => {
    const html = render({
      initial: {
        bKey: V213.key,
        ...pressed([['aToB', { a: [fieldItem('plannedTime'), fieldItem('direction')], b: [] }]], {
          held: false,
        }),
      },
    });
    const on213 = card(html, 'data-swap-card="b"');
    const item = (field: string): string => {
      const at = on213.indexOf(`data-swap-item="field:${field}"`);
      expect(at).toBeGreaterThan(-1);
      return on213.slice(at, on213.indexOf('</label>', at));
    };
    const time = item('plannedTime');
    expect(time).toContain('data-swap-arrived="field:plannedTime"');
    expect(time).toContain('data-swap-replaced="plannedTime"');
    // The span holding «07:30» sits in a wrapper that never shrinks below it.
    const wrapper = time.match(/<span class="([^"]*)"><span class="[^"]*">07:30<\/span><\/span>/);
    expect(wrapper).not.toBeNull();
    const timeClasses = (wrapper?.[1] ?? '').split(/\s+/);
    expect(timeClasses).toContain('flex-none');
    expect(timeClasses).not.toContain('min-w-0');
    expect(timeClasses).not.toContain('flex-1');
    // The direction shortens with an ellipsis, so it may give way to its tags.
    const direction = item('direction');
    const dirWrapper = direction.match(/<span class="([^"]*)"><span class="[^"]*truncate[^"]*"/);
    expect(dirWrapper).not.toBeNull();
    expect((dirWrapper?.[1] ?? '').split(/\s+/)).toEqual(
      expect.arrayContaining(['min-w-0', 'flex-1']),
    );
  });
});

// Round 34 D critic — no suite ran the window's press and its hold: the specs drew static markup with
// the state handed in, and rebuilt the wiring by hand. The press is the arrows' own handler, the
// move and the hold live in the window's store (`createSwapWindow`), driven here with fake timers.
describe('Round 34 D critic — the window’s press, wired: the arrow held, then at rest', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a press moves at once in the window’s store and holds the arrow; SWAP_HOLD_MS later every arrow can act again', () => {
    render({
      initial: { bKey: V213.key, picks: { a: [personItem('s1')], b: [personItem('c2')] } },
    });
    const store = wiring.store as SwapWindow;
    const arrows = wiring.arrows as { onPress: (mode: SwapMode) => void; held: SwapMode | null };
    const footer = (frame.props as { footer: { props: { onUndo: () => void } } }).footer.props;
    expect(arrows.held).toBeNull();
    arrows.onPress('aToB');
    expect(store.getState().held).toBe('aToB');
    expect(store.getState().steps).toEqual([
      { mode: 'aToB', picks: { a: [personItem('s1')], b: [personItem('c2')] } },
    ]);
    // The receiving card's tick stays: «من 150 إلى 213» never read it.
    expect(store.getState().picks).toEqual({ a: [], b: [personItem('c2')] });
    expect(vi.getTimerCount()).toBe(1);
    // Drawn from that state: the arrow held, the others saying a move is playing.
    const during = render({ initial: { bKey: V213.key, ...store.getState() } });
    expect(during).toMatch(/data-swap-mode="aToB"[^>]*data-swap-held="true"/);
    expect(during).toContain(t('operations.crewPlan.swap.why.playing'));
    vi.advanceTimersByTime(SWAP_HOLD_MS - 1);
    expect(store.getState().held).toBe('aToB');
    vi.advanceTimersByTime(1);
    expect(store.getState().held).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    const after = render({ initial: { bKey: V213.key, ...store.getState() } });
    expect(after).not.toContain('data-swap-held');
    expect(after).not.toContain(t('operations.crewPlan.swap.why.playing'));
    // The footer's undo is the store's: back to the opening, the ticks as they were.
    footer.onUndo();
    expect(store.getState().steps).toEqual([]);
    expect(store.getState().picks).toEqual({ a: [personItem('s1')], b: [personItem('c2')] });
  });

  it('an arrow that cannot act starts nothing; the undo ends a hold still playing', () => {
    render({ initial: { bKey: V213.key } });
    const idle = wiring.store as SwapWindow;
    (wiring.arrows as { onPress: (mode: SwapMode) => void }).onPress('swap');
    expect(idle.getState()).toEqual({ ...SWAP_WINDOW_START });
    expect(vi.getTimerCount()).toBe(0);
    render({ initial: { bKey: V213.key, picks: { a: [personItem('s1')], b: [] } } });
    const store = wiring.store as SwapWindow;
    const footer = (frame.props as { footer: { props: { onUndo: () => void } } }).footer.props;
    (wiring.arrows as { onPress: (mode: SwapMode) => void }).onPress('swap');
    expect(store.getState().held).toBe('swap');
    footer.onUndo();
    expect(store.getState().held).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the board wires it — one operation, never on a record', () => {
  const page = read('../pages/CrewBoardPage.tsx');

  it('the row’s «⇄» only where the board may be planned, and the window only then', () => {
    expect(page).toMatch(
      /const swapPill = \(row: PlanRow\): JSX\.Element \| null =>\s*canPlan \? \(/,
    );
    expect(page).toMatch(/\{swapFrom !== null && canPlan && \(\s*<CrewSwapDialog/);
    // Midnight passing under an open window, or its row gone, shuts it.
    expect(page).toContain(
      'if (swapFrom !== null && (!canPlan || !rows.some((row) => row.key === swapFrom))) {',
    );
  });

  it('the «⇄» sits on the code’s second line (and under «بدون سيارة»), never beside the bin — the table keeps its width', () => {
    expect(page.match(/\{swapPill\(row\)\}/g)).toHaveLength(2);
    const actions = page.slice(page.indexOf('data-row-actions-line="true"'));
    expect(actions.slice(0, actions.indexOf('</span>'))).not.toContain('swapPill');
    // Its own size, not the boards' 28px icon square.
    expect(page).toMatch(/data-cell-control="swap"\s+data-row-swap=\{row\.key\}/);
  });

  // Round 32 critic → Round 34 D — REWRITTEN: ««تطبيق» is ONE step of «تراجع» on the draft —
  // `applySwapToDraft` under the board’s own rules». The window hands over its presses
  // (`onApply(bKey, steps)`), the page replays them on the draft AS IT IS THEN (`applySwapStepsToDraft`
  // — the board's rules judge it again) as ONE operation, called a swap or a move by its ways
  // (`swapStepsOperation`). The lib's spec holds the replay and the one press of «تراجع».
  it('«تطبيق» is ONE step of «تراجع» on the draft — the window’s presses replayed by `applySwapStepsToDraft` under the board’s own rules', () => {
    expect(page).toContain(
      'const swapRows = (bKey: string, steps: readonly SwapStep[]): void => {',
    );
    expect(page).toContain(
      'const what = swapStepsOperation(steps, { a: nameOfRow(aKey), b: nameOfRow(bKey) });',
    );
    expect(page).toContain(
      'apply(what, (draft) => applySwapStepsToDraft(draft, aKey, bKey, steps, swapRules));',
    );
    expect(page).toMatch(/onApply=\{swapRows\}/);
    expect(page).toMatch(/onClose=\{\(\) => setSwapFrom\(null\)\}/);
    expect(page).not.toContain('applySwapToDraft(');
    expect(page).toMatch(
      /what\.kind === 'swap' \? 'operations\.crewPlan\.swap\.done' : 'operations\.crewPlan\.swap\.moved'/,
    );
    expect(page).toContain('awayOf: (employeeId) => awayOf(memberOf(employeeId))');
    expect(t('operations.crewPlan.undo.kind.swap', { a: '150', b: '213' })).toBe(
      'التبديل بين 150 و213',
    );
  });

  it('every word of the window in both languages', () => {
    const catalog = read('../../../platform/localization/i18n.ts');
    const keys = [...new Set(catalog.match(/'operations\.crewPlan\.swap\.[\w.]+'/g) ?? [])];
    expect(keys.length).toBeGreaterThan(40);
    for (const quoted of keys) {
      const key = quoted.slice(1, -1);
      expect(translate('ar', key), key).not.toBe(key);
      expect(translate('en', key), key).not.toBe(key);
      expect(translate('ar', key), key).not.toBe(translate('en', key));
    }
  });
});

// Round 34 C — «ولو انا مثبت لون للنوع ممكن لو تندى صف اشيل لونه عادى»: a row «بدون لون» holds a value of
// «اللون» like any colour — its card offers it, names it «بدون لون» with the neutral swatch, and moves it.
describe('Round 34 C — «بدون لون» in the window’s «لون الصف»', () => {
  const BARE = van('255', {
    slots: { captain: ['c2'], specialist1: [], specialist2: [] },
    shiftTypeId: 't-daily',
    rowColour: 'none',
  });
  const rows = [V150, BARE];

  it('the card offers it as an item, named «بدون لون» with the neutral swatch — never the type’s navy', () => {
    const html = render({ rows, initial: { bKey: BARE.key } });
    const second = card(html, 'data-swap-card="b"');
    expect(second).toContain('data-swap-item="field:rowColour"');
    const at = second.indexOf('data-swap-colour="none"');
    expect(at).toBeGreaterThan(-1);
    const swatch = second.slice(at, second.indexOf('</span>', second.indexOf('</span>', at) + 1));
    expect(swatch).toContain(NO_COLOUR_TONE.dot);
    expect(swatch).not.toContain(SHIFT_TYPE_TONE.navy.dot);
    expect(text(second)).toContain(
      `${t('operations.crewPlan.swap.colour')} ${t('operations.crewPlan.colour.none')}`,
    );
    expect(text(html)).not.toMatch(/operations\.(crewPlan|catalogs)\./);
    // 150's navy is still its own colour, named.
    expect(card(html, 'data-swap-card="a"')).toContain('data-swap-colour="navy"');
  });

  it('a press moves it: 150 becomes «بدون لون», and its navy is named struck where it was replaced', () => {
    const state = pressed([['bToA', { a: [], b: [fieldItem('rowColour')] }]], {
      rows: { a: V150, b: BARE },
      held: false,
    });
    const html = render({ rows, initial: { bKey: BARE.key, ...state } });
    const first = card(html, 'data-swap-card="a"');
    expect(first).toContain('data-swap-colour="none"');
    expect(text(first)).toContain(t('operations.crewPlan.colour.none'));
    expect(first).toContain('data-swap-replaced="rowColour"');
    expect(text(first)).toContain(
      `${t('operations.crewPlan.swap.was')} ${t('operations.catalogs.shiftType.colours.navy')}`,
    );
    // 255 sent its «بدون لون» and is back to «لون النوع»: no colour item left on it.
    expect(card(html, 'data-swap-card="b"')).not.toContain('data-swap-item="field:rowColour"');
  });

  it('English names it too', () => {
    const html = render({ rows, initial: { bKey: BARE.key }, locale: 'en' });
    expect(text(card(html, 'data-swap-card="b"'))).toContain(
      t('operations.crewPlan.colour.none', undefined, 'en'),
    );
  });
});
