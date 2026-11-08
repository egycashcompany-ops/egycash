// «فحص أجهزة السيارة» as it renders (docs/12-planning/it-vehicle-checks-design.md §2): the eleven
// devices in the owner's order, «DVR», the date box on today, the bar with its count and
// «إرسال التقرير», and a draft given back after a reload. `apps/web` has no DOM to click in, so the
// page is rendered to static markup and its wiring that only a press would show is read from source.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { VehicleCheckPage } from './VehicleCheckPage';
import { VehicleCheckSent } from './VehicleCheckSent';
import { VEHICLE_CHECK_DRAFT_KEY } from './vehicle-check-draft';

const CAR = '65a000000000000000000001';
const ID = '3f0c6a52-6a4e-4b8e-9d7a-1f2b3c4d5e6f';

const ITEMS_IN_ORDER = [
  'الشاشة',
  'أمام المركبة',
  'يمين خلف',
  'يسار خلف',
  'خلف المركبة',
  'كابينة السائق',
  'كابينة الأخصائيين',
  'داخل الخزينة 1',
  'داخل الخزينة 2',
  'DVR',
  'جهاز الاتصال (موتورولا)',
];

const render = (node: JSX.Element): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as const, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u-1',
          email: 'r@ecms.local',
          username: null,
          mustChangePassword: false,
          name: { firstName: { ar: 'م', en: 'M' }, lastName: { ar: 'س', en: 'S' } },
          locale: 'ar',
          theme: 'system',
          navLayout: 'rail',
          branchId: null,
          employeeId: null,
          permissions: Object.fromEntries([['itVehicleCheck.create', 'own' as const]]),
          isPrivileged: false,
          flags: {},
          totpEnabled: true,
          external: null,
        } as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(listKey('it', 'vehicleCheckCars'), {
    items: [
      { id: CAR, code: 'كورولا 1' },
      { id: '65a000000000000000000002', code: '150' },
    ],
    meta: { page: 1, pageSize: 100, totalItems: 2, totalPages: 1 },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/it/vehicle-checks/new']}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the form', () => {
  const html = (): string => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 00:30 in Cairo on the 8th — still the 7th in UTC.
    vi.setSystemTime(new Date('2026-11-07T22:30:00Z'));
    return render(<VehicleCheckPage />);
  };

  it('shows the eleven devices, in the owner’s order', () => {
    const page = html();
    const at = ITEMS_IN_ORDER.map((label) => page.indexOf(label));
    expect(at.every((i) => i >= 0), `missing: ${String(at)}`).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('writes «DVR» as the owner did, in Latin letters', () => {
    expect(html()).toContain('>DVR<');
  });

  it('gives every device its own pair of answers, nothing chosen', () => {
    const page = html();
    expect(page.match(/role="radiogroup"/g)).toHaveLength(11);
    expect(page.match(/role="radio"/g)).toHaveLength(22);
    expect(page).not.toContain('aria-checked="true"');
    expect(page).toContain('يعمل');
    expect(page).toContain('لا يعمل');
  });

  it('names a camera’s pair by its number and place', () => {
    expect(html()).toContain('aria-label="1- أمام المركبة"');
  });

  it('opens the date box on today in Cairo, and refuses a later day', () => {
    const page = html();
    const box = /<input[^>]*data-vehicle-check-date="true"[^>]*>/.exec(page)?.[0] ?? '';
    expect(box).toContain('type="date"');
    expect(box).toContain('value="2026-11-08"');
    expect(box).toContain('max="2026-11-08"');
  });

  it('puts the car first, required, in the phone-sized box', () => {
    const page = html();
    expect(page).toContain('كود السيارة');
    expect(page).toContain('data-vehicle-select="vehicle-check-car"');
    expect(page).toContain('ابحث بكود السيارة');
    expect(/<input[^>]*role="combobox"[^>]*class="[^"]*text-base/.test(page)).toBe(true);
  });

  it('ends with the bar: the count and «إرسال التقرير»', () => {
    const page = html();
    expect(page).toContain('data-phone-footer="true"');
    expect(page).toContain('تم فحص 0 من 11');
    expect(page).toContain('إرسال التقرير');
    expect(page.indexOf('إرسال التقرير')).toBeGreaterThan(page.indexOf('الصور'));
  });

  it('frames it as a phone screen, titled and with the way home', () => {
    const page = html();
    expect(page).toContain('<h1');
    expect(page).toContain('فحص أجهزة السيارة');
    expect(page).toContain('تقنية المعلومات');
    expect(page).toContain('aria-label="الرجوع إلى الصفحة الرئيسية"');
    expect(page).toContain('href="/"');
  });

  it('offers the photo box and the note', () => {
    const page = html();
    expect(page).toContain('اضغط لإضافة صورة');
    expect(page).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(page).toContain('ملاحظات');
    expect(page).toMatch(/maxlength="1000"/i);
  });
});

describe('a draft given back after a reload', () => {
  it('restores the car, the day, the answers and the note', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
    const stored = new Map<string, string>([
      [
        VEHICLE_CHECK_DRAFT_KEY,
        JSON.stringify({
          v: 1,
          vehicleId: CAR,
          vehicleCode: 'كورولا 1',
          checkDate: '2026-11-07',
          items: { screen: 'works', camera8: 'notWorking' },
          notes: 'الكاميرا 8 لا تعرض صورة.',
          clientRequestId: ID,
        }),
      ],
    ]);
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (k: string) => stored.get(k) ?? null,
        setItem: (k: string, v: string) => void stored.set(k, v),
        removeItem: (k: string) => void stored.delete(k),
      },
    });
    const page = render(<VehicleCheckPage />);
    expect(page).toContain('value="كورولا 1"');
    expect(page).toContain('value="2026-11-07"');
    expect(page.match(/aria-checked="true"/g)).toHaveLength(2);
    expect(page).toContain('الكاميرا 8 لا تعرض صورة.');
    // The bar counts what was restored.
    expect(page).toContain('تم فحص 2 من 11');
    expect(page).toContain('1 لا يعمل');
  });
});

describe('the banner and the send, read from source', () => {
  const SOURCE = readFileSync(fileURLToPath(new URL('./VehicleCheckPage.tsx', import.meta.url)), 'utf8');

  it('opens the missing-fields banner with the form’s own words', () => {
    expect(SOURCE).toMatch(/<MissingFieldsBanner[\s\S]*?lead=\{t\('it\.vehicleCheck\.notSent'\)\}/);
    expect(translate('ar', 'it.vehicleCheck.notSent')).toBe('لم يتم إرسال التقرير.');
  });

  it('guards the send with the required fields — the car and the day', () => {
    expect(SOURCE).toContain('onClick={required.guard(submit)}');
    expect(SOURCE).toContain('vehicleCheckRequired(form');
  });

  it('files the report before any photo, and the photos one at a time', () => {
    const file = SOURCE.indexOf('await fileVehicleCheck(');
    const photos = SOURCE.indexOf('await uploadPhotosInOrder(report.id');
    expect(file).toBeGreaterThan(-1);
    expect(photos).toBeGreaterThan(file);
  });
});

describe('the sent view', () => {
  const sent = (failed = 0, refused: string[] = []): string =>
    render(
      <VehicleCheckSent
        summary={{
          vehicleCode: 'كورولا 1',
          checkDate: '2026-11-08',
          counts: { total: 11, done: 11, works: 10, notWorking: 1, unanswered: 0 },
          photoCount: 2,
          failed,
          refused,
        }}
        retrying={false}
        onRetry={() => undefined}
        onAnother={() => undefined}
      />,
    );

  it('says it was sent, with the car, the day, the counts and the photos', () => {
    const page = sent();
    expect(page).toContain('تم إرسال التقرير');
    expect(page).toContain('كورولا 1');
    expect(page).toContain('08/11/2026');
    expect(page).toContain('10 يعمل');
    expect(page).toContain('1 لا يعمل');
    expect(page).toContain('صورتان');
    expect(page).toContain('تقرير لسيارة أخرى');
    expect(page, 'nothing to send again').not.toContain('إعادة رفع الصور');
  });

  it('counts the photos that did not go up, and offers to send them again', () => {
    const page = sent(2);
    expect(page).toContain('تعذّر رفع صورتين.');
    expect(page).toContain('إعادة رفع الصور');
  });

  it('names the photos the server refused, with the reason', () => {
    const page = sent(0, ['IT_VEHICLE_CHECK_PHOTO_LIMIT']);
    expect(page).toContain('لم تُرفع صورة واحدة:');
    expect(page).toContain('التقرير يحمل 5 صور بالفعل');
    expect(page, 'a refused photo is not offered again').not.toContain('إعادة رفع الصور');
  });
});
