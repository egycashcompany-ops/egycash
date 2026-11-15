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
import { type Locale, type OperationsShiftTypeDto } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { translate } from '../../../platform/localization/i18n';
import { CELL_BOX, DirectionPicker, ShiftTypePicker, TimePicker } from './CrewPlanControls';

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
  const box = (value: string): string[] =>
    classOf(
      render(
        <DirectionPicker
          rowKey="r"
          value={value}
          options={['المعادي', 'حلوان']}
          disabled={false}
          onChange={() => undefined}
        />,
      ),
      'role="combobox"',
    );

  it('two areas, as the distribution reads them, are known; legacy free text is kept and marked', () => {
    expect(box('المعادي - حلوان')).not.toContain('[&&]:border-amber-400');
    expect(box('المعادى')).not.toContain('[&&]:border-amber-400');
    expect(box('طريق السويس')).toContain('[&&]:border-amber-400');
  });
});
