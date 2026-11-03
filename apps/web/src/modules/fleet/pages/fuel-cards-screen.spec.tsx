// The two fuel-card screens, proven against what they produce: one tile per car with Wataniya
// above Chill Out, every fact in its own frame, the warnings ABOVE the frame they are about, the
// request box with its ✓ ✕, and the balances summed between the filters and the tiles.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  FleetSettingKeys,
  type FleetFuelCardDto,
  type FleetFuelCardMovementDto,
  type FleetFuelCardTotalsDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { FuelCardsPage } from './FuelCardsPage';
import { FuelChargingPage } from './FuelChargingPage';
import { fuelCardPlace, groupByVehicle, noCarPlaces } from '../components/FuelCardTiles';
import { CARD_COLUMNS, CHARGE_COLUMNS } from '../components/FuelCardBoard';
import { FuelCardHistoryDialog } from '../components/FuelCardHistoryDialog';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const ar = (key: string): string => translate('ar', key);

const me = (permissions: string[]): MeDto =>
  ({
    id: 'u-1',
    email: 'user@ecms.local',
    username: null,
    mustChangePassword: false,
    name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
    locale: 'ar',
    theme: 'system',
    navLayout: 'rail',
    branchId: null,
    branchIds: [],
    employeeId: null,
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
    isPrivileged: false,
    flags: {},
    totpEnabled: true,
    external: null,
  }) as unknown as MeDto;

const card = (over: Partial<FleetFuelCardDto> = {}): FleetFuelCardDto => ({
  id: 'c-1',
  vehicleId: 'v-204',
  vehicleCode: '204',
  label: null,
  company: 'wataniya',
  name: 'كارت وطنية 204',
  number: '7045 1120 0098 2231',
  expiresAt: '2099-03-31T00:00:00.000Z',
  hasPassword: true,
  balance: 640,
  requestedAmount: null,
  requestedAt: null,
  lastChargedAt: null,
  image: null,
  version: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const totals: FleetFuelCardTotalsDto = {
  wataniyaBalance: 2400,
  chilloutBalance: 6350,
  requestedCount: 1,
  requestedAmount: 500,
  chargedTodayAmount: 300,
  cardCount: 4,
};

const ALL = [
  'fleetFuelCard.view',
  'fleetFuelCard.create',
  'fleetFuelCard.edit',
  'fleetFuelCard.delete',
  'fleetFuelCard.reveal',
  'fleetFuelCharge.view',
  'fleetFuelCharge.request',
  'fleetFuelCharge.approve',
  'fleetFuelCharge.transfer',
];

const render = (
  page: 'cards' | 'charging',
  {
    permissions = ALL,
    cards = [card()],
    filters,
    search = '',
  }: {
    permissions?: string[];
    cards?: FleetFuelCardDto[];
    filters?: Record<string, unknown>;
    /** The URL's query — what the screen reads its filters from. */
    search?: string;
  } = {},
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  const params =
    filters ??
    (page === 'cards'
      ? { vehicleCodes: undefined, company: undefined, number: undefined, expiresBefore: undefined }
      : {
          vehicleCodes: undefined,
          company: undefined,
          requested: undefined,
          balanceBelow: undefined,
        });
  qc.setQueryData(listKey('fleet', 'fuelCards', { whole: true, ...params }), {
    items: cards,
    meta: { page: 1, pageSize: 100, totalItems: cards.length, totalPages: 1 },
  });
  qc.setQueryData(listKey('fleet', 'fuelCards', { summary: true, ...params }), totals);
  qc.setQueryData(
    ['settings', 'me'],
    [
      { key: FleetSettingKeys.FuelCardExpiryWarnDays, value: 30, resolvedFrom: 'default' },
      { key: FleetSettingKeys.FuelCardBalanceYellow, value: 300, resolvedFrom: 'default' },
      { key: FleetSettingKeys.FuelCardBalanceRed, value: 100, resolvedFrom: 'default' },
    ],
  );
  const path = page === 'cards' ? '/fleet/fuel-cards' : '/fleet/fuel-cards/charging';
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`${path}${search}`]}>
          <Routes>
            <Route path="/fleet/fuel-cards" element={<FuelCardsPage />} />
            <Route path="/fleet/fuel-cards/charging" element={<FuelChargingPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

describe('one tile per car, Wataniya above Chill Out', () => {
  it('groups a flat list of cards under their cars, keeping the company slots', () => {
    const tiles = groupByVehicle([
      card({ id: 'a', company: 'chillout' }),
      card({ id: 'b', company: 'wataniya' }),
      card({ id: 'c', vehicleId: 'v-178', vehicleCode: '178', company: 'chillout' }),
    ]);
    expect(tiles.map((tile) => tile.code)).toEqual(['204', '178']);
    expect(Object.keys(tiles[0]?.cards ?? {}).sort()).toEqual(['chillout', 'wataniya']);
    expect(tiles[1]?.cards.wataniya).toBeUndefined();
  });

  it('draws the car’s block — its code, Wataniya’s line above Chill Out’s free slot — as designed', () => {
    const html = render('cards');
    expect(html).toContain('data-fuel-tile="v-204"');
    expect(html).toContain('data-fuel-held="1"');
    const wataniya = html.indexOf('data-fuel-line="wataniya"');
    const chillout = html.indexOf('data-fuel-line="chillout"');
    expect(wataniya).toBeGreaterThan(-1);
    expect(chillout, 'the second slot is drawn even with no card in it').toBeGreaterThan(wataniya);
    // The marks the owner chose: Wataniya's logo, Chill Out's red.
    expect(html).toContain('/fleet-fuel-cards/wataniya.png');
    expect(html).not.toContain('/fleet-fuel-cards/chillout.png');
    // The number in fours, its copy button, the PIN behind its eye, the photo.
    expect(html).toContain('data-fuel-copy="c-1"');
    // Batch 3 (item 2, the approved one-row sample): the PIN is a field like the others, its
    // caption a word with no colon — «PIN», a new key; the old «PIN:» key stays for its readers.
    expect(html).toContain(`>${ar('fleet.fuelCards.board.pinCaption')}<`);
    expect(html.indexOf(`>${ar('fleet.fuelCards.board.pinCaption')}<`)).toBeGreaterThan(
      html.indexOf('data-fuel-pin="c-1"'),
    );
    expect(html).toContain(ar('fleet.fuelCards.board.photo'));
    expect(html, 'the empty slot offers to fill it').toContain('data-fuel-add="chillout"');
    expect(html).toContain(ar('fleet.fuelCards.board.half'));
  });

  it('hides the password behind the eye, and the eye behind its grant', () => {
    expect(render('cards')).toContain('data-fuel-reveal="c-1"');
    expect(render('cards', { permissions: ['fleetFuelCard.view'] })).not.toContain(
      'data-fuel-reveal=',
    );
    expect(render('cards')).not.toContain('1234');
  });

  it('marks the expiry «ينتهي قريباً» when the card expires within the setting’s days', () => {
    const soon = render('cards', {
      cards: [card({ expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString() })],
    });
    expect(soon).toContain('data-fuel-expiry="soon"');
    expect(soon).toContain(ar('fleet.fuelCards.expiry.soon'));
    const late = render('cards', {
      cards: [card({ expiresAt: new Date(Date.now() + 400 * 86_400_000).toISOString() })],
    });
    expect(late).toContain('data-fuel-expiry="valid"');
    expect(late).not.toContain('data-fuel-expiry="soon"');
  });

  it('a card whose expiry is not known yet shows «—» and marks nothing', () => {
    const html = render('cards', { cards: [card({ expiresAt: null })] });
    expect(html).not.toContain('data-fuel-expiry=');
    expect(html).not.toContain('Invalid');
  });
});

describe('the card photo — «صوره كل فيزا»', () => {
  const photo = {
    fileId: 'f-1',
    fileName: '5485640006880021.jpg',
    mime: 'image/jpeg',
    size: 1000,
    uploadedAt: '2026-10-04T00:00:00.000Z',
  };

  it('a card with a photo shows its frame with the eye that opens it', () => {
    const html = render('cards', { cards: [card({ image: photo })] });
    expect(html).toContain(ar('fleet.fuelCards.image.title'));
    expect(html).toContain('data-fuel-image="c-1"');
    expect(html).not.toContain('data-fuel-image-upload=');
  });

  it('a card with none still has «صورة الكارت» — its dialog offers the upload to an editor', () => {
    expect(render('cards')).toContain('data-fuel-image="c-1"');
    const viewer = render('cards', { permissions: ['fleetFuelCard.view'] });
    expect(viewer).not.toContain('data-fuel-edit=');
    expect(viewer).not.toContain('data-fuel-delete=');
  });
});

describe('a filter on the card leaves the other slot out, not «empty»', () => {
  it('a number search shows the card it found and no «لا يوجد كارت» beside it', () => {
    const html = render('cards', {
      search: '?number=5485640006436766',
      filters: {
        vehicleCodes: undefined,
        company: undefined,
        number: '5485640006436766',
        expiresBefore: undefined,
      },
    });
    expect(html).toContain('data-fuel-line="wataniya"');
    expect(html, 'the Chill Out slot is filtered away').not.toContain('data-fuel-line="chillout"');
    expect(html).not.toContain(ar('fleet.fuelCards.noCard'));
    expect(html).not.toContain('data-fuel-add=');
  });

  it('with no filter on the card, a car without one still says so and offers to add it', () => {
    const html = render('cards');
    expect(html).toContain('data-fuel-add="chillout"');
  });

  it('the charging screen filtered to one company draws only that company', () => {
    const html = render('charging', {
      search: '?company=wataniya',
      filters: {
        vehicleCodes: undefined,
        company: 'wataniya',
        requested: undefined,
        balanceBelow: undefined,
      },
    });
    expect(html).toContain('data-fuel-line="wataniya"');
    expect(html).not.toContain('data-fuel-line="chillout"');
  });
});

describe('the password on the line', () => {
  it('once shown, it has an eye that hides it again', () => {
    const PAGE = readFileSync(join(HERE, '../components/FuelCardBoard.tsx'), 'utf8');
    expect(PAGE).toContain('data-fuel-hide={card.id}');
    expect(PAGE).toContain('onClick={() => setShown(null)}');
    const DIALOG = readFileSync(join(HERE, '../components/FuelCardDialog.tsx'), 'utf8');
    expect(DIALOG).toContain('data-fuel-password-toggle');
  });
});

describe('the request box is one frame, like every other fact on the line', () => {
  it('its input carries no border or ring of its own; the frame lights up instead', () => {
    const html = render('charging');
    const box = html.match(/<input[^>]*data-fuel-request="c-1"[^>]*>/u)?.[0] ?? '';
    expect(box).toContain('border-transparent');
    expect(box).toContain('focus-visible:ring-0');
    expect(box).not.toContain('bg-white');
    expect(html).toContain('focus-within:border-emerald-500');
  });
});

describe('cards on no car — «كروت زيادة ملهمش عربيات»', () => {
  const travel = (id: string, label: string, over: Partial<FleetFuelCardDto> = {}) =>
    card({ id, vehicleId: null, vehicleCode: null, label, ...over });

  it('each label is a tile of its own, its two companies together like a car’s', () => {
    const tiles = groupByVehicle([
      travel('t1', 'سفر 1'),
      travel('t2', 'تويوتا اللواء'),
      travel('t3', 'تويوتا اللواء', { company: 'chillout' }),
      card({ id: 'a' }),
    ]);
    expect(tiles.map((tile) => [tile.code, tile.noCar])).toEqual([
      ['سفر 1', true],
      ['تويوتا اللواء', true],
      ['204', false],
    ]);
    expect(Object.keys(tiles[1]?.cards ?? {}).sort()).toEqual(['chillout', 'wataniya']);
  });

  it('sits in the stock («العهدة / المخزن») under its label, offered to a car, never added to', () => {
    const html = render('cards', { cards: [travel('t1', 'سفر 1')] });
    expect(html).toContain('سفر 1');
    expect(html).toContain('data-fuel-no-car="true"');
    expect(html).toContain('data-fuel-stock="true"');
    expect(html).toContain(ar('fleet.fuelCards.board.unlinked'));
    expect(html).toContain('data-fuel-assign="t1"');
    expect(html).not.toContain('data-fuel-add=');
    expect(render('charging', { cards: [travel('t1', 'سفر 1')] })).toContain('سفر 1');
  });

  it('is picked by its label where a car is picked — the transfer', () => {
    const cards = [travel('t1', 'سفر 1'), travel('t2', 'سفر 1', { company: 'chillout' }), card()];
    expect(noCarPlaces(cards)).toEqual([{ id: 'label:سفر 1', code: 'سفر 1' }]);
    expect(cards.filter((c) => fuelCardPlace(c) === 'label:سفر 1').map((c) => c.id)).toEqual([
      't1',
      't2',
    ]);
    const TRANSFER = readFileSync(join(HERE, '../components/FuelTransferDialog.tsx'), 'utf8');
    // Both car boxes offer every place that holds a card — a car's code, or a label on no car.
    expect(TRANSFER).toContain(
      "const placeOf = (card: FleetFuelCardDto): string => card.vehicleCode ?? card.label ?? '—';",
    );
    expect(TRANSFER.match(/options=\{placeOptions/gu)).toHaveLength(2);
  });
});

describe('charging', () => {
  it('sums the balances by company above the filters, as the fuel cards screen does', () => {
    const html = render('charging');
    const strip = html.indexOf('data-fuel-kpi="wataniya"');
    const filters = html.indexOf(ar('fleet.fuelCards.filters.state'));
    const tile = html.indexOf('data-fuel-tile=');
    expect(strip).toBeGreaterThan(-1);
    expect(filters).toBeGreaterThan(strip);
    expect(tile).toBeGreaterThan(filters);
    expect(html).toContain(ar('fleet.fuelCards.totals.wataniya'));
  });

  it('colours a row with a request waiting and shows its ✓ ✕; a charged one reads green for a day', () => {
    const html = render('charging', {
      cards: [
        card({ id: 'req', requestedAmount: 500, requestedAt: '2026-10-01T10:00:00.000Z' }),
        card({
          id: 'chg',
          vehicleId: 'v-178',
          vehicleCode: '178',
          company: 'chillout',
          lastChargedAt: new Date().toISOString(),
        }),
      ],
    });
    const req = html.slice(
      html.indexOf('data-fuel-line="wataniya"'),
      html.indexOf('data-fuel-tile="v-178"'),
    );
    expect(req).toContain('bg-amber-500/15');
    expect(req).toContain('data-fuel-tick="req"');
    expect(req).toContain('data-fuel-cross="req"');
    const chg = html.slice(html.indexOf('data-fuel-tile="v-178"'));
    expect(chg).toContain('bg-emerald-500/15');
  });

  it('marks the balance below the yellow line, and in red below the red line', () => {
    const html = render('charging', {
      cards: [
        card({ id: 'y', balance: 150 }),
        card({ id: 'r', vehicleId: 'v-156', vehicleCode: '156', balance: 40 }),
      ],
    });
    expect(html).toContain(ar('fleet.fuelCards.balanceYellow'));
    expect(html).toContain(ar('fleet.fuelCards.board.charge.critical'));
    // On the balance's own box — its caption line, beside «الرصيد» — so the line never wraps.
    const balance = html.indexOf('data-fuel-balance="y"');
    expect(html.indexOf(ar('fleet.fuelCards.balanceYellow'), balance)).toBeGreaterThan(balance);
  });

  it('offers the transfer only to a reader who may move balances', () => {
    expect(render('charging')).toContain('data-fuel-transfer-open="true"');
    expect(render('charging', { permissions: ['fleetFuelCharge.view'] })).not.toContain(
      'data-fuel-transfer-open=',
    );
  });

  it('the transfer says what each card was and becomes, and never gives more than the first holds', () => {
    const DIALOG = readFileSync(join(HERE, '../components/FuelTransferDialog.tsx'), 'utf8');
    // «القديم كان كام واتحول منه كام بقى كام والجديد كان كام واتحوله المبلغ بقى كام»: each card's
    // line names what it held, what moves, and what it will hold.
    expect(DIALOG).toContain("t('fleet.fuelCards.transfer.was')");
    expect(DIALOG).toContain("'fleet.fuelCards.transfer.taken'");
    expect(DIALOG).toContain("'fleet.fuelCards.transfer.given'");
    expect(DIALOG).toContain("t('fleet.fuelCards.transfer.becomes')");
    expect(DIALOG).toContain('amount: was + sign * moved');
    expect(DIALOG).toContain("t('fleet.fuelCards.transfer.doneMany'");
    // «اقدر اضيف اكتر من كارت»: each step is held to what the step before it left the giving card.
    expect(DIALOG).toContain(
      "const enough = transfer.card === '' || amount <= giverBefore + 1e-9;",
    );
    expect(ar('fleet.fuelCards.transfer.was')).toBe('كان');
    expect(ar('fleet.fuelCards.transfer.becomes')).toBe('يصبح');
    // The button stays pressable; the press goes through the guard, which refuses — and names —
    // more than the first card holds, and the same card on both sides.
    expect(DIALOG).toContain('onClick={required.guard(submit)}');
    expect(DIALOG).not.toContain('disabled={');
    expect(DIALOG).toContain('ok: amount > 0 && enough,');
    // A tick that is the giving card, or of the other company, is let go.
    expect(DIALOG).toContain('id !== transfer.card &&');
    expect(DIALOG).toContain('(company === undefined || card.company === company)');
    // «متجبش اوبشن انه يختار نفس العربيه اصلا»: the «to» box leaves the «from» car out.
    expect(DIALOG).toContain('option.value !== placeOf(from)');
    // «وطنيه ل وطنيه ومينفعش وطنيه ل شيل اوت»: the receiving cards are offered from the giving
    // card's company only, and a car with none of it says so.
    expect(DIALOG).toContain(
      'card.id !== item.card && (company === undefined || card.company === company)',
    );
    expect(DIALOG).toContain("t('fleet.fuelCards.transfer.otherCompany'");
    // The «not enough» line stays under the amount, and the amount box turns red with it.
    expect(DIALOG).toContain("t('fleet.fuelCards.transfer.notEnough'");
    expect(DIALOG).toContain('missing={required.isMissing(amountKey)}');
    // «+ اضافه تحويل … يجيب من و الى»: more transfers in one press, each «من» over «إلى», and
    // each picking its cars several at once — the charging screen's own car filter.
    expect(DIALOG).toContain("t('fleet.fuelCards.transfer.addTransfer')");
    expect(DIALOG.match(/<VehicleCodeFilter/gu)).toHaveLength(2);
    expect(DIALOG).toContain('data-fuel-transfer-side={`${i + 1}:from`}');
    expect(DIALOG).toContain('data-fuel-transfer-side={`${i + 1}:to`}');
  });

  // ── Batch 3, item 2: «فى شاشة شحن الكروت عاوز شكل رقم الكارت يكون زى بطاقات الوقود», and the
  // approved sample's «كل الداتا تكون جمب بعض على صف واحد» — the shared number box, one row.
  const numberBoxOf = (html: string, id = 'c-1'): string => {
    const copy = html.indexOf(`data-fuel-copy="${id}"`);
    const number = html.indexOf(`data-fuel-number="${id}"`);
    expect(copy, 'the copy button').toBeGreaterThan(-1);
    expect(number, 'the number, after its caption line').toBeGreaterThan(copy);
    return html.slice(html.lastIndexOf('<div', copy), html.indexOf('</div>', number) + 6);
  };
  const openingTagOf = (html: string, id: string): string =>
    html.match(new RegExp(`<div[^>]*data-fuel-card="${id}"[^>]*>`, 'u'))?.[0] ?? '';

  it('draws the number in the fuel cards screen’s own box: one line, with its copy button', () => {
    const box = numberBoxOf(render('charging'));
    expect(box).toContain(`>${ar('fleet.fuelCards.fields.number')}<`);
    expect(box).toContain(`title="${ar('fleet.fuelCards.copyNumber')}"`);
    const span = box.match(/<span[^>]*data-fuel-number="c-1"[^>]*>/u)?.[0] ?? '';
    expect(span, 'the number never wraps').toContain('whitespace-nowrap');
    expect(span).toContain('dir="ltr"');
    expect(box).toContain('>7045 1120 0098 2231<');
  });

  it('the number box is, byte for byte, the box «بطاقات الوقود» draws', () => {
    expect(numberBoxOf(render('charging'))).toBe(numberBoxOf(render('cards')));
  });

  it('the top-up line carries the number only — no PIN and no expiry — as «بطاقات الوقود» keeps both', () => {
    const html = render('charging');
    expect(html).not.toContain('data-fuel-pin=');
    expect(html).not.toContain('data-fuel-reveal=');
    expect(html).not.toContain('data-fuel-expiry');
    expect(html).not.toContain(ar('fleet.fuelCards.board.pin'));
    expect(html).not.toContain(`>${ar('fleet.fuelCards.board.pinCaption')}<`);
    const cards = render('cards');
    expect(cards).toContain('data-fuel-pin="c-1"');
    expect(cards).toContain('data-fuel-expiry-box="c-1"');
  });

  it('every figure is a field — its caption on top, its value under it — after the shared name cell', () => {
    const html = render('charging', {
      cards: [card({ requestedAmount: 500, requestedAt: '2026-10-01T10:00:00.000Z' })],
    });
    expect(html).toContain('data-fuel-name="c-1"');
    expect(render('cards')).toContain('data-fuel-name="c-1"');
    const order = [
      'data-fuel-name="c-1"',
      'data-fuel-number="c-1"',
      'data-fuel-balance="c-1"',
      'data-fuel-request-box="c-1"',
      'data-fuel-history="c-1"',
    ].map((hook) => html.indexOf(hook));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const balance = html.slice(order[2], order[3]);
    expect(balance).toContain(`>${ar('fleet.fuelCards.fields.balance')}<`);
    expect(balance).toContain('640.00');
    // The request's ✓ ✕ sit beside the amount, inside the request's own field.
    const request = html.slice(order[3], order[4]);
    expect(request).toContain(`>${ar('fleet.fuelCards.fields.request')}<`);
    expect(request).toContain('data-fuel-request="c-1"');
    expect(request).toContain('data-fuel-tick="c-1"');
    expect(request).toContain('data-fuel-cross="c-1"');
  });

  it('both boards are ONE row from `fuel-grid` up, sharing the gap and the number column', () => {
    const BOARD = readFileSync(join(HERE, '../components/FuelCardBoard.tsx'), 'utf8');
    const gap = BOARD.match(/const ONE_ROW_GAP = '([^']+)';/u)?.[1] ?? '';
    expect(gap).toBe('fuel-grid:gap-x-[clamp(0.375rem,calc((100cqi_-_48.5rem)/4),1rem)]');
    const track = (columns: string): string[] =>
      columns.match(/fuel-grid:grid-cols-\[([^\]]+)\]/u)?.[1]?.split('_') ?? [];
    for (const columns of [CARD_COLUMNS, CHARGE_COLUMNS]) {
      const classes = columns.split(' ');
      expect(classes).toContain('fuel-grid:grid');
      expect(classes).toContain(gap);
      // One template from `fuel-grid` up: no wider second one, no name on a line of its own.
      expect(classes.filter((c) => c.includes('grid-cols-'))).toHaveLength(1);
      expect(columns).not.toContain('fuel-line:');
      expect(columns).not.toContain('col-span-full');
      // The card's column first, the same number column second on both boards.
      expect(track(columns).slice(0, 2)).toEqual(['minmax(13.75rem,1fr)', '14.5rem']);
    }
    expect(track(CARD_COLUMNS)).toEqual([
      'minmax(13.75rem,1fr)',
      '14.5rem',
      '7.75rem',
      '4.25rem',
      'minmax(6.625rem,1fr)',
    ]);
    expect(track(CHARGE_COLUMNS)).toEqual([
      'minmax(13.75rem,1fr)',
      '14.5rem',
      '8rem',
      '8rem',
      'minmax(2.625rem,1fr)',
    ]);
    // Tailwind reads class names from the source, so the templates are written out there in full,
    // with the Azeret Mono arithmetic beside them (another figures font means measuring again).
    expect(BOARD).toContain(
      'fuel-grid:grid-cols-[minmax(13.75rem,1fr)_14.5rem_7.75rem_4.25rem_minmax(6.625rem,1fr)]',
    );
    expect(BOARD).toContain(
      'fuel-grid:grid-cols-[minmax(13.75rem,1fr)_14.5rem_8rem_8rem_minmax(2.625rem,1fr)]',
    );
    expect(BOARD).toContain('The widths, measured in Azeret Mono');
  });

  it('the top-up page draws the shared pieces and no longer groups the number itself', () => {
    const PAGE = readFileSync(join(HERE, 'FuelChargingPage.tsx'), 'utf8');
    expect(PAGE).toContain('<FuelCardNumberBox card={card} />');
    expect(PAGE).toContain('<FuelCardNameCell card={card} />');
    expect(PAGE).not.toContain('groupCardNumber(card.number)');
    expect(PAGE).not.toContain('groupCardNumber');
  });

  it('«شُحن اليوم» is Cairo’s day: the figure, its note and the filter say «اليوم»', () => {
    const PAGE = readFileSync(join(HERE, 'FuelChargingPage.tsx'), 'utf8');
    expect(PAGE).toContain("label={t('fleet.fuelCards.totals.chargedOnCairoDay')}");
    expect(PAGE).toContain("{t('fleet.fuelCards.board.charge.chargedTodayNote')}");
    expect(PAGE).toContain("charged: 'fleet.fuelCards.filters.chargedOnCairoDay',");
    // The row's green and the filter are one rule (`chargedToday`), no longer the browser's day.
    expect(PAGE).toContain('const charged = chargedToday(card);');
    expect(PAGE).not.toContain('toDateString()');
    const html = render('charging');
    expect(html).toContain(ar('fleet.fuelCards.totals.chargedOnCairoDay'));
    expect(html).toContain(ar('fleet.fuelCards.board.charge.chargedTodayNote'));
    expect(html).not.toContain(ar('fleet.fuelCards.totals.chargedToday'));
    expect(html).not.toContain(ar('fleet.fuelCards.board.charge.chargedNote'));
    expect(ar('fleet.fuelCards.totals.chargedOnCairoDay')).toBe('شُحن اليوم');
    expect(ar('fleet.fuelCards.filters.chargedOnCairoDay')).toBe('شُحنت اليوم');
    expect(ar('fleet.fuelCards.board.charge.chargedTodayNote')).toBe('أضيفت للأرصدة اليوم');
  });

  it('paints a row green for a charge on today’s Cairo date only — 00:10 yes, 23:30 yesterday no', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-02T07:00:00.000Z')); // 09:00, 2 November, in Cairo
      const html = render('charging', {
        cards: [
          // 00:10 today in Cairo — the UTC date is still the 1st.
          card({ id: 'early', lastChargedAt: '2026-11-01T22:10:00.000Z' }),
          // 23:30 yesterday in Cairo — under ten hours ago, yet not «today».
          card({
            id: 'late',
            vehicleId: 'v-178',
            vehicleCode: '178',
            lastChargedAt: '2026-11-01T21:30:00.000Z',
          }),
        ],
      });
      expect(openingTagOf(html, 'early')).toContain('bg-emerald-500/15');
      expect(openingTagOf(html, 'late')).not.toBe('');
      expect(openingTagOf(html, 'late')).not.toContain('bg-emerald-500/15');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the card form', () => {
  it('names what a card cannot be saved without, rather than greying Save out', () => {
    const DIALOG = readFileSync(join(HERE, '../components/FuelCardDialog.tsx'), 'utf8');
    expect(DIALOG).toContain('onClick={required.guard(submit)}');
    expect(DIALOG).not.toContain('disabled={');
    const rules = DIALOG.slice(DIALOG.indexOf('useRequiredFields('));
    const list = rules.slice(0, rules.indexOf(');'));
    for (const rule of [
      "ok: name.trim() !== ''",
      'ok: number.trim().length >= 4',
      // «الباسورد اجبارى» and «تاريخ انتهاء الكارت اجبارى».
      'ok: passwordOk',
      "ok: expiresAt !== ''",
    ]) {
      expect(list, `the save requires ${rule}`).toContain(rule);
    }
    // «كود السياره مش اجبارى»: no rule asks for a car; a card on no car keeps its label or takes
    // its name.
    expect(list).not.toContain('vehicleId');
    expect(DIALOG).toContain("label: vehicleId === '' ? (card?.label ?? name.trim()) : null");
    // The browser's saved logins stay out of the card's boxes.
    expect(DIALOG).toContain('autoComplete="new-password"');
  });
});

describe('the card log — «كارت اخر»: a card that paid for another car’s fuel says whose', () => {
  const line = (over: Partial<FleetFuelCardMovementDto>): FleetFuelCardMovementDto => ({
    id: 'm-1',
    cardId: 'c-1',
    kind: 'receipt',
    amount: -100,
    balanceAfter: 540,
    counterpartCardId: null,
    counterpartNumber: null,
    receiptVehicleId: 'v-204',
    receiptVehicleCode: '204',
    at: '2026-10-01T00:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    byName: null,
    sheet: null,
    cancelledBySheet: null,
    link: null,
    repair: null,
    ...over,
  });
  const logOf = (logged: FleetFuelCardDto, lines: FleetFuelCardMovementDto[]): string => {
    const store = configureStore({
      reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
      preloadedState: {
        locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
        auth: { me: me(ALL), status: 'signedIn' as const },
        ui: { theme: 'light' as const, sidebarOpen: false },
      },
    });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
    });
    qc.setQueryData(listKey('fleet', 'fuelCards', { movements: logged.id }), {
      items: lines,
      meta: { page: 1, pageSize: 100, totalItems: lines.length, totalPages: 1 },
    });
    return renderToStaticMarkup(
      <Provider store={store}>
        <QueryClientProvider client={qc}>
          <FuelCardHistoryDialog card={logged} cards={[logged]} onClose={() => undefined} />
        </QueryClientProvider>
      </Provider>,
    );
  };

  it('the car’s own receipt reads «خصم إيصال» as it always did', () => {
    const html = logOf(card(), [line({})]);
    expect(html).toContain(`>${ar('fleet.fuelCards.history.kind.receipt')}<`);
    expect(html).not.toContain('سيارة 204');
  });

  it('another car’s receipt, or one paid by a card on no car, names the car it was for', () => {
    const forOther = logOf(card(), [
      line({ receiptVehicleId: 'v-160', receiptVehicleCode: '160' }),
    ]);
    expect(forOther).toContain(
      translate('ar', 'fleet.fuelCards.history.kind.receiptFor', { place: '160' }),
    );
    expect(translate('ar', 'fleet.fuelCards.history.kind.receiptFor', { place: '160' })).toBe(
      'خصم إيصال (سيارة 160)',
    );
    const stock = logOf(card({ vehicleId: null, vehicleCode: null, label: 'سفر 1' }), [line({})]);
    expect(stock).toContain(
      translate('ar', 'fleet.fuelCards.history.kind.receiptFor', { place: '204' }),
    );
  });
});

describe('the card log — the company sheet’s two lines, and who made each line', () => {
  const line = (over: Partial<FleetFuelCardMovementDto>): FleetFuelCardMovementDto => ({
    id: 'm-1',
    cardId: 'c-1',
    kind: 'charge',
    amount: 100,
    balanceAfter: 640,
    counterpartCardId: null,
    counterpartNumber: null,
    receiptVehicleId: null,
    receiptVehicleCode: null,
    at: '2026-10-01T00:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    byName: null,
    sheet: null,
    cancelledBySheet: null,
    link: null,
    repair: null,
    ...over,
  });
  const SHEET = {
    reconciliationId: 'r-1',
    fileName: 'wataniya-balances-2026-10-20.xlsx',
    sheetBalance: 16745.12,
    systemBalance: 795,
    cancelledCharges: [],
  };
  const logOf = (lines: FleetFuelCardMovementDto[]): string => {
    const store = configureStore({
      reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
      preloadedState: {
        locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
        auth: { me: me(ALL), status: 'signedIn' as const },
        ui: { theme: 'light' as const, sidebarOpen: false },
      },
    });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
    });
    qc.setQueryData(listKey('fleet', 'fuelCards', { movements: 'c-1' }), {
      items: lines,
      meta: { page: 1, pageSize: 100, totalItems: lines.length, totalPages: 1 },
    });
    return renderToStaticMarkup(
      <Provider store={store}>
        <QueryClientProvider client={qc}>
          <FuelCardHistoryDialog
            card={card({ name: 'EGYCASH-9932-438728' })}
            cards={[card()]}
            onClose={() => undefined}
          />
        </QueryClientProvider>
      </Provider>,
    );
  };
  const lineOf = (html: string, id: string): string => {
    const start = html.indexOf(`data-fuel-history-line="${id}"`);
    expect(start, id).toBeGreaterThan(-1);
    const next = html.indexOf('data-fuel-history-line=', start + 10);
    return html.slice(start, next === -1 ? undefined : next);
  };

  it('«تعديل من شيت الشركة»: from the system’s balance to the sheet’s, its file, who decided', () => {
    const html = logOf([
      line({
        id: 's-1',
        kind: 'sheetAdjust',
        amount: 15950.12,
        balanceAfter: 16745.12,
        sheet: SHEET,
        byName: 'أحمد علي',
      }),
    ]);
    const adjust = lineOf(html, 's-1');
    expect(adjust).toContain(ar('fleet.fuelCards.history.kind.sheetAdjust'));
    expect(ar('fleet.fuelCards.history.kind.sheetAdjust')).toBe('تعديل من شيت الشركة');
    expect(adjust).toContain(
      translate('ar', 'fleet.fuelCards.history.sheetFromTo', { from: '795.00', to: '16,745.12' }),
    );
    expect(adjust).toContain(
      translate('ar', 'fleet.fuelCards.history.sheetFile', { file: SHEET.fileName }),
    );
    expect(adjust).toContain('بواسطة أحمد علي');
    expect(adjust).toContain('+15,950.12');
  });

  it('«رفض تعديل الشيت»: nothing moved — «—» for the amount, what the sheet said and what stayed', () => {
    const html = logOf([
      line({
        id: 's-2',
        kind: 'sheetReject',
        amount: 0,
        balanceAfter: 795,
        sheet: SHEET,
        byName: 'أحمد علي',
      }),
    ]);
    const reject = lineOf(html, 's-2');
    expect(reject).toContain(ar('fleet.fuelCards.history.kind.sheetReject'));
    expect(reject).toContain(
      translate('ar', 'fleet.fuelCards.history.sheetWas', { sheet: '16,745.12', system: '795.00' }),
    );
    expect(reject).not.toContain('+0.00');
    expect(reject).toContain('>—<');
  });

  it('neither sheet line can be changed or removed here; a charge still can', () => {
    const html = logOf([
      line({ id: 's-1', kind: 'sheetAdjust', amount: 5, balanceAfter: 645, sheet: SHEET }),
      line({ id: 's-2', kind: 'sheetReject', amount: 0, balanceAfter: 640, sheet: SHEET }),
      line({ id: 'c-9' }),
    ]);
    for (const id of ['s-1', 's-2']) {
      expect(html).not.toContain(`data-fuel-history-edit="${id}"`);
      expect(html).not.toContain(`data-fuel-history-remove="${id}"`);
    }
    expect(html).toContain('data-fuel-history-edit="c-9"');
  });

  it('every line says who made it; a line with no writer on file says nothing', () => {
    const html = logOf([line({ id: 'c-1', byName: 'منى حسن' }), line({ id: 'c-2' })]);
    expect(lineOf(html, 'c-1')).toContain(
      translate('ar', 'fleet.fuelCards.history.by', { name: 'منى حسن' }),
    );
    expect(lineOf(html, 'c-2')).not.toContain('data-fuel-history-by');
  });

  it('the strip shows the card’s name — what the company’s sheet calls it — over its number', () => {
    const html = logOf([]);
    expect(html).toContain('data-fuel-history-name="EGYCASH-9932-438728"');
    expect(html.indexOf('EGYCASH-9932-438728<')).toBeLessThan(html.indexOf('7045 1120 0098 2231'));
  });
});
