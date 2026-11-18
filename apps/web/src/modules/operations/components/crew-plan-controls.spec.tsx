// «لوحة التشغيلة» (Round 20) — a row's boxes, rendered for real.
//
// The owner approved the board with two changes, and this pins the second: «شكلها فى الشاشة تكون زى
// الساعة والملاحظات كله تحت بعض مفيش حاجه داخلة وحاجه خارجه». In his picture the type was a tag
// inside a button sized to its word, so the column's boxes were of every width — «احتياطي سفر» stuck
// out past «يومي». The type is now the time's and the notes' box: one look (`CELL_BOX`), filling a
// column of one width, its colour a dot at the start where the time's clock sits. The first change
// — the types come from «أنواع التشغيل» — is pinned here as what the box names and marks.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import {
  OPERATIONS_DIRECTION_MAX_LENGTH,
  type Locale,
  type OperationsShiftTypeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { translate } from '../../../platform/localization/i18n';
import { directionItems } from '../lib/direction-pick';
import {
  CELL_BOX,
  DirectionOptions,
  DirectionPicker,
  ShiftTypePicker,
  TimePicker,
} from './CrewPlanControls';

const ar = (key: string): string => translate('ar', key);

const shiftType = (
  id: string,
  name: string,
  over: Partial<OperationsShiftTypeDto> = {},
): OperationsShiftTypeDto => ({
  id,
  name,
  nameEn: null,
  colour: 'rose',
  sortOrder: null,
  isActive: true,
  version: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const TYPES = [
  shiftType('t-daily', 'يومي', { sortOrder: 0 }),
  shiftType('t-travel-reserve', 'احتياطي سفر', { sortOrder: 1, colour: 'fuchsia' }),
  shiftType('t-aswan', 'أسوان', { sortOrder: 2, colour: 'indigo', isActive: false }),
];

const render = (node: JSX.Element, locale: Locale = 'ar'): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
    },
  });
  return renderToStaticMarkup(<Provider store={store}>{node}</Provider>);
};

const typeBox = (value: string | null, extra: { refused?: string } = {}): string =>
  render(
    <ShiftTypePicker
      rowKey="van:v-1"
      value={value}
      types={TYPES}
      locale="ar"
      disabled={false}
      refused={extra.refused ?? null}
      onChange={() => undefined}
    />,
  );

/** The `class` of the first element carrying `marker`. */
const classOf = (html: string, marker: string): string[] => {
  const at = html.indexOf(marker);
  expect(at, marker).toBeGreaterThan(-1);
  const open = html.lastIndexOf('<', at);
  const tag = html.slice(open, html.indexOf('>', at));
  return (/class="([^"]*)"/.exec(tag)?.[1] ?? '').replaceAll('&amp;', '&').split(/\s+/);
};

const CELL = CELL_BOX.split(/\s+/);

describe('the type box is the time’s and the notes’ box — «كله تحت بعض»', () => {
  it('wears the very look of the time box and the direction box: height, border, corners, padding', () => {
    const type = classOf(typeBox('t-daily'), 'data-cell-box');
    const time = classOf(
      render(<TimePicker rowKey="r" value="08:00" disabled={false} onChange={() => undefined} />),
      'inputMode="numeric"',
    );
    const direction = classOf(
      render(
        <DirectionPicker
          rowKey="r"
          value="المعادي"
          options={['المعادي']}
          disabled={false}
          onChange={() => undefined}
        />,
      ),
      'role="combobox"',
    );
    for (const box of [type, time, direction]) {
      expect(box).toEqual(expect.arrayContaining(CELL));
    }
    // One height and one width rule for all of them: the box fills its column.
    expect(type).toEqual(expect.arrayContaining(['h-8', 'w-full', 'rounded-lg', 'border', 'px-2']));
    // The chevron's room at the end is the direction box's (`pe-6`): the two read alike.
    expect(type).toContain('pe-6');
    expect(direction).toContain('pe-6');
  });

  it('fills its column whatever the name — the page holds every box of the column to one width', () => {
    const html = typeBox('t-travel-reserve');
    expect(html).toContain('data-cell-control="type"');
    expect(html).toContain('data-cell-box="true"');
    // The name is cut to the box, never the box widened to the name.
    expect(classOf(html, '>احتياطي سفر<')).toEqual(expect.arrayContaining(['truncate', 'flex-1']));
    const page = readFileSync(
      fileURLToPath(new URL('../pages/CrewBoardPage.tsx', import.meta.url)),
      'utf8',
    );
    // The boards' table shrinks every cell button to its words; a box is held at its own size,
    // by a rule that outranks that one (two attributes), and the column has ONE width per screen.
    expect(page).toContain(
      "'[&_td_button[data-cell-control][data-cell-box]]:!h-8 [&_td_button[data-cell-control][data-cell-box]]:!w-full'",
    );
    expect(page).toContain('<div className="w-[7.75rem] min-[1750px]:w-[8.5rem]">');
    // The notes are the same box; the colour and the bin stand on the boxes' line, as tall as one.
    expect(page).toMatch(/className=\{cn\(CELL_BOX, 'w-\[4\.5rem\]/);
    expect(page).toContain(
      '<span className="flex h-8 items-center gap-1" data-row-actions-line="true">',
    );
  });

  it('shows the type’s colour as a dot at the box’s start, then its name from the catalog', () => {
    const html = typeBox('t-travel-reserve');
    expect(html).toContain('data-type-dot="fuchsia"');
    expect(classOf(html, 'data-type-dot')).toContain('bg-fuchsia-500');
    expect(html.indexOf('data-type-dot')).toBeLessThan(html.indexOf('>احتياطي سفر<'));
    expect(html).toContain(`aria-label="${ar('operations.crewPlan.columns.type')}: احتياطي سفر"`);
  });

  it('«اختر» keeps the dot’s place, so every name of the column starts at one line', () => {
    const html = typeBox(null);
    expect(html).toContain(`>${ar('operations.crewPlan.type.choose')}<`);
    expect(html).not.toContain('data-type-dot');
    expect(html).toMatch(/h-2 w-2 shrink-0 rounded-full border border-dashed/);
  });
});

describe('the type box names what the catalog says', () => {
  it('a type archived since the row took it: still named, and marked — never «اختر»', () => {
    const html = typeBox('t-aswan');
    expect(html).toContain('>أسوان<');
    expect(html).toContain('data-type-archived="true"');
    expect(classOf(html, 'data-cell-box')).toContain('[&&]:border-amber-400');
    expect(html).toContain(ar('operations.crewPlan.type.archivedHint'));
  });

  it('a refused type is marked red, with the reason as its title', () => {
    const html = typeBox('t-daily', { refused: 'لم يعد هذا النوع مفعّلًا' });
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('title="لم يعد هذا النوع مفعّلًا"');
    expect(classOf(html, 'data-cell-box')).toContain('[&&]:border-rose-500');
  });

  it('an id the catalog has not answered with yet reads «…», not a raw id', () => {
    const html = typeBox('t-not-read-yet');
    expect(html).not.toContain('t-not-read-yet<');
    expect(html).toContain('>…<');
  });
});

describe('the direction box agrees with the server about what is an area', () => {
  const html = (value: string): string =>
    render(
      <DirectionPicker
        rowKey="r"
        value={value}
        options={['المعادي', 'حلوان']}
        disabled={false}
        onChange={() => undefined}
      />,
    );
  const box = (value: string): string[] => classOf(html(value), 'role="combobox"');

  // REWRITTEN in Round 28 — was «two areas, as the distribution reads them, are known; legacy free
  // text is kept and marked». «عاوز الاتجاه اقدر اكتبه بايدى لو مش موجود فى الليست»: a direction typed
  // by hand is a direction, so it no longer wears the amber «kept» look.
  it('Round 28 — a hand-typed direction is shown plainly: no warning look, a quiet title saying what it is', () => {
    for (const value of ['المعادي - حلوان', 'المعادى', 'طريق السويس']) {
      expect(box(value)).not.toContain('[&&]:border-amber-400');
      expect(box(value)).not.toContain('[&&]:text-amber-800');
      expect(box(value)).toEqual(expect.arrayContaining(CELL));
    }
    const typed = html('طريق السويس');
    expect(typed).toContain('data-direction-hand-typed="true"');
    expect(typed).toContain(
      `title="${ar('operations.crewPlan.direction.handTyped').replace('{{direction}}', 'طريق السويس')}"`,
    );
    // The title says what it means for «توزيع المحصنات» — in words, never «unknown».
    expect(ar('operations.crewPlan.direction.handTyped')).toContain('توزيع المحصنات');
    expect(typed).not.toContain('aria-invalid');
  });

  it('two areas, as the distribution reads them, and an area in another spelling are areas — titled by their name', () => {
    for (const value of ['المعادي - حلوان', 'المعادى']) {
      expect(html(value)).not.toContain('data-direction-hand-typed');
      expect(html(value)).toContain(`title="${value}"`);
    }
  });

  // REWRITTEN by the Round 28 critic — was «caps the typing at the save’s ceiling» (`maxLength`).
  // The cap cut a pasted note at 80 without a word, and stopped a direction of many areas — which
  // the save respells however long — from being typed at all. The ceiling is now SAID in the list
  // (`directionTooLong`, pinned below and in `direction-pick.spec.ts`) and held by the save.
  it('cuts nothing typed or pasted: the box has no maxLength — the list says when it is too long', () => {
    expect(html('المعادي')).not.toContain('maxLength');
    expect(html('طريق السويس')).not.toContain('maxLength');
  });

  // Round 28 critic — the cue was the title alone, which never shows on a phone: a hand-typed
  // direction looked exactly like an area, and «توزيع المحصنات» proposed nothing to it without a sign.
  it('marks a hand-typed direction with a pen at its start, and says what it means to a screen reader', () => {
    const typed = html('طريق السويس');
    expect(typed).toContain('data-direction-hand-typed-mark="true"');
    expect(box('طريق السويس')).toContain('ps-7');
    const note = /aria-describedby="([^"]+)"/.exec(typed)?.[1] as string;
    expect(note).toBeTruthy();
    expect(typed).toContain(
      `id="${note}" class="sr-only">${ar('operations.crewPlan.direction.handTyped').replace('{{direction}}', 'طريق السويس')}<`,
    );
    for (const value of ['المعادي', 'المعادي - حلوان', 'المعادى']) {
      expect(html(value)).not.toContain('data-direction-hand-typed-mark');
      expect(html(value)).not.toContain('aria-describedby');
      expect(box(value)).not.toContain('ps-7');
    }
  });
});

describe('the direction list — «استخدام «…» اتجاهًا» (Round 28)', () => {
  const list = (
    query: string,
    value: string | null = null,
    active = 0,
    tooLong: number | null = null,
  ): string =>
    render(
      <ul>
        <DirectionOptions
          listId="l"
          items={directionItems(query, ['المعادي', 'المعادي الجديدة', 'حلوان'])}
          active={active}
          value={value}
          tooLong={tooLong}
          onHover={() => undefined}
          onPick={() => undefined}
        />
      </ul>,
    );
  const kinds = (html: string): string[] =>
    [...html.matchAll(/data-direction-option="(\w+)"/g)].map((match) => match[1] as string);

  it('a name no area holds: the typed text FIRST and alone, in formal Arabic — the dead end is gone', () => {
    const html = list('طريق السويس');
    expect(kinds(html)).toEqual(['typed']);
    expect(html).toContain(
      `>${ar('operations.crewPlan.direction.useTyped').replace('{{text}}', 'طريق السويس')}<`,
    );
    expect(ar('operations.crewPlan.direction.useTyped')).toBe('استخدام «{{text}}» اتجاهًا');
    expect(translate('en', 'operations.crewPlan.direction.useTyped')).toBe(
      'Use “{{text}}” as the direction',
    );
    expect(html).not.toContain('لا يوجد اتجاه بهذا الاسم');
    // It is the highlighted row, so Enter takes it.
    expect(classOf(html, 'data-direction-option="typed"')).toContain('bg-brand-500/10');
  });

  it('a part of some areas’ names: the areas first (the first highlighted), the typed text LAST, set apart', () => {
    const html = list('المعا');
    expect(kinds(html)).toEqual(['area', 'area', 'typed']);
    expect(classOf(html, 'data-active="true"')).toContain('bg-brand-500/10');
    expect(html.indexOf('data-active="true"')).toBeLessThan(html.indexOf('>المعادي<'));
    expect(classOf(html, 'data-direction-option="typed"')).toEqual(
      expect.arrayContaining(['mt-1', 'border-t']),
    );
  });

  it('an area typed in full: that area, and no typed row', () => {
    expect(kinds(list('المعادى'))).toEqual(['area', 'area']);
    expect(list('المعادى')).not.toContain(ar('operations.crewPlan.direction.useTyped').slice(0, 7));
  });

  it('«مسح الاتجاه» stays last while the row has a direction', () => {
    const html = list('', 'طريق السويس');
    expect(html.lastIndexOf(ar('operations.crewPlan.direction.clear'))).toBeGreaterThan(
      html.lastIndexOf('>حلوان<'),
    );
  });

  // Round 28 critic — no row had an id, so the box could name none as active: a screen reader was
  // never told which row Enter takes (often now «استخدام «…» اتجاهًا»), and «مسح الاتجاه» was out of
  // the arrows' reach.
  it('gives every row an id for the box to name; «مسح الاتجاه» is the row after the last item', () => {
    const html = list('طريق', 'طريق', 1);
    expect(html).toContain('id="l-option-0"');
    expect(html).toContain('id="l-option-1"');
    expect(classOf(html, 'data-direction-option="clear"')).toContain('bg-brand-500/10');
    expect(html).toMatch(
      /id="l-option-1"[^>]*data-direction-option="clear"[^>]*data-active="true"/,
    );
    // The typed row equal to the value is the selected one.
    expect(html).toMatch(/id="l-option-0" role="option" aria-selected="true"/);
  });

  it('says a hand-typed direction past the ceiling, in formal Arabic, instead of cutting it', () => {
    const html = list('ط'.repeat(OPERATIONS_DIRECTION_MAX_LENGTH + 5), null, 0, 85);
    expect(html).toContain('data-direction-too-long="true"');
    expect(html).toContain(
      ar('operations.crewPlan.direction.tooLong')
        .replace('{{max}}', '٨٠')
        .replace('{{count}}', '٨٥'),
    );
    expect(html).not.toContain(ar('operations.crewPlan.direction.empty'));
    expect(kinds(html)).toEqual([]);
  });
});
