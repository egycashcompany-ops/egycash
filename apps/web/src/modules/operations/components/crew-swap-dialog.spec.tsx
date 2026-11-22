// Round 32 C — «تبديل بين سيارتين» on «لوحة التشغيلة»: «انا عاوز بقى اقدر اعمل اسوابنج بين عربيتين
// واقدر احدد هنقل ايه بالظبط للعربيه التانيه … ف ممكن تعملى سامبل كل عربيه بالبيانات على كارد جمب بعض
// الاتنين».
//
// The window as drawn (the suite runs in node with no DOM: the portal made a plain child, the page
// read as source): the two cards side by side with a box on every item, the three ways between them,
// the second van's list, the preview after the change with what arrives, what is replaced and what a
// rule keeps back — in both languages; and the board's wiring: the row's «⇄» only where the board
// may be planned, «تطبيق» one operation of «تراجع».
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import {
  type Locale,
  type MeDto,
  type OperationsCrewMemberDto,
  type OperationsShiftTypeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { translate } from '../../../platform/localization/i18n';
import { formatNumber } from '../../../shared/lib/format';
import { vehiclelessRow, type PlanRow } from '../lib/crew-plan';
import {
  fieldItem,
  personItem,
  type SwapMode,
  type SwapPicks,
  type SwapRules,
} from '../lib/crew-swap';
import { CrewSwapDialog } from './CrewSwapDialog';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
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

const render = (
  options: {
    locale?: Locale;
    initial?: { bKey: string; picks?: SwapPicks; mode?: SwapMode };
    away?: Record<string, 'absent' | 'onLeave'>;
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
        rows={ROWS}
        rowName={(row) =>
          row.vehicleCode ?? translate(locale, 'operations.crewPlan.looseRow', { n: '1' })
        }
        member={member}
        rules={rules(options.away)}
        shiftTypes={TYPES}
        colourName={(colour) =>
          translate(locale, `operations.catalogs.shiftType.colours.${colour}`)
        }
        locale={locale}
        onApply={() => undefined}
        onClose={() => undefined}
        {...(options.initial === undefined ? {} : { initial: options.initial })}
      />
    </Provider>,
  );
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
    expect(first.match(/type="checkbox"/g)).toHaveLength(8);
    expect(first).toContain(
      `aria-label="${t('operations.crewPlan.swap.item', {
        item: `${NAMES.c1} — ${t('operations.crewPlan.columns.captain')}`,
        to: '—',
      })}"`,
    );
    // The drivers stay with the van: said, never ticked.
    expect(text(first)).toContain(t('operations.crewPlan.swap.drivers', { names: 'سعيد السائق' }));
    const chooser = card(html, 'data-swap-chooser="true"');
    expect(chooser).toContain('data-swap-choose="van:v-213"');
    expect(chooser).toContain('data-swap-choose="loose:c-9"');
    expect(text(chooser)).toContain(t('operations.crewPlan.looseRow', { n: '1' }));
    expect(chooser).not.toContain('data-swap-choose="van:v-150"');
  });

  it('nothing to apply and no preview until the second van is picked', () => {
    expect(html).toMatch(/data-swap-apply="0"[^>]*disabled=""|disabled=""[^>]*data-swap-apply="0"/);
    expect(html).not.toContain('data-swap-after');
    expect(text(html)).toContain(t('operations.crewPlan.swap.pickSecondFirst'));
  });

  it('never shows a raw key', () => {
    expect(text(html)).not.toMatch(/operations\.crewPlan/);
  });
});

describe('two cards side by side, the ticks, the ways and the preview AFTER', () => {
  const picks: SwapPicks = {
    a: [personItem('c1'), personItem('s2'), fieldItem('direction'), fieldItem('notes')],
    b: [personItem('c2'), fieldItem('direction'), fieldItem('plannedTime')],
  };
  const html = render({ initial: { bKey: V213.key, picks, mode: 'swap' } });

  it('the first card BEFORE the second in the markup — on the right in Arabic, on the left in English', () => {
    expect(html.indexOf('data-swap-card="a"')).toBeLessThan(html.indexOf('data-swap-modes'));
    expect(html.indexOf('data-swap-modes')).toBeLessThan(html.indexOf('data-swap-card="b"'));
    expect(html.indexOf('data-swap-preview="a"')).toBeLessThan(
      html.indexOf('data-swap-preview="b"'),
    );
  });

  it('the ticked items are checked; each card has «الكل» · «الطاقم فقط» · «لا شيء»', () => {
    const first = card(html, 'data-swap-card="a"');
    expect(first.match(/data-swap-ticked="true"/g)).toHaveLength(4);
    for (const pick of ['all', 'crew', 'none']) {
      expect(html).toContain(`data-swap-quick="a:${pick}"`);
      expect(html).toContain(`data-swap-quick="b:${pick}"`);
    }
    expect(text(first)).toContain(t('operations.crewPlan.swap.quick.crew'));
    expect(card(html, 'data-swap-card="b"').match(/type="checkbox"/g)).toHaveLength(5);
  });

  it('the three ways are a radio group: «نقل المحدد ←» «تبديل المحدد ⇄» «نقل المحدد →», the swap on', () => {
    expect(html).toContain('role="radiogroup"');
    const radios = html.match(/data-swap-mode="(\w+)"/g)?.map((one) => one.split('"')[1]);
    expect(radios).toEqual(['aToB', 'swap', 'bToA']);
    expect(html).toMatch(/aria-checked="true"[^>]*data-swap-mode="swap"/);
    expect(t('operations.crewPlan.swap.mode.aToB')).toBe('نقل المحدد ←');
    expect(t('operations.crewPlan.swap.mode.bToA')).toBe('نقل المحدد →');
    expect(t('operations.crewPlan.swap.mode.swap')).toBe('تبديل المحدد ⇄');
    // English reads left to right: the first van is on the left, so «to the second» points right.
    expect(t('operations.crewPlan.swap.mode.aToB', undefined, 'en')).toBe('Move selected →');
  });

  it('the preview: who arrives «من 213» / «من 150», the value a moved field replaces (struck), what goes', () => {
    const after150 = card(html, 'data-swap-preview="a"');
    const after213 = card(html, 'data-swap-preview="b"');
    // c2 comes to 150 and c1 goes to 213; the directions are exchanged; 213's time moves to 150.
    expect(after150).toContain('data-swap-arrived="person:c2"');
    expect(after150).toContain('data-swap-arrived="field:direction"');
    expect(after150).toContain('data-swap-arrived="field:plannedTime"');
    expect(text(after150)).toContain(t('operations.crewPlan.swap.from', { row: '213' }));
    expect(after213).toContain('data-swap-arrived="person:c1"');
    expect(after213).toContain('data-swap-arrived="person:s2"');
    expect(text(after213)).toContain('المعادي');
    // 150's time 07:30 is replaced by 213's 09:00 — struck in the preview.
    expect(after150).toContain('data-swap-replaced="plannedTime"');
    expect(after150).toMatch(/<s[^>]*>07:30<\/s>/);
    // The notes went to 213, which had none: nothing replaced there.
    expect(after213).not.toContain('data-swap-replaced');
    expect(text(after150)).toContain(
      t('operations.crewPlan.swap.left', {
        row: '213',
        items: [
          NAMES.c1,
          NAMES.s2,
          t('operations.crewPlan.columns.direction'),
          t('operations.crewPlan.columns.notes'),
        ].join('، '),
      }),
    );
    // Apply counts what crosses: 3 people + direction both ways + time + notes.
    expect(html).toContain('data-swap-apply="7"');
    expect(text(html)).toContain(
      t('operations.crewPlan.swap.summary', {
        moved: formatNumber(7, 'ar'),
        kept: formatNumber(0, 'ar'),
      }),
    );
  });

  it('a rule keeps an item back — shown on the preview with its reason, counted as staying', () => {
    const kept = render({
      initial: { bKey: V213.key, picks: { a: [personItem('c1')], b: [] }, mode: 'aToB' },
      away: { c1: 'absent' },
    });
    const after150 = card(kept, 'data-swap-preview="a"');
    expect(after150).toContain('data-swap-kept="person:c1"');
    expect(text(after150)).toContain(
      `${t('operations.crewPlan.swap.kept')} — ${t('operations.crewPlan.swap.reason.absent')}`,
    );
    expect(kept).toMatch(/data-swap-apply="0"[^>]*disabled=""|disabled=""[^>]*data-swap-apply="0"/);
    expect(text(kept)).toContain(
      t('operations.crewPlan.swap.summary', {
        moved: formatNumber(0, 'ar'),
        kept: formatNumber(1, 'ar'),
      }),
    );
  });

  it('one way: the receiving card says so and its boxes are not read', () => {
    const oneWay = render({ initial: { bKey: V213.key, picks, mode: 'aToB' } });
    const second = card(oneWay, 'data-swap-card="b"');
    expect(text(second)).toContain(t('operations.crewPlan.swap.receiving'));
    expect(
      second.match(/type="checkbox"[^>]*disabled=""|disabled=""[^>]*type="checkbox"/g),
    ).toHaveLength(5);
    expect(card(oneWay, 'data-swap-preview="b"')).not.toContain('data-swap-leaving');
  });

  it('English: the same window in its own words', () => {
    const en = render({ locale: 'en', initial: { bKey: V213.key, picks, mode: 'swap' } });
    expect(text(en)).toContain('Swap between two vehicles');
    expect(text(en)).toContain('After applying — preview');
    expect(text(en)).toContain('from 213');
    expect(text(en)).not.toMatch(/operations\.crewPlan/);
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

  it('«تطبيق» is ONE step of «تراجع» on the draft — `applySwap` under the board’s own rules', () => {
    expect(page).toMatch(
      /applyRows\(\{ kind: 'swap', vars \}, \(current\) =>\s*applySwap\(current, aKey, bKey, picks, mode, swapRules\),?\s*\)/,
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
