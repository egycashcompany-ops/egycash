// The two things a multi-select filter has to get right, and one thing the bar around it must.
//
// A filter you have forgotten you set is worse than no filter, so the count in the trigger and the
// reset affordance are not decoration — they are how a filtered list admits that it is filtered.
// Both are invisible to typecheck and lint, and both fail silently, so they are asserted here.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { type Locale } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { MultiSelect, selectionSummary } from './MultiSelect';
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
