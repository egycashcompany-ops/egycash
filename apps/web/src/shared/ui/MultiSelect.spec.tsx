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
import { MultiSelect } from './MultiSelect';
import { FilterBar } from './FilterBar';

const render = (node: JSX.Element, locale: Locale = 'en'): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: { locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) } },
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

describe('MultiSelect', () => {
  it('says how many are selected, so a filtered list never looks unfiltered', () => {
    const markup = render(
      <MultiSelect label="Status" options={OPTIONS} value={['waiting', 'accepted']} onChange={noop} />,
    );
    expect(markup).toContain('>2<');
  });

  it('shows no count when nothing is selected', () => {
    const markup = render(<MultiSelect label="Status" options={OPTIONS} value={[]} onChange={noop} />);
    expect(markup).toContain('Status');
    expect(markup).not.toContain('>0<');
  });

  it('keeps its own label so the control is identifiable when collapsed', () => {
    const markup = render(<MultiSelect label="Education level" options={OPTIONS} value={[]} onChange={noop} />);
    expect(markup).toContain('aria-label="Education level"');
    expect(markup).toContain('aria-expanded="false"');
  });

  it('announces itself as taking more than one answer', () => {
    // Collapsed, so only the trigger is in the markup — but the trigger must already say a popup
    // is coming, or a screen reader user meets a button that appears to do nothing.
    const markup = render(<MultiSelect label="Status" options={OPTIONS} value={[]} onChange={noop} />);
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
