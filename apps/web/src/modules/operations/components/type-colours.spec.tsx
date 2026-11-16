// Round 24b — «ألوان الأنواع» on «لوحة التشغيلة», rendered for real.
//
// THE OWNER: «عاوز pallett الالوان يكون على عدد الالوان يكون نفس عدد النوع وعاوز فوق خالص جمب الطاقم
// الثابت لما ادوس عليها يفتح كارد زى جدول اقدر ادى كل نوع لون من الالوان وعاوز اللون فى الجدول يكون
// متشبع اكتر من كدا», then «تلقائي ويتغيّر يدوي» and «أيوه عادي». Pinned here:
//   · the card — a table, a row per type in the board's order, a column per swatch shown; the type's
//     colour pressed; one off the palette marked; read only without the catalog's grant; the whole
//     palette and a word past twenty types; a phone's bottom sheet with the swatches wrapping;
//   · the row's «اللون» list — exactly the swatches shown, each naming the types that wear it, the
//     row's own colour kept when outside them, «لون النوع»;
//   · the board — the button beside «الطاقم الثابت», the row drawn in its own colour else its type's,
//     deeper than Round 20's wash with a bar at its start, and a colour picked one «تراجع» step while
//     a type recoloured in the card is none.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  OPERATIONS_SHIFT_TYPE_COLOURS,
  type Locale,
  type OperationsShiftTypeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { translate } from '../../../platform/localization/i18n';
import { record, startHistory, undo, sameCrewDraft, type CrewDraft } from '../lib/crew-undo';
import { patchRow, type PlanRow } from '../lib/crew-plan';
import { rowColourChoices, shownPalette } from '../lib/type-colours';
import { RowColourPicker, RowColourSwatches } from './CrewPlanControls';
import { TypeColoursCard } from './TypeColoursCard';
import { ROW_BAR, SHIFT_TYPE_TONE, rowTint } from './shift-type-look';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const ar = (key: string, vars?: Record<string, string>): string => translate('ar', key, vars);
const colourAr = (colour: string): string => ar(`operations.catalogs.shiftType.colours.${colour}`);
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const type = (
  id: string,
  name: string,
  colour: OperationsShiftTypeDto['colour'],
  isActive = true,
): OperationsShiftTypeDto => ({
  id,
  name,
  nameEn: null,
  colour,
  sortOrder: null,
  isActive,
  version: 4,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

/** Four live types — «سفر» shares rose with «يومي»; «محصنة» wears slate, off a palette of four. */
const TYPES = [
  type('t-daily', 'يومي', 'rose'),
  type('t-reserve', 'احتياطي', 'emerald'),
  type('t-travel', 'سفر', 'rose'),
  type('t-secured', 'محصنة', 'slate'),
  type('t-evening', 'مسائي', 'violet', false),
];
const LIVE = TYPES.filter((t) => t.isActive);

const render = (node: JSX.Element, locale: Locale = 'ar'): string => {
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

const card = (
  over: Partial<Parameters<typeof TypeColoursCard>[0]> = {},
  locale: Locale = 'ar',
): string =>
  render(
    <TypeColoursCard
      open
      onClose={() => undefined}
      types={TYPES}
      listed={LIVE}
      canEdit
      sheet={false}
      {...over}
    />,
    locale,
  );

/** The `data-swatch` buttons of one type's row, with whether each is pressed. */
const rowSwatches = (html: string, typeId: string): { colour: string; on: boolean }[] => {
  const start = html.indexOf(`data-type-row="${typeId}"`);
  expect(start, typeId).toBeGreaterThan(-1);
  const next = html.indexOf('data-type-row="', start + 1);
  const slice = html.slice(start, next < 0 ? undefined : next);
  return [...slice.matchAll(/<button[^>]*data-swatch="([a-z]+)"[^>]*aria-pressed="(true|false)"/g)].map(
    (m) => ({ colour: m[1] as string, on: m[2] === 'true' }),
  );
};

describe('«ألوان الأنواع» — a table: a row per type, a column per swatch shown', () => {
  const html = card();

  it('is the board’s dialog, titled, the palette counted in its subtitle', () => {
    expect(html).toContain('data-type-colours="dialog"');
    expect(html).toContain(ar('operations.crewPlan.typeColours.title'));
    expect(html).toContain(ar('operations.crewPlan.typeColours.subtitle', { count: '٤' }));
    expect(html).toContain('data-type-colours-table="true"');
  });

  it('has as many swatch columns as live types — the palette’s first four, in its order', () => {
    const heads = [...html.matchAll(/data-swatch-head="([a-z]+)"/g)].map((m) => m[1]);
    expect(heads).toEqual(OPERATIONS_SHIFT_TYPE_COLOURS.slice(0, 4));
    for (const colour of heads) expect(html).toContain(colourAr(colour as string));
  });

  it('lists the types in the order given (the board’s), each with every swatch, its own pressed', () => {
    const rows = [...html.matchAll(/data-type-row="([^"]+)"/g)].map((m) => m[1]);
    expect(rows).toEqual(LIVE.map((t) => t.id));
    expect(rowSwatches(html, 't-daily')).toEqual([
      { colour: 'rose', on: true },
      { colour: 'emerald', on: false },
      { colour: 'indigo', on: false },
      { colour: 'amber', on: false },
    ]);
    // «أيوه عادي»: «سفر» shares rose — pressed on its own row as on «يومي»'s.
    expect(rowSwatches(html, 't-travel').find((s) => s.on)?.colour).toBe('rose');
  });

  it('names each swatch for the type it would colour, and the types that already wear it', () => {
    expect(html).toContain(
      `aria-label="${ar('operations.crewPlan.typeColours.pick', { type: 'سفر', colour: colourAr('emerald') })}"`,
    );
    expect(html).toContain(
      ar('operations.crewPlan.colour.wornBy', { colour: colourAr('rose'), types: 'يومي، سفر' }),
    );
    expect(html).toContain(ar('operations.crewPlan.colour.unworn', { colour: colourAr('indigo') }));
  });

  it('marks a type whose colour is off the palette shown — no swatch pressed on its row', () => {
    expect(rowSwatches(html, 't-secured').some((s) => s.on)).toBe(false);
    const at = html.indexOf('data-type-row="t-secured"');
    expect(html.indexOf('data-type-outside="true"', at)).toBeGreaterThan(at);
    expect(html.split('data-type-outside="true"')).toHaveLength(2);
    expect(html).toContain(ar('operations.crewPlan.typeColours.outside'));
  });

  it('names an archived type it lists as archived (a row of the day still holds it)', () => {
    const withArchived = card({ listed: [...LIVE, TYPES[4] as OperationsShiftTypeDto] });
    const at = withArchived.indexOf('data-type-row="t-evening"');
    expect(at).toBeGreaterThan(-1);
    expect(withArchived.indexOf(ar('operations.crewPlan.type.archived'), at)).toBeGreaterThan(at);
    // Still four swatches: an archived type is no swatch of the palette.
    expect(rowSwatches(withArchived, 't-evening')).toHaveLength(4);
  });

  it('closes with «إغلاق» — no save button: each press is saved on its own', () => {
    expect(html).toContain(ar('common.close'));
    expect(html).not.toContain(`>${ar('common.save')}<`);
  });
});

describe('without the catalog’s grant the table is read only, and says why', () => {
  it('shows the same table, its swatches aria-disabled, and the reason', () => {
    const html = card({ canEdit: false });
    expect(html).toContain('data-type-colours-read-only="true"');
    expect(html).toContain(ar('operations.crewPlan.typeColours.readOnly'));
    const swatches = [...html.matchAll(/<button[^>]*data-swatch=[^>]*>/g)].map((m) => m[0]);
    expect(swatches).toHaveLength(LIVE.length * 4);
    for (const swatch of swatches) expect(swatch).toContain('aria-disabled="true"');
    expect(card()).not.toContain('aria-disabled="true"');
  });
});

describe('past twenty live types — the whole palette, and a word', () => {
  it('shows all twenty swatches and says that some types share', () => {
    const many = Array.from({ length: 23 }, (_, i) => type(`t${i}`, `نوع ${i}`, 'rose'));
    const html = card({ types: many, listed: many });
    expect([...html.matchAll(/data-swatch-head="([a-z]+)"/g)]).toHaveLength(20);
    expect(html).toContain('data-type-colours-overflow="true"');
    expect(html).toContain(
      ar('operations.crewPlan.typeColours.overflow', { count: '٢٣', max: '٢٠' }),
    );
    expect(card()).not.toContain('data-type-colours-overflow');
  });
});

describe('on a phone — Fleet’s bottom sheet, the swatches wrapping under each type', () => {
  const html = card({ sheet: true });

  it('is the sheet, not the dialog, and holds no table wider than the screen', () => {
    expect(html).toContain('data-sheet="type-colours"');
    expect(html).toContain('data-type-colours="sheet"');
    expect(html).not.toContain('data-type-colours-table');
    expect(html).toContain('flex flex-wrap gap-2.5');
  });

  it('a block per type with its four swatches, big enough for a finger', () => {
    expect(rowSwatches(html, 't-reserve')).toEqual([
      { colour: 'rose', on: false },
      { colour: 'emerald', on: true },
      { colour: 'indigo', on: false },
      { colour: 'amber', on: false },
    ]);
    expect(html).toContain('h-9 w-9');
  });
});

describe('a row’s «اللون» — the shown palette over the type’s colour', () => {
  const wornBy = (colour: string): string[] =>
    LIVE.filter((t) => t.colour === colour).map((t) => t.name);
  const list = (value: PlanRow['rowColour'], typeColour: PlanRow['rowColour']): string =>
    render(
      <RowColourSwatches
        value={value}
        typeColour={typeColour}
        choices={rowColourChoices(shownPalette(LIVE.length), value)}
        wornBy={wornBy}
        onPick={() => undefined}
      />,
    );
  const swatches = (html: string) =>
    [...html.matchAll(/<button[^>]*data-colour="([a-z]+)"[^>]*>/g)].map((m) => ({
      colour: m[1],
      tag: m[0],
    }));

  it('offers exactly the swatches shown, then «لون النوع» — nothing from Round 20’s six', () => {
    const html = list(null, 'rose');
    expect(swatches(html).map((s) => s.colour)).toEqual([
      ...OPERATIONS_SHIFT_TYPE_COLOURS.slice(0, 4),
      'type',
    ]);
    expect(html).toContain(ar('operations.crewPlan.colour.palette', { count: '٤' }));
    for (const legacy of ['yellow', 'green', 'blue', 'red', 'purple']) {
      expect(html).not.toContain(`data-colour="${legacy}"`);
    }
  });

  it('with nothing picked: «لون النوع» pressed, the type’s own swatch dashed, none pressed', () => {
    const html = list(null, 'emerald');
    const all = swatches(html);
    expect(all.find((s) => s.colour === 'type')?.tag).toContain('aria-pressed="true"');
    expect(all.find((s) => s.colour === 'emerald')?.tag).toContain('data-colour-type="true"');
    expect(all.filter((s) => s.tag.includes('aria-pressed="true"'))).toHaveLength(1);
  });

  it('a colour picked: that swatch pressed, «لون النوع» not', () => {
    const all = swatches(list('indigo', 'rose'));
    expect(all.find((s) => s.colour === 'indigo')?.tag).toContain('aria-pressed="true"');
    expect(all.find((s) => s.colour === 'type')?.tag).toContain('aria-pressed="false"');
    expect(all.some((s) => s.tag.includes('data-colour-type'))).toBe(false);
  });

  it('a colour picked when the palette was larger: still offered, at the end, pressed and so named', () => {
    const html = list('navy', 'rose');
    const all = swatches(html);
    expect(all.map((s) => s.colour)).toEqual([
      ...OPERATIONS_SHIFT_TYPE_COLOURS.slice(0, 4),
      'navy',
      'type',
    ]);
    const navy = all.find((s) => s.colour === 'navy')?.tag ?? '';
    expect(navy).toContain('aria-pressed="true"');
    expect(navy).toContain('data-colour-outside="true"');
    expect(html).toContain(ar('operations.crewPlan.colour.outside', { colour: colourAr('navy') }));
  });

  it('each swatch names the types that wear it — two may', () => {
    const html = list(null, null);
    expect(html).toContain(
      ar('operations.crewPlan.colour.wornBy', { colour: colourAr('rose'), types: 'يومي، سفر' }),
    );
    expect(html).toContain(ar('operations.crewPlan.colour.noType'));
  });

  it('the cell’s button shows what the row is drawn in, and where that comes from', () => {
    const button = (value: PlanRow['rowColour'], typeColour: PlanRow['rowColour']): string =>
      render(
        <RowColourPicker
          rowKey="van:v-1"
          value={value}
          typeColour={typeColour}
          choices={rowColourChoices(shownPalette(4), value)}
          wornBy={wornBy}
          disabled={false}
          onChange={() => undefined}
        />,
      );
    const picked = button('indigo', 'rose');
    expect(picked).toContain('data-colour-source="row"');
    expect(picked).toContain('data-colour-shown="indigo"');
    const auto = button(null, 'rose');
    expect(auto).toContain('data-colour-source="type"');
    expect(auto).toContain('data-colour-shown="rose"');
    expect(auto).toContain('outline-dashed');
    expect(auto).toContain(ar('operations.crewPlan.colour.autoOf', { colour: colourAr('rose') }));
    expect(button(null, null)).toContain('data-colour-source="none"');
  });
});

describe('the row drawn in its colour — deeper than Round 20, a bar at its start', () => {
  it('tints every cell with the colour itself at 30% (35% in dark), not a 100-level wash', () => {
    for (const colour of OPERATIONS_SHIFT_TYPE_COLOURS) {
      const tint = SHIFT_TYPE_TONE[colour].row;
      expect(tint, colour).toMatch(/\[&>td\]:!bg-[a-z]+-\d{3}\/(30|35|40)\b/);
      expect(tint, colour).toMatch(/dark:\[&>td\]:!bg-[a-z]+-\d{3}\/(30|35|40)\b/);
      expect(tint, colour).not.toMatch(/-100\b/);
      expect(tint, colour).toMatch(/\[--row-bar:theme\(colors\.[a-z]+\.\d{3}\)\]/);
    }
  });

  it('draws the bar on the START edge — right in Arabic, left in English', () => {
    expect(ROW_BAR).toContain('rtl:[&>td:first-child]:[box-shadow:inset_-5px_0_0_0_var(--row-bar)]');
    expect(ROW_BAR).toContain('ltr:[&>td:first-child]:[box-shadow:inset_5px_0_0_0_var(--row-bar)]');
    expect(rowTint('navy')).toContain(ROW_BAR);
    expect(rowTint('navy')).toContain(SHIFT_TYPE_TONE.navy.row);
  });
});

describe('«تراجع» — a colour picked is ONE step; a type recoloured in the card is none', () => {
  const row: PlanRow = {
    key: 'van:v-150',
    vehicleId: 'v-150',
    vehicleCode: '150',
    onRoster: true,
    crewId: null,
    drivers: [],
    slots: { captain: [], specialist1: [], specialist2: [] },
    direction: null,
    plannedTime: null,
    shiftTypeId: 't-daily',
    rowColour: null,
    notes: null,
  };

  it('records one entry, labelled with the colour, and one press takes it back to the type’s', () => {
    const start = startHistory<CrewDraft>({ rows: [row], standingKeys: null });
    const what = { kind: 'colour', vars: { row: '150', colour: colourAr('navy') } };
    const after = record(
      start,
      { rows: patchRow(start.now.rows, row.key, { rowColour: 'navy' }), standingKeys: null },
      what,
      { same: sameCrewDraft },
    );
    expect(after.past).toHaveLength(1);
    expect(after.now.rows[0]?.rowColour).toBe('navy');
    expect(ar(`operations.crewPlan.undo.kind.${after.past[0]?.what.kind}`, after.past[0]?.what.vars)).toBe(
      'تلوين الصف 150 باللون كحلي',
    );
    expect(undo(after).now.rows[0]?.rowColour).toBeNull();
    expect(ar('operations.crewPlan.undo.kind.colourAuto', { row: '150' })).toBe(
      'إعادة الصف 150 إلى لون نوعه',
    );
  });

  it('the page records a colour through `recolour` and never puts the card on the history', () => {
    const page = read('../pages/CrewBoardPage.tsx');
    expect(page).toMatch(/onChange=\{\(rowColour\) => recolour\(row\.key, rowColour\)\}/);
    expect(page).toMatch(/kind: 'colourAuto'/);
    expect(page).toMatch(/kind: 'colour', vars: \{ row: nameOfRow\(key\), colour: colourName\(rowColour\) \}/);
    const cardSource = read('./TypeColoursCard.tsx');
    expect(cardSource).toContain('useRecolourOperationsShiftType');
    expect(cardSource).not.toMatch(/\b(apply|applyRows|setHistory|record)\(/);
  });
});

describe('the board wires it', () => {
  const page = read('../pages/CrewBoardPage.tsx');

  it('puts «ألوان الأنواع» at the top, right after «الطاقم الثابت», for every reader', () => {
    const standing = page.indexOf('data-standing-toggle="true"');
    const colours = page.indexOf('data-type-colours-open="true"');
    const addRow = page.indexOf('data-add-loose-row="true"');
    expect(standing).toBeGreaterThan(-1);
    expect(colours).toBeGreaterThan(standing);
    expect(colours).toBeLessThan(addRow);
    // Not behind `canPlan`: the card is read only without the catalog's grant, never hidden.
    const between = page.slice(page.lastIndexOf('{canPlan && (', colours), colours);
    expect(between).toContain('data-standing-toggle');
  });

  it('opens the card with the catalog grant the reference tab already uses — no new one', () => {
    expect(page).toContain("const canColourTypes = can('operationsCatalog.manage');");
    expect(page).toContain('canEdit={canColourTypes}');
    expect(page).toContain('listed={strip.chips.map(({ type }) => type)}');
    expect(page).toContain('sheet={phone}');
  });

  it('draws a row in its own colour, else its type’s, and marks which', () => {
    expect(page).toContain('resolveRowColour(row.rowColour, typeColourOf(shiftTypes, row.shiftTypeId))');
    expect(page).toContain("return colour === null ? undefined : rowTint(colour);");
    expect(page).toContain("marks['data-row-colour-source'] = source ?? 'type';");
    expect(page).toContain('choices={rowColourChoices(palette, row.rowColour)}');
  });

  it('keeps the marks on a coloured row visible: a halo under a marked chip, solid refusals', () => {
    expect(page).toContain(
      '[&_tr[data-row-colour]_[data-crew-chip]:is([data-selected],[data-refused],[data-away],[data-wrong-slot])]:shadow-[0_0_0_3px_#fff]',
    );
    expect(read('./CrewPlanChip.tsx')).toContain("refused && 'ring-4 ring-rose-600 dark:ring-rose-400'");
  });
});
