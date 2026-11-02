// 6d: a fuel card's photo shows the PIN written on its sticker, so the FULL photo is for a holder of
// `fleetFuelCard.reveal` only — the server refuses it to anyone else, and this screen never asks
// for it without the grant. Everyone else sees the small blurred thumbnail. A new photo goes up with
// its thumbnail (made in the browser), and without one when the browser cannot make it.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorCodes, type FleetFuelCardDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import type { ApiError } from '../../../shared/lib/api-client';
import { uploadPhotoWithThumb } from '../api/fleet-queries';
import { FULL_PHOTO_GRANT, FuelCardImageDialog } from '../components/FuelCardImage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});
const sent = vi.hoisted(() => ({ forms: [] as { path: string; form: FormData }[], fail: 0 }));
vi.mock('../../../shared/lib/api-client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../shared/lib/api-client');
  const ApiErrorClass = actual.ApiError as typeof ApiError;
  return {
    ...actual,
    upload: vi.fn(async (path: string, form: FormData) => {
      sent.forms.push({ path, form });
      if (sent.fail > 0) {
        sent.fail -= 1;
        throw new ApiErrorClass('FLEET_FUEL_CARD_THUMB_INVALID', 'thumb', 422);
      }
      return { id: 'c-1' };
    }),
  };
});
const thumbOf = vi.hoisted(() => ({ next: null as Blob | null }));
vi.mock('../lib/fuel-card-thumb', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../lib/fuel-card-thumb');
  return { ...actual, makeFuelCardThumb: vi.fn(async () => thumbOf.next) };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const FLEET = join(HERE, '..');
const ar = (key: string): string => translate('ar', key);

const me = (permissions: readonly string[]): MeDto =>
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

const CARD: FleetFuelCardDto = {
  id: 'c-1',
  vehicleId: 'v-239',
  vehicleCode: '239',
  label: null,
  company: 'wataniya',
  name: 'EGYCASH-4643-4209073',
  number: '5485640000000935',
  expiresAt: '2027-03-31T00:00:00.000Z',
  hasPassword: true,
  balance: 6549.73,
  requestedAmount: null,
  requestedAt: null,
  lastChargedAt: null,
  image: {
    fileId: 'f-1',
    fileName: '5485640000000935.jpg',
    size: 412_000,
    mime: 'image/jpeg',
    uploadedAt: '2026-10-04T00:00:00.000Z',
  } as unknown as FleetFuelCardDto['image'],
  imageThumb: true,
  version: 1,
  createdAt: '2026-10-04T00:00:00.000Z',
  updatedAt: '2026-10-04T00:00:00.000Z',
};

const dialog = (permissions: readonly string[], card: FleetFuelCardDto = CARD): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <FuelCardImageDialog open onClose={() => undefined} card={card} code="239" />
      </QueryClientProvider>
    </Provider>,
  );
};

/** Every web source file of the fleet module, specs aside. */
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(ts|tsx)$/u.test(name) && !name.includes('.spec.') ? [full] : [];
  });

describe('the full photo is for the reveal grant only', () => {
  it('the grant is `fleetFuelCard.reveal` — the one that shows the PIN', () => {
    expect(FULL_PHOTO_GRANT).toBe('fleetFuelCard.reveal');
  });

  it('a reader without it sees the thumbnail alone, and says who sees the full photo', () => {
    const html = dialog(['fleetFuelCard.view']);
    expect(html).toContain('data-fuel-image-thumb-only="c-1"');
    expect(html).toContain(ar('fleet.fuelCards.image.thumbOnly'));
    // Not the zoomable full photo.
    expect(html).not.toContain('data-zoom');
  });

  it('a card with no thumbnail yet says so — the full photo still is not offered', () => {
    const html = dialog(['fleetFuelCard.view'], { ...CARD, imageThumb: false });
    expect(html).toContain(ar('fleet.fuelCards.image.noThumb'));
    expect(html).toContain(ar('fleet.fuelCards.image.thumbOnly'));
  });

  it('a holder of the grant is not shown the thumbnail-only block', () => {
    const html = dialog(['fleetFuelCard.view', 'fleetFuelCard.reveal']);
    expect(html).not.toContain('data-fuel-image-thumb-only');
    expect(html).not.toContain(ar('fleet.fuelCards.image.thumbOnly'));
  });

  it('the full photo is fetched in ONE place, and only while the grant is held', () => {
    const callers = sources(FLEET)
      .filter((file) => readFileSync(file, 'utf8').includes('fetchFuelCardImage('))
      .map((file) => relative(FLEET, file))
      .sort();
    expect(callers).toEqual(['components/FuelCardImage.tsx']);
    const IMAGE = readFileSync(join(FLEET, 'components/FuelCardImage.tsx'), 'utf8');
    expect(IMAGE.match(/fetchFuelCardImage\(/gu)).toHaveLength(1);
    const hook = IMAGE.slice(
      IMAGE.indexOf('export const useFuelCardImageUrl'),
      IMAGE.indexOf('fetchFuelCardImage(cardId)'),
    );
    expect(hook).toContain("if (!allowed || fileId === null || cardId === '') {");
    // Every use of the hook passes the reveal grant.
    for (const file of sources(FLEET)) {
      const text = readFileSync(file, 'utf8');
      for (const call of text.matchAll(/useFuelCardImageUrl\(([\s\S]*?)\);/gu)) {
        expect(call[1], relative(FLEET, file)).toMatch(/mayReveal|can\(FULL_PHOTO_GRANT\)/u);
      }
    }
    expect(IMAGE).toContain('const mayReveal = can(FULL_PHOTO_GRANT);');
  });

  it('the card form’s preview box is always the thumbnail, never the full photo', () => {
    const IMAGE = readFileSync(join(FLEET, 'components/FuelCardImage.tsx'), 'utf8');
    const panel = IMAGE.slice(IMAGE.indexOf('export const FuelCardPhotoPanel'));
    expect(panel).toContain('useFuelCardThumbUrl(');
    expect(panel).not.toContain('useFuelCardImageUrl(');
  });

  it('the thumbnail is read from its own endpoint', () => {
    const API = readFileSync(join(FLEET, 'api/fleet-api.ts'), 'utf8');
    expect(API).toContain('fetchBlob(`/fleet/fuel-cards/${id}/image/thumb`)');
  });
});

describe('a new photo goes up with its thumbnail', () => {
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'card.jpg', { type: 'image/jpeg' });
  beforeEach(() => {
    sent.forms.length = 0;
    sent.fail = 0;
  });

  it('as the part `thumb`, beside the photo', async () => {
    thumbOf.next = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    await uploadPhotoWithThumb('c-1', file);
    expect(sent.forms).toHaveLength(1);
    const [{ path, form }] = sent.forms as [{ path: string; form: FormData }];
    expect(path).toBe('/fleet/fuel-cards/c-1/image');
    expect(form.get('file')).toBeInstanceOf(File);
    expect(form.get('thumb')).toBeInstanceOf(Blob);
  });

  it('without it when the browser cannot make one', async () => {
    thumbOf.next = null;
    await uploadPhotoWithThumb('c-1', file);
    expect(sent.forms).toHaveLength(1);
    expect(sent.forms[0]?.form.get('thumb')).toBeNull();
  });

  it('and again without it, should the server refuse the one it made', async () => {
    thumbOf.next = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });
    sent.fail = 1;
    await uploadPhotoWithThumb('c-1', file);
    expect(ErrorCodes.FLEET_FUEL_CARD_THUMB_INVALID).toBe('FLEET_FUEL_CARD_THUMB_INVALID');
    expect(sent.forms).toHaveLength(2);
    expect(sent.forms[0]?.form.get('thumb')).toBeInstanceOf(Blob);
    expect(sent.forms[1]?.form.get('thumb')).toBeNull();
  });
});
