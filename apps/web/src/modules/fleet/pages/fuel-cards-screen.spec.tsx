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
    expect(html).toContain(ar('fleet.fuelCards.board.pin'));
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
    expect(TRANSFER.match(/extra=\{places\}/gu)).toHaveLength(2);
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
    // On the balance's own box, after its figure — the line never wraps.
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
    expect(DIALOG).toContain('to.id !== from?.id &&');
    expect(DIALOG).toContain('(from === undefined || to.company === from.company)');
    // «متجبش اوبشن انه يختار نفس العربيه اصلا»: the «to» box leaves the «from» car out.
    expect(DIALOG).toContain("exclude={item.place === '' ? [] : [item.place]}");
    // «وطنيه ل وطنيه ومينفعش وطنيه ل شيل اوت»: the second card is offered from the first's
    // company only, and says so when the car has none of it.
    expect(DIALOG).toContain('fromCompany === undefined || card.company === fromCompany');
    expect(DIALOG).toContain('cards={choices}');
    expect(DIALOG).toContain("t('fleet.fuelCards.transfer.otherCompany'");
    // The «not enough» line stays under the amount, and the amount box turns red with it.
    expect(DIALOG).toContain("t('fleet.fuelCards.transfer.notEnough'");
    expect(DIALOG).toContain('missing={required.isMissing(`${target.key}:amount`)}');
    // «+ اضافه تحويل … يجيب من و الى»: more transfers, and more cards to give to, in one press.
    expect(DIALOG).toContain("t('fleet.fuelCards.transfer.addTransfer')");
    expect(DIALOG).toContain("t('fleet.fuelCards.transfer.addTarget')");
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
