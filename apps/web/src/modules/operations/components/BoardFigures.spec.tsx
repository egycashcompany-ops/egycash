// The day board's toolbar figures and the «عملات أخرى» breakdown, rendered against the real
// catalogs. The sums are pinned in lib/day-board.spec.ts (`boardFigures`, `otherCurrencies`); this
// pins what reaches the screen — «لما ادوس على عملات أخرى دى يفتح فورم ب كل عملة لوحدها كام», and
// «شكل الفورم بتاعت العملات مش عاجبنى كبرها وحسن الشكل».
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { type OperationsCurrencyDto, type OperationsShipmentDto } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { translate } from '../../../platform/localization/i18n';
import { formatNumber } from '../../../shared/lib/format';
import { otherCurrencies } from '../lib/day-board';
import { BoardFigurePill, FIGURE_TONE, OtherCurrenciesList } from './BoardFigures';
import { SHIPMENT_PATH } from './shipment-icons';

const render = (node: JSX.Element): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: { locale: { locale: 'ar' as const, dir: 'rtl' as const } },
  });
  return renderToStaticMarkup(<Provider store={store}>{node}</Provider>);
};

const currency = (
  id: string,
  code: string,
  name: string,
  sortOrder: number | null = null,
): OperationsCurrencyDto => ({
  id,
  code,
  name,
  legacyAliases: [],
  sortOrder,
  isActive: true,
  version: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
// The production catalog's shape: legacy NUMBERS as codes, beside one ISO-coded currency.
const CATALOG = [
  currency('egp', '1', 'مصري'),
  currency('usd', '2', 'دولار'),
  currency('eur', '3', 'يورو'),
  currency('gbp', 'GBP', 'جنيه استرليني'),
];
const currencyOf = (id: string) => CATALOG.find((c) => c.id === id);

const row = (id: string, lines: { currencyId: string; amount: number }[]): OperationsShipmentDto =>
  ({ id, lines }) as unknown as OperationsShipmentDto;

describe('OtherCurrenciesList — «كبرها وحسن الشكل»: a band, then a card per currency', () => {
  // The owner's screenshot: 55m مصري, 300k دولار, 450k يورو — plus pound sterling on another row.
  const rows = [
    row('a', [
      { currencyId: 'egp', amount: 55_000_000 },
      { currencyId: 'usd', amount: 300_000 },
      { currencyId: 'eur', amount: 450_000 },
    ]),
    row('b', [{ currencyId: 'eur', amount: 50_000 }]),
    row('c', [{ currencyId: 'gbp', amount: 60_000 }]),
  ];
  const others = otherCurrencies(rows, currencyOf);
  const html = render(
    <OtherCurrenciesList
      cards={others.cards}
      sum={others.sum}
      shipments={others.shipments}
      currencyOf={currencyOf}
      locale="ar"
    />,
  );
  const cards = html.slice(html.indexOf('<ul'));

  it('lists ONLY the other currencies — the pound and the dollar are figures of their own', () => {
    expect(cards).toContain('يورو');
    expect(cards).toContain('جنيه استرليني');
    expect(cards).not.toContain('data-other-currency="egp"');
    expect(cards).not.toContain('data-other-currency="usd"');
    expect(cards).not.toContain('55,000,000');
  });

  it('puts the figure itself on the band: the sum, how many currencies, how many shipments', () => {
    const band = html.slice(html.indexOf('data-other-currencies-total'), html.indexOf('<ul'));
    expect(band).toContain('560,000');
    expect(band).toContain(translate('ar', 'operations.board.figures.currencyCount.two'));
    expect(band).toContain(
      translate('ar', 'operations.board.figures.inShipments.few', { count: formatNumber(3, 'ar') }),
    );
  });

  it('lists the cards in the catalog’s order — «على حسب ترتيبها ف شاشة البيانات المرجعية»', () => {
    // Nobody has arranged this catalog, so its codes decide: «3» يورو before «GBP».
    expect(cards.indexOf('يورو')).toBeLessThan(cards.indexOf('جنيه استرليني'));
    expect(cards).toContain('500,000');
    expect(cards).toContain('60,000');
    // Dragged on the reference-data screen, pound sterling above the euro: the dialog follows,
    // although the euro's sum is the larger.
    const arranged = [
      currency('egp', '1', 'مصري', 0),
      currency('usd', '2', 'دولار', 1),
      currency('gbp', 'GBP', 'جنيه استرليني', 2),
      currency('eur', '3', 'يورو', 3),
    ];
    const arrangedOf = (id: string) => arranged.find((c) => c.id === id);
    const reordered = otherCurrencies(rows, arrangedOf);
    const html2 = render(
      <OtherCurrenciesList
        cards={reordered.cards}
        sum={reordered.sum}
        shipments={reordered.shipments}
        currencyOf={arrangedOf}
        locale="ar"
      />,
    );
    const list = html2.slice(html2.indexOf('<ul'));
    expect(list.indexOf('data-other-currency="gbp"')).toBeLessThan(
      list.indexOf('data-other-currency="eur"'),
    );
  });

  it('says on each card how many shipments carry it, and its share of the figure', () => {
    const euro = cards.slice(
      cards.indexOf('data-other-currency="eur"'),
      cards.indexOf('data-other-currency="gbp"'),
    );
    expect(euro).toContain(translate('ar', 'operations.board.figures.inShipments.two'));
    // 500,000 of 560,000.
    expect(euro).toContain('89%');
    expect(euro).toContain('width:89.28');
  });

  it('prints an alphabetic code as the unit, never a legacy number', () => {
    expect(cards).toContain('>GBP<');
    // The euro is coded «3» in the catalog: a «3» beside 500,000 would read as a figure.
    expect(cards).not.toContain('>3<');
  });

  it('draws its numbers left to right in the figures font, inside the Arabic page', () => {
    expect(cards).toMatch(/dir="ltr" class="[^"]*Azeret_Mono[^"]*">500,000</);
  });

  it('says so when the shipments shown carry no other currency', () => {
    const empty = render(
      <OtherCurrenciesList cards={[]} sum={0} shipments={0} currencyOf={currencyOf} locale="ar" />,
    );
    expect(empty).toContain(translate('ar', 'operations.board.figures.otherCurrenciesEmpty'));
    expect(empty).not.toContain('data-other-currencies-list');
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
