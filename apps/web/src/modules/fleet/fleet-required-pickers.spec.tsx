// Pressing Save without a driver or a fuel card turns THAT box red, like every other box.
//
// `Input`, `Select` and the shared pickers read a `Field`'s missing mark on their own (pinned in
// `shared/ui/required-fields.spec.tsx`). These Fleet boxes are not any of those — the driver search
// is a `SearchInput` with a list under it, and the card pickers are a row of buttons — so each one
// reads the mark itself (`useFieldMissing`). Without that the banner would name a value whose box
// looks perfectly fine, which is half the message the owner asked for.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import { type FleetFuelCardDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { Field } from '../../shared/ui/form';
import { EmployeeSearchPicker } from './components/EmployeeSearchPicker';
import { CardPick as TransferCardPick } from './components/FuelTransferDialog';
import { CardPick as ReceiptCardPick } from './components/ReceiptDialog';

const render = (node: ReactNode): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        // The driver search answers only under the roster's own grant; without it, it renders a
        // sentence instead of a box.
        me: { id: 'u1', permissions: { 'fleetDriver.view': 'organization' } } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    </Provider>,
  );
};

/** Inside a `Field` marked missing, and inside a plain one. */
const both = (box: ReactNode): { missing: string; plain: string } => ({
  missing: render(<Field missing>{box}</Field>),
  plain: render(<Field>{box}</Field>),
});

/** Every opening tag in `html` that carries `attribute`. */
const tagsWith = (html: string, attribute: string): string[] =>
  [...html.matchAll(/<[a-z]+\b[^>]*>/gu)]
    .map((match) => match[0])
    .filter((tag) => tag.includes(attribute));

const card = (id: string, over: Partial<FleetFuelCardDto> = {}): FleetFuelCardDto => ({
  id,
  vehicleId: 'v-204',
  vehicleCode: '204',
  company: 'wataniya',
  name: 'كارت وطنية 204',
  number: `7045 1120 0098 ${id}`,
  expiresAt: '2099-03-31T00:00:00.000Z',
  hasPassword: true,
  balance: 640,
  requestedAmount: null,
  requestedAt: null,
  lastChargedAt: null,
  version: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const CARDS = [card('2231'), card('2232', { company: 'chillout' })];
const RED_CARD = /\bborder-red-400\b/u;

describe('the driver search (unavailability, accidents …)', () => {
  it('rings its search box red inside a Field marked missing, and only there', () => {
    const { missing, plain } = both(<EmployeeSearchPicker value="" onPick={() => undefined} />);
    expect(missing, 'it rendered the search box, not the «no grant» sentence').toContain(
      'type="search"',
    );
    expect(missing).toMatch(/\bring-red-400\b/u);
    expect(plain).toContain('type="search"');
    expect(plain).not.toMatch(/\bring-red-400\b/u);
  });
});

describe('the fuel-transfer card picker', () => {
  it('turns every card red inside a Field marked missing — the picked one too', () => {
    const { missing, plain } = both(
      <TransferCardPick cards={CARDS} value="2231" onChange={() => undefined} side="from" />,
    );
    const red = tagsWith(missing, 'data-fuel-transfer-card=');
    expect(red, 'both cards rendered').toHaveLength(2);
    for (const tag of red) expect(tag).toMatch(RED_CARD);
    const calm = tagsWith(plain, 'data-fuel-transfer-card=');
    expect(calm).toHaveLength(2);
    for (const tag of calm) expect(tag).not.toMatch(RED_CARD);
  });

  it('with no car picked yet, its «pick a car» line goes red instead', () => {
    const { missing, plain } = both(
      <TransferCardPick cards={[]} value="" onChange={() => undefined} side="to" />,
    );
    expect(missing).toMatch(/<p class="text-sm text-red-600\b/u);
    expect(plain).toMatch(/<p class="text-sm text-slate-400"/u);
    expect(plain).not.toMatch(/<p class="text-sm text-red-600\b/u);
  });
});

describe('the receipt card picker', () => {
  it('turns every card red inside a Field marked missing, and only there', () => {
    const { missing, plain } = both(
      <ReceiptCardPick cards={CARDS} value="" onChange={() => undefined} enabled />,
    );
    const red = tagsWith(missing, 'data-receipt-card=');
    expect(red, 'both cards rendered').toHaveLength(2);
    for (const tag of red) expect(tag).toMatch(RED_CARD);
    const calm = tagsWith(plain, 'data-receipt-card=');
    expect(calm).toHaveLength(2);
    for (const tag of calm) expect(tag).not.toMatch(RED_CARD);
  });
});
