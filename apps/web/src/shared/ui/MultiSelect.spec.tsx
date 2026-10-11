// The two things a multi-select filter has to get right, and one thing the bar around it must.
//
// A filter you have forgotten you set is worse than no filter, so the count in the trigger and the
// reset affordance are not decoration — they are how a filtered list admits that it is filtered.
// Both are invisible to typecheck and lint, and both fail silently, so they are asserted here.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { type Locale } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import {
  MultiSelect,
  multiSelectKey,
  nextActiveOption,
  optionLabel,
  selectionSummary,
} from './MultiSelect';
import { FilterBar } from './FilterBar';

const render = (node: JSX.Element, locale: Locale = 'en'): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
    },
  });
  return renderToStaticMarkup(<Provider store={store}>{node}</Provider>);
};

const noop = (): void => undefined;
const OPTIONS = [
  { value: 'waiting', label: 'Waiting' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
];

const bar = (locale: Locale, active: boolean): string =>
  render(
    <FilterBar onClear={noop} hasActiveFilters={active}>
      <span />
    </FilterBar>,
    locale,
  );

/** The text of the trigger button, tags stripped — what a reader actually sees on it. */
const trigger = (markup: string): string =>
  markup
    .slice(markup.indexOf('>', markup.indexOf('<button')) + 1, markup.indexOf('<svg'))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const CARS = [
  { value: 'ZZ0104', label: 'ZZ0104 — س ص 104', shortLabel: 'ZZ0104' },
  { value: 'ZZ0105', label: 'ZZ0105 — س ص 105', shortLabel: 'ZZ0105' },
  { value: 'ZZ0106', label: 'ZZ0106 — س ص 106', shortLabel: 'ZZ0106' },
  { value: 'ZZ0107', label: 'ZZ0107 — س ص 107', shortLabel: 'ZZ0107' },
];

/** People, where the VALUE is an opaque id rather than the thing the reader recognises. */
const DRIVERS = [
  { value: '6a9c87ff7ae99d20407ded49', label: 'محمد حاتم البنداري — 0100022', shortLabel: 'محمد حاتم البنداري' },
  { value: '6a9d579fe017f8c85ade413b', label: 'جمال أحمد محمد — 0100031', shortLabel: 'جمال أحمد محمد' },
];

describe('optionLabel — what one chosen value is CALLED', () => {
  it('names a car by its code, which is also its value', () => {
    expect(optionLabel(CARS, 'ZZ0104')).toBe('ZZ0104');
  });

  it('names a person by their NAME, never by the id that identifies them', () => {
    // The defect: chips printed the value, so a filter naming «محمد حاتم البنداري» in its list
    // showed «6a9c87ff7ae99d20407ded49» on the chip that removes him.
    expect(optionLabel(DRIVERS, '6a9c87ff7ae99d20407ded49')).toBe('محمد حاتم البنداري');
    expect(optionLabel(DRIVERS, '6a9c87ff7ae99d20407ded49')).not.toContain('6a9c87ff');
  });

  it('falls back to the value when the options no longer carry it', () => {
    // A server-backed list has moved on; the only honest name left is the value itself.
    expect(optionLabel(DRIVERS, 'gone')).toBe('gone');
  });

  it('is the SAME answer the trigger gives, so chip and trigger cannot disagree', () => {
    const ids = DRIVERS.map((d) => d.value);
    expect(selectionSummary(DRIVERS, ids, 3)).toBe(ids.map((id) => optionLabel(DRIVERS, id)).join(', '));
  });
});

describe('selectionSummary', () => {
  it('names one choice by itself', () => {
    expect(selectionSummary(CARS, ['ZZ0104'], 3)).toBe('ZZ0104');
  });

  it('names every choice up to the limit', () => {
    expect(selectionSummary(CARS, ['ZZ0104', 'ZZ0105'], 3)).toBe('ZZ0104, ZZ0105');
    expect(selectionSummary(CARS, ['ZZ0104', 'ZZ0105', 'ZZ0106'], 3)).toBe(
      'ZZ0104, ZZ0105, ZZ0106',
    );
  });

  it('collapses the tail past the limit, still naming the first of them', () => {
    expect(selectionSummary(CARS, ['ZZ0104', 'ZZ0105', 'ZZ0106', 'ZZ0107'], 3)).toBe(
      'ZZ0104, ZZ0105 +2',
    );
  });

  it('prefers the SHORT form, because a trigger has one row', () => {
    // The list says "ZZ0104 — س ص 104"; the trigger has no space for the plate.
    expect(selectionSummary(CARS, ['ZZ0104'], 3)).not.toContain('س ص');
  });

  it('falls back to the list label when there is no short form', () => {
    // The alarm filter: the VALUE is 'red', which is not what a reader should be shown.
    const levels = [
      { value: 'yellow', label: 'أصفر' },
      { value: 'red', label: 'أحمر' },
    ];
    expect(selectionSummary(levels, ['yellow', 'red'], 3)).toBe('أصفر, أحمر');
  });

  it('still names a choice the options no longer carry', () => {
    // A server-backed list has moved on; the value is the only thing left to say.
    expect(selectionSummary(CARS, ['ZZ9999'], 3)).toBe('ZZ9999');
  });

  it('keeps the order they were CHOSEN in, not the order the options arrive in', () => {
    expect(selectionSummary(CARS, ['ZZ0106', 'ZZ0104'], 3)).toBe('ZZ0106, ZZ0104');
  });
});

describe('MultiSelect — naming the choices (opt-in)', () => {
  it('shows its label while nothing is chosen', () => {
    expect(
      trigger(
        render(
          <MultiSelect
            showSelectedValues
            label="كود السيارة"
            options={CARS}
            value={[]}
            onChange={noop}
          />,
        ),
      ),
    ).toBe('كود السيارة');
  });

  it('shows the VALUES once something is chosen, not a count', () => {
    const markup = render(
      <MultiSelect
        showSelectedValues
        label="كود السيارة"
        options={CARS}
        value={['ZZ0104', 'ZZ0105']}
        onChange={noop}
      />,
    );
    expect(trigger(markup)).toBe('ZZ0104, ZZ0105');
    // The count badge is redundant once the values are named, and must not sit beside them.
    expect(trigger(markup), 'no bare count').not.toMatch(/\b2\b/);
    expect(markup, 'the count badge is gone').not.toContain('rounded-full bg-brand-600');
  });

  it('collapses a long selection rather than stretching the row', () => {
    const markup = render(
      <MultiSelect
        showSelectedValues
        label="كود السيارة"
        options={CARS}
        value={CARS.map((c) => c.value)}
        onChange={noop}
      />,
    );
    expect(trigger(markup)).toBe('ZZ0104, ZZ0105 +2');
    // …and the full text stays reachable on hover, since the box itself is width-capped.
    expect(markup).toContain('truncate');
    expect(markup).toContain('title="ZZ0104, ZZ0105 +2"');
  });

  it('stays identifiable to a screen reader — the label does not leave with the text', () => {
    const markup = render(
      <MultiSelect
        showSelectedValues
        label="كود السيارة"
        options={CARS}
        value={['ZZ0104']}
        onChange={noop}
      />,
    );
    expect(markup).toContain('aria-label="كود السيارة"');
  });

  it('changes NOTHING for a bar that has not opted in', () => {
    // Every existing consumer omits the prop. Same label, same count, same markup as before.
    const before = render(
      <MultiSelect
        label="Status"
        options={OPTIONS}
        value={['waiting', 'accepted']}
        onChange={noop}
      />,
    );
    expect(trigger(before)).toBe('Status 2');
    expect(before).toContain('rounded-full bg-brand-600');
    expect(
      trigger(render(<MultiSelect label="Status" options={OPTIONS} value={[]} onChange={noop} />)),
    ).toBe('Status');
  });
});

describe('MultiSelect', () => {
  it('says how many are selected, so a filtered list never looks unfiltered', () => {
    const markup = render(
      <MultiSelect
        label="Status"
        options={OPTIONS}
        value={['waiting', 'accepted']}
        onChange={noop}
      />,
    );
    expect(markup).toContain('>2<');
  });

  it('shows no count when nothing is selected', () => {
    const markup = render(
      <MultiSelect label="Status" options={OPTIONS} value={[]} onChange={noop} />,
    );
    expect(markup).toContain('Status');
    expect(markup).not.toContain('>0<');
  });

  it('keeps its own label so the control is identifiable when collapsed', () => {
    const markup = render(
      <MultiSelect label="Education level" options={OPTIONS} value={[]} onChange={noop} />,
    );
    expect(markup).toContain('aria-label="Education level"');
    expect(markup).toContain('aria-expanded="false"');
  });

  it('announces itself as taking more than one answer', () => {
    // Collapsed, so only the trigger is in the markup — but the trigger must already say a popup
    // is coming, or a screen reader user meets a button that appears to do nothing.
    const markup = render(
      <MultiSelect label="Status" options={OPTIONS} value={[]} onChange={noop} />,
    );
    expect(markup).toContain('aria-haspopup="listbox"');
  });
});

describe('FilterBar reset', () => {
  it('appears only once filters are actually set', () => {
    expect(bar('en', false)).not.toContain('aria-label="Clear filters"');
    expect(bar('en', true)).toContain('aria-label="Clear filters"');
  });

  it('is an icon button that stays named for screen readers and on hover', () => {
    const markup = bar('en', true);
    expect(markup).toContain('title="Clear filters"');
    // Colour is the point of the change — it must not blend into the row of grey controls.
    expect(markup).toContain('amber');
  });

  it('is labelled in Arabic too', () => {
    expect(bar('ar', true)).toContain('aria-label="مسح عوامل التصفية"');
  });
});

describe('clearable — «امسح اللى اختارته كله» in one press', () => {
  const picked = (clearable: boolean, value: string[], locale: Locale = 'en'): string =>
    render(
      <MultiSelect
        label="Cars"
        options={CARS}
        value={value}
        onChange={noop}
        clearable={clearable}
        showSelectedValues
      />,
      locale,
    );

  it('puts a ✕ beside the closed trigger once something is picked', () => {
    const html = picked(true, ['ZZ0104', 'ZZ0105']);
    expect(html).toContain('data-multiselect-clear="true"');
    expect(html).toContain('aria-label="Clear all — Cars"');
  });

  it('labels it in Arabic too', () => {
    expect(picked(true, ['ZZ0104'], 'ar')).toContain('title="مسح الكل"');
  });

  it('shows no ✕ while nothing is picked', () => {
    expect(picked(true, [])).not.toContain('data-multiselect-clear');
  });

  it('leaves every screen that has not asked for it exactly as it was', () => {
    expect(picked(false, ['ZZ0104'])).not.toContain('data-multiselect-clear');
  });

  it('puts the ✕ AFTER the trigger, outside it — a button cannot hold another', () => {
    const html = picked(true, ['ZZ0104']);
    const triggerEnd = html.indexOf('</button>', html.indexOf('aria-haspopup="listbox"'));
    expect(html.indexOf('data-multiselect-clear')).toBeGreaterThan(triggerEnd);
    // …and the trigger still reads as before: the chosen value, not the ✕'s label.
    expect(trigger(html)).toBe('ZZ0104');
  });

  it('makes room at the trigger’s end so the chosen values never run under the ✕', () => {
    expect(picked(true, ['ZZ0104'])).toMatch(/aria-haspopup="listbox"[^>]*class="[^"]*\bpe-9\b/u);
  });
});

// «الموشر فى الفلاتر كلها لما اجى انزل بالسعم ل تحت مش بينول عشان اختار» and «فلتر قطع الغيار لما
// بختار حاجه وتتمسح بحتاج ارجع المؤشر تانى عشان اكتب لا انا عاوز المؤسر يفضل موجود».
//
// The list is behind a click and this suite has no DOM, so the keys are held through the two
// functions the component reads them with, and what only a browser can show — where the focus
// goes — through the source.
describe('the keyboard walks the list — «لما اجى انزل بالسعم ل تحت»', () => {
  const PARTS = [
    { value: 'p1', label: 'فلتر زيت' },
    { value: 'p2', label: 'فلتر هواء' },
    { value: 'p3', label: 'تيل فرامل' },
  ];

  it('Down starts at the first option and walks down one at a time', () => {
    expect(nextActiveOption(PARTS, null, 'ArrowDown')).toBe('p1');
    expect(nextActiveOption(PARTS, 'p1', 'ArrowDown')).toBe('p2');
    expect(nextActiveOption(PARTS, 'p2', 'ArrowDown')).toBe('p3');
  });

  it('Up walks back, and from nothing starts at the bottom', () => {
    expect(nextActiveOption(PARTS, 'p3', 'ArrowUp')).toBe('p2');
    expect(nextActiveOption(PARTS, null, 'ArrowUp')).toBe('p3');
  });

  it('wraps at both ends, as the single-pick Combobox does', () => {
    expect(nextActiveOption(PARTS, 'p3', 'ArrowDown')).toBe('p1');
    expect(nextActiveOption(PARTS, 'p1', 'ArrowUp')).toBe('p3');
  });

  it('Home and End jump to the ends', () => {
    expect(nextActiveOption(PARTS, 'p2', 'Home')).toBe('p1');
    expect(nextActiveOption(PARTS, 'p2', 'End')).toBe('p3');
  });

  it('follows the OPTION, not the row, when a pick reorders the list', () => {
    // The car and driver filters put what is picked first. On p2 when p3 is picked and jumps to
    // the top, the next Down still goes to the option after p2 — not to whatever is now second.
    const reordered = [PARTS[2]!, PARTS[0]!, PARTS[1]!];
    expect(nextActiveOption(reordered, 'p1', 'ArrowDown')).toBe('p2');
  });

  it('starts over when the highlighted option was typed out of the list', () => {
    expect(nextActiveOption([PARTS[2]!], 'p1', 'ArrowDown')).toBe('p3');
  });

  it('highlights nothing in an empty list', () => {
    expect(nextActiveOption([], null, 'ArrowDown')).toBeNull();
  });
});

describe('what each key does — from the search box and from the trigger alike', () => {
  const at = (
    key: string,
    from: 'search' | 'trigger' | 'other',
    open = true,
    highlighted = false,
  ): ReturnType<typeof multiSelectKey> => multiSelectKey(key, { open, highlighted, from });

  it('the arrows move the highlight from the search box, not the caret', () => {
    expect(at('ArrowDown', 'search')).toBe('move');
    expect(at('ArrowUp', 'search')).toBe('move');
  });

  it('the arrows move it from the trigger too — a short list has no search box', () => {
    expect(at('ArrowDown', 'trigger')).toBe('move');
  });

  it('an arrow on the CLOSED trigger opens the list', () => {
    expect(at('ArrowDown', 'trigger', false)).toBe('open');
    expect(at('ArrowUp', 'trigger', false)).toBe('open');
  });

  it('…and on the closed list’s ✕ it does not — Enter there would clear every pick', () => {
    expect(at('ArrowDown', 'other', false)).toBeNull();
    expect(at('ArrowUp', 'other', false)).toBeNull();
  });

  it('Enter picks the highlighted option', () => {
    expect(at('Enter', 'search', true, true)).toBe('pick');
    expect(at('Enter', 'trigger', true, true)).toBe('pick');
  });

  it('Enter with nothing highlighted keeps its old meaning — the typed codes, the trigger', () => {
    // The car filter's box takes `215 - 216` on Enter; that must survive the new key.
    expect(at('Enter', 'search', true, false)).toBeNull();
    expect(at('Enter', 'trigger', true, false)).toBeNull();
  });

  it('Enter on another button in the panel presses THAT button', () => {
    // A chip's × or «مسح الكل» with the keyboard's focus on it does what it says.
    expect(at('Enter', 'other', true, true)).toBeNull();
  });

  it('Home and End stay with the caret while the search box has focus', () => {
    expect(at('Home', 'search')).toBeNull();
    expect(at('End', 'search')).toBeNull();
    expect(at('Home', 'trigger')).toBe('move');
  });

  it('Escape closes an open list and leaves a closed one alone', () => {
    expect(at('Escape', 'search')).toBe('close');
    expect(at('Escape', 'trigger', false)).toBeNull();
  });

  it('typing is typing', () => {
    expect(at('a', 'search', true, true)).toBeNull();
    expect(at(' ', 'search', true, true)).toBeNull();
  });
});

describe('the caret stays in the search box — «عاوز المؤسر يفضل موجود»', () => {
  /** Source with comments stripped: a call named only in prose must not keep a guard green. */
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'MultiSelect.tsx'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const option = source.slice(
    source.indexOf('role="option"'),
    source.indexOf('</button>', source.indexOf('role="option"')),
  );
  const toggle = source.slice(source.indexOf('const toggle ='), source.indexOf('const clearAll ='));

  it('pressing an option does not take the focus from the search box', () => {
    expect(option).toContain('onMouseDown={(e) => e.preventDefault()}');
    // …and the click still picks, exactly as it did.
    expect(option).toContain('onClick={() => toggle(option.value)}');
  });

  it('every pick, by mouse, chip or Enter, hands the focus back to the search box', () => {
    expect(toggle).toContain('searchRef.current?.focus()');
    expect(source).toContain('ref={searchRef}');
  });

  it('the spare-parts filter still empties the box on a pick — only the caret stays', () => {
    expect(toggle).toMatch(/if \(clearSearchOnPick && query !== ''\) searchFor\(''\)/u);
  });

  it('the list does not close on a pick — the next one is one keystroke away', () => {
    expect(toggle).not.toContain('setOpen');
  });

  it('the keys are read on the whole control, so they work wherever its focus is', () => {
    expect(source).toMatch(/<div ref=\{boxRef\}[^>]*onKeyDown=\{onKeyDown\}/u);
  });

  it('names the highlighted option to a screen reader', () => {
    expect(source).toContain("'aria-activedescendant': optionId(activeIndex)");
    expect(option).toContain('id={optionId(index)}');
  });

  it('tints the highlighted row grey, never purple — purple is what is PICKED', () => {
    const tint = /highlighted &&\s*'([^']*)'/u.exec(option)?.[1] ?? '';
    expect(tint).toContain('bg-slate-100');
    expect(tint).not.toMatch(/brand|violet|purple/u);
    // …and outlined, so it is told from the hover's grey on the row the pointer rests on.
    expect(tint).toContain('ring-slate-300');
  });

  it('scrolls to the highlight on a KEY, not whenever its row moves', () => {
    // A pick by mouse in the car or driver filter moves the picked option to the top, and the
    // highlighted row with it; following that would scroll the list out from under the pointer.
    const scroll = source.slice(
      source.indexOf('useEffect(() => {'),
      source.indexOf('}, [steps]);'),
    );
    expect(scroll).toContain('scrollIntoView');
    expect(scroll).not.toContain('activeIndex');
  });

  it('opened from the keyboard, waits on the first row of the list as DRAWN', () => {
    // The car and driver filters search for themselves: when the key lands they still hold the
    // last search's list, so a value read from it would highlight a row in the middle of the
    // fresh one.
    const opening = source.slice(
      source.indexOf("action === 'open'"),
      source.indexOf("action === 'move'"),
    );
    expect(opening).toContain('setEdge(');
    expect(opening).not.toContain('setActive(');
  });
});
