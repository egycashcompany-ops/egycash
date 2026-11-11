// The day board's toolbar figures and the «عملات أخرى» breakdown, rendered against the real
// catalogs. The sums are pinned in lib/day-board.spec.ts (`boardFigures`); this pins what reaches
// the screen — «لما ادوس على عملات أخرى دى يفتح فورم ب كل عملة لوحدها كام».
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { type OperationsCurrencyDto } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { translate } from '../../../platform/localization/i18n';
import { BoardFigurePill, FIGURE_TONE, OtherCurrenciesList } from './BoardFigures';
import { SHIPMENT_PATH } from './shipment-icons';

const render = (node: JSX.Element): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: { locale: { locale: 'ar' as const, dir: 'rtl' as const } },
  });
  return renderToStaticMarkup(<Provider store={store}>{node}</Provider>);
};

const currency = (id: string, code: string, name: string): OperationsCurrencyDto => ({
  id,
  code,
  name,
  legacyAliases: [],
  isActive: true,
  version: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
const CATALOG = [currency('eur', 'EUR', 'يورو'), currency('gbp', 'GBP', 'جنيه استرليني')];
const currencyOf = (id: string) => CATALOG.find((c) => c.id === id);

describe('OtherCurrenciesList — each other currency on its own', () => {
  it('lists every currency with its name, code and total', () => {
    const html = render(
      <OtherCurrenciesList
        totals={[
          { currencyId: 'gbp', amount: 60_000 },
          { currencyId: 'eur', amount: 30_000 },
        ]}
        currencyOf={currencyOf}
        locale="ar"
      />,
    );
    expect(html).toContain('جنيه استرليني');
    expect(html).toContain('GBP');
    expect(html).toContain('60,000');
    expect(html).toContain('يورو');
    expect(html).toContain('30,000');
    // Pound sterling before euro: the order the totals were given in (by name, from the lib).
    expect(html.indexOf('جنيه استرليني')).toBeLessThan(html.indexOf('يورو'));
  });

  it('says so when the shipments shown carry no other currency', () => {
    const html = render(<OtherCurrenciesList totals={[]} currencyOf={currencyOf} locale="ar" />);
    expect(html).toContain(translate('ar', 'operations.board.figures.otherCurrenciesEmpty'));
  });
});

describe('BoardFigurePill', () => {
  it('is a plain figure without a click, and a dialog button with one', () => {
    const plain = render(
      <BoardFigurePill
        icon={SHIPMENT_PATH.money}
        tone={FIGURE_TONE.pound}
        label="مصري"
        value="12,000,000"
        unit="EGP"
      />,
    );
    expect(plain).not.toContain('<button');
    expect(plain).toContain('12,000,000');

    const others = render(
      <BoardFigurePill
        icon={SHIPMENT_PATH.money}
        tone={FIGURE_TONE.others}
        label="عملات أخرى"
        value="90,000"
        onClick={() => undefined}
        data-figure="others"
      />,
    );
    expect(others).toContain('<button');
    expect(others).toContain('aria-haspopup="dialog"');
    expect(others).toContain('data-figure="others"');
  });
});
