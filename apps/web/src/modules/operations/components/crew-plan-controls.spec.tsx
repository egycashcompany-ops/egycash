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
import {
  directionAddOffer,
  directionItems,
  withDirectionAdd,
  type DirectionAddRefused,
} from '../lib/direction-pick';
import { type DirectionAdd } from '../api/direction-area';
import {
  CELL_BOX,
  REFUSED_BOX,
  DirectionNotes,
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

// Round 28c — «يعرض عليا اضيفه او لا»: beside «استخدام «…» اتجاهًا» (this row only), the list offers
// «إضافة «…» إلى القائمة» — written to «المناطق» at once. The box shows the add pending, and a refusal
// with the name kept.
describe('Round 28c — «إضافة «…» إلى القائمة» in the direction box', () => {
  const AREAS = ['المعادي', 'المعادي الجديدة', 'حلوان'];
  const en = (key: string): string => translate('en', key);
  const list = (
    query: string,
    extra: {
      value?: string | null;
      active?: number;
      archived?: readonly string[] | null;
      refused?: DirectionAddRefused | null;
    } = {},
  ): string => {
    const offer = directionAddOffer(query, AREAS, extra.archived ?? [], extra.refused ?? null);
    // As the box's panel lays it out: the notes ABOVE the listbox, the options in it.
    return render(
      <>
        <DirectionNotes
          archivedId="l-archived"
          refused={extra.refused ?? null}
          archivedArea={offer?.kind === 'archived' ? offer.area : null}
        />
        <ul role="listbox">
          <DirectionOptions
            listId="l"
            items={withDirectionAdd(directionItems(query, AREAS), offer)}
            active={extra.active ?? 0}
            value={extra.value ?? null}
            onHover={() => undefined}
            onPick={() => undefined}
            onAdd={() => undefined}
          />
        </ul>
      </>,
    );
  };
  /** The listbox's own markup — what may sit inside it. */
  const listbox = (html: string): string => html.slice(html.indexOf('<ul role="listbox">'));
  const kinds = (html: string): string[] =>
    [...html.matchAll(/data-direction-option="(\w+)"/g)].map((match) => match[1] as string);

  it('offers BOTH for a name no area holds: «استخدام» first and highlighted, «إضافة» right after, with its hint', () => {
    const html = list('طريق السويس');
    expect(kinds(html)).toEqual(['typed', 'add']);
    expect(html).toContain(
      `>${ar('operations.crewPlan.direction.useTyped').replace('{{text}}', 'طريق السويس')}<`,
    );
    expect(html).toContain(
      `>${ar('operations.crewPlan.direction.addToList').replace('{{text}}', 'طريق السويس')}<`,
    );
    // Enter takes the highlighted row — the row-only one, as Round 28 left it.
    expect(html).toMatch(
      /id="l-option-0"[^>]*data-direction-option="typed"[^>]*data-active="true"/,
    );
    expect(html).toMatch(
      /id="l-option-1" role="option" aria-selected="false" data-direction-option="add"/,
    );
    // The hint says the add is written at once, not at «حفظ», and «تراجع» does not take it back.
    const hint = ar('operations.crewPlan.direction.addHint');
    expect(html).toContain(`data-direction-add-hint="true"`);
    expect(html).toContain(`>${hint}<`);
    for (const word of ['فورًا', '«حفظ»', '«تراجع»', '«المناطق»']) expect(hint).toContain(word);
    // A plus where the typed row has its pen.
    expect(html).toContain('d="M12 5v14"');
  });

  it('the arrows reach the add (Enter then takes it), and «مسح الاتجاه» after it', () => {
    const html = list('طريق السويس', { value: 'حلوان', active: 1 });
    expect(html).toMatch(/id="l-option-1"[^>]*data-direction-option="add"[^>]*data-active="true"/);
    expect(html).toMatch(/id="l-option-2"[^>]*data-direction-option="clear"/);
  });

  it('says the strings in formal Arabic and in English', () => {
    expect(ar('operations.crewPlan.direction.addToList')).toBe('إضافة «{{text}}» إلى القائمة');
    expect(en('operations.crewPlan.direction.addToList')).toBe('Add “{{text}}” to the list');
    for (const key of [
      'addHint',
      'adding',
      'added',
      'addedBody',
      'archived',
      'addRefused.duplicate',
      'addRefused.heldActive',
      'addRefused.heldArchived',
      'addRefused.forbidden',
      'addRefused.invalid',
      'addRefused.failed',
      'addedNotPlaced',
    ]) {
      const full = `operations.crewPlan.direction.${key}`;
      expect(ar(full), full).not.toBe(full);
      expect(en(full), full).not.toBe(full);
    }
    // «تراجع» takes back the row's direction, never the area — the toast after the add says so.
    expect(ar('operations.crewPlan.direction.addedBody')).toContain('«تراجع»');
    expect(ar('operations.crewPlan.direction.addedBody')).toContain('تبقى المنطقة في القائمة');
    // Round 28c critic — a 409 no longer guesses «added meanwhile»: it names the area, and says
    // when it is archived; an add that did not land on its row says the row was not changed.
    expect(ar('operations.crewPlan.direction.addRefused.duplicate')).not.toContain('الأثناء');
    expect(en('operations.crewPlan.direction.addRefused.duplicate')).not.toContain('meanwhile');
    expect(ar('operations.crewPlan.direction.addRefused.heldArchived')).toContain('موقوفة');
    expect(ar('operations.crewPlan.direction.addRefused.heldActive')).toContain('«{{area}}»');
    expect(ar('operations.crewPlan.direction.addedNotPlaced')).toContain('لم يتغيّر اتجاه الصف');
  });

  // Round 28c critic — REWRITTEN: was «no add for a name an area holds» with «المعا» (a piece of
  // «المعادي») — the wider rule that held other places' names back. A name an area IS (folded) has
  // no add; a piece of one is offered after the areas (`direction-pick.spec.ts`).
  it('no add for a name an area IS, for several parts, past the ceiling — or for a desk without the grant', () => {
    expect(kinds(list('المعادى'))).toEqual(['area', 'area']);
    expect(kinds(list('المعا'))).toEqual(['area', 'area', 'typed', 'add']);
    expect(kinds(list('المعادي - طريق السويس'))).toEqual(['typed']);
    expect(kinds(list('ط'.repeat(OPERATIONS_DIRECTION_MAX_LENGTH + 1)))).toEqual([]);
    // No grant (or the lists still read): `archived` is null — the box is given no `add`.
    const html = render(
      <ul>
        <DirectionOptions
          listId="l"
          items={withDirectionAdd(
            directionItems('طريق السويس', AREAS),
            directionAddOffer('طريق السويس', AREAS, null),
          )}
          active={0}
          value={null}
          onHover={() => undefined}
          onPick={() => undefined}
        />
      </ul>,
    );
    expect(kinds(html)).toEqual(['typed']);
    expect(html).not.toContain(ar('operations.crewPlan.direction.addToList').slice(0, 6));
  });

  // Round 28c critic — REWRITTEN: the note was an `li role="presentation"` INSIDE the listbox, never
  // named by the box, so a screen reader walking the options never heard it. It is now a paragraph
  // above the listbox, with an id the box names in `aria-describedby` (pinned on the box below).
  it('an archived area holding the name is said above the listbox, with an id — and no add offered', () => {
    const html = list('الدقى', { archived: ['الدقي'] });
    expect(kinds(html)).toEqual(['typed']);
    expect(html).toContain('<p id="l-archived" data-direction-archived="true"');
    expect(html).toContain(
      ar('operations.crewPlan.direction.archived').replace('{{area}}', 'الدقي'),
    );
    expect(listbox(html)).not.toContain('data-direction-archived');
    expect(listbox(html)).not.toContain('role="presentation"');
  });

  // Round 28c critic — REWRITTEN: was «said above the rows» as an `li role="alert"`, a child a
  // listbox may not have, and said twice with the toast. Now a paragraph above the listbox, no
  // alert of its own (the box's live region speaks it, once), naming the area a 409 names.
  it('a refusal is said above the listbox, the text kept for the row — and the add not offered again', () => {
    for (const reason of ['duplicate', 'forbidden', 'invalid'] as const) {
      const html = list('طريق السويس', { refused: { name: 'طريق السويس', reason } });
      expect(html).toContain(`<p data-direction-add-refused="${reason}"`);
      expect(html).toContain(
        ar(`operations.crewPlan.direction.addRefused.${reason}`).replace('{{text}}', 'طريق السويس'),
      );
      expect(kinds(html), reason).toEqual(['typed']);
      expect(html).not.toContain('role="alert"');
      expect(listbox(html)).not.toContain('data-direction-add-refused');
    }
    const held = list('الدقى', {
      refused: { name: 'الدقى', reason: 'duplicate', held: { area: 'الدقي', archived: true } },
    });
    expect(held).toContain(
      ar('operations.crewPlan.direction.addRefused.heldArchived')
        .replace('{{text}}', 'الدقى')
        .replace('{{area}}', 'الدقي'),
    );
    // A failure that may pass: the add is offered again, beside the row-only choice.
    expect(
      kinds(list('طريق السويس', { refused: { name: 'طريق السويس', reason: 'failed' } })),
    ).toEqual(['typed', 'add']);
  });

  const picker = (add: Partial<DirectionAdd>, value: string | null = 'حلوان'): string =>
    render(
      <DirectionPicker
        rowKey="r"
        value={value}
        options={AREAS}
        disabled={false}
        onChange={() => undefined}
        add={{
          archived: [],
          pending: null,
          refused: null,
          onAdd: () => undefined,
          onSettle: () => undefined,
          ...add,
        }}
      />,
    );

  it('while the add is written the row shows it pending: the name, a spinner, read-only, busy — nothing more taken', () => {
    const html = picker({ pending: 'طريق السويس' });
    const box = classOf(html, 'role="combobox"');
    expect(box).toEqual(expect.arrayContaining(CELL));
    expect(html).toContain('value="طريق السويس"');
    expect(html).toContain('readonly=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-direction-adding="true"');
    expect(html).toContain('data-direction-adding-spinner="true"');
    expect(html).toContain('animate-spin');
    // The chevron gives way to the spinner.
    expect(html).not.toContain('d="m6 9 6 6 6-6"');
    const adding = ar('operations.crewPlan.direction.adding').replace('{{text}}', 'طريق السويس');
    expect(html).toContain(`title="${adding}"`);
    const note = /aria-describedby="([^"]+)"/.exec(html)?.[1] as string;
    expect(html).toContain(`id="${note}" class="sr-only">${adding}<`);
  });

  // Round 28c critic — the «pending» words were in a `role="status"` span made WITH them, which many
  // screen readers do not speak. The box has one live region, always there (empty until the box has
  // the focus — away from it, the page's toast speaks instead).
  it('keeps one live region, always there and empty while the box has no focus', () => {
    for (const html of [
      picker({}),
      picker({ pending: 'طريق السويس' }),
      picker({ refused: { name: 'طريق السويس', reason: 'failed' } }),
    ]) {
      expect(html).toContain(
        'class="sr-only" role="status" aria-live="polite" data-direction-live="r"></span>',
      );
      expect(html.match(/role="status"/g)).toHaveLength(1);
      expect(html).not.toContain('role="alert"');
    }
  });

  // Round 28c critic — REWRITTEN: was «a refused add keeps the name in the box, marked red». Shut, the
  // box showed the refused name in red where the row's direction is — text the row does not hold
  // and «حفظ» does not save, on after «تراجع», a load, another day. Shut, it now shows the row's own
  // direction, a mark at its start and the refusal as its title; the name comes back on opening.
  it('a refused add, the box shut: the row’s own direction, a mark and the refusal said — the name kept for the list', () => {
    const html = picker({
      refused: {
        name: 'طريق السويس',
        reason: 'duplicate',
        held: { area: 'المعادي', archived: false },
      },
    });
    const said = ar('operations.crewPlan.direction.addRefused.heldActive')
      .replace('{{text}}', 'طريق السويس')
      .replace('{{area}}', 'المعادي');
    expect(html).toContain('value="حلوان"');
    expect(html).not.toContain('value="طريق السويس"');
    expect(html).toContain('data-direction-add-refused-mark="true"');
    expect(html).toContain('data-direction-add-refused="duplicate"');
    expect(html).toContain(`title="${said}"`);
    const note = /aria-describedby="([^"]+)"/.exec(html)?.[1] as string;
    expect(html).toContain(`id="${note}" class="sr-only">${said}<`);
    // Not «invalid», not red: the row's direction is fine — red is for the refused name, open.
    expect(html).not.toContain('aria-invalid');
    expect(classOf(html, 'role="combobox"')).not.toEqual(
      expect.arrayContaining(REFUSED_BOX.split(/\s+/)),
    );
    expect(classOf(html, 'role="combobox"')).toContain('ps-7');
    expect(html).not.toContain('readonly');
  });

  it('given no add (no grant), the box is Round 28’s, unchanged', () => {
    const without = render(
      <DirectionPicker
        rowKey="r"
        value="حلوان"
        options={AREAS}
        disabled={false}
        onChange={() => undefined}
      />,
    );
    expect(picker({})).toBe(without);
    expect(without).not.toContain('aria-busy');
    expect(without).not.toContain('data-direction-add');
  });
});
