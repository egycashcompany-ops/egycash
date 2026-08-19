// Phase C5 — the production properties of the captain surface.
//
// These are the things that are true of EVERY screen here rather than of one, and each of them is
// a real failure mode on a phone at a bank's back door:
//
//   · a layout that overflows sideways at 360px, so the action is off-screen;
//   · a target too small to hit one-handed;
//   · a control that is only an icon, or a state told only by colour;
//   · English leaking into an Arabic screen;
//   · execution state cached anywhere but the server, so a reload lies.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type MeDto,
  type OperationsMobileDayDto,
  type OperationsMobileStopDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { RequirePermission } from '../../../platform/router/RequirePermission';
import { CaptainDayPage } from './CaptainDayPage';

const MOBILE = fileURLToPath(new URL('.', import.meta.url));
const SOURCES = readdirSync(MOBILE).filter((f) => /\.tsx?$/.test(f) && !f.includes('.spec.'));
const sourceOf = (file: string): string => readFileSync(`${MOBILE}${file}`, 'utf8');
/**
 * The same file with comments removed. Several rules below are about what the code DOES, and these
 * files explain at length what they deliberately do not do — `CaptainShell` says in prose that it
 * is "deliberately NOT AppShell" and uses `min-h-dvh`, "not `min-h-screen`". Matching that prose
 * would fail the very files that got it right.
 */
const codeOf = (file: string): string =>
  sourceOf(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const place = (over = {}) => ({
  branchId: 'b-1',
  branchName: 'فرع التحرير',
  branchCode: '001',
  bankName: 'البنك الأهلي',
  areaName: 'وسط البلد',
  location: { addressLine: null, coordinates: { lat: 30.0444, lng: 31.2357 } },
  ...over,
});

const stop = (over: Partial<OperationsMobileStopDto> = {}): OperationsMobileStopDto =>
  ({
    assignmentId: 'a-1',
    shipmentId: 's-1',
    operationsDayId: 'd-1',
    sequence: 1,
    leg: 'pickup',
    vehicleId: 'v-1',
    crewAssignmentId: 'c-1',
    shipmentType: 'daily',
    status: 'draft',
    progress: 'current',
    executionStatus: 'pending',
    startedAt: null,
    pickedUpAt: null,
    deliveredAt: null,
    completedAt: null,
    version: 0,
    referenceNumber: 'REF-001',
    packaging: { bags: 2, cartons: 1, boxes: 0 },
    pickup: place(),
    delivery: place({ branchId: 'b-2', branchName: 'فرع المهندسين' }),
    ...over,
  }) as OperationsMobileStopDto;

const DAY = {
  date: '2026-08-18T00:00:00.000Z',
  operationsDayId: 'd-1',
  dayStatus: 'open',
  captain: { employeeId: 'e-1', code: 'EMP-0007', fullNameAr: 'محمود سيد' },
  isCaptainOnDay: true,
  assignments: [],
  stops: [
    stop({ assignmentId: 'a-1', sequence: 1, progress: 'completed', executionStatus: 'completed' }),
    stop({ assignmentId: 'a-2', sequence: 2, progress: 'current' }),
    stop({ assignmentId: 'a-3', sequence: 3, progress: 'locked' }),
  ],
  currentAssignmentId: 'a-2',
} as OperationsMobileDayDto;

const renderDay = (permissions: string[] = ['operationsExecution.own']): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as const, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u-1',
          email: 'c@ecms.local',
          username: null,
          mustChangePassword: false,
          name: { firstName: { ar: 'م', en: 'M' }, lastName: { ar: 'س', en: 'S' } },
          locale: 'ar',
          theme: 'system',
          navLayout: 'rail',
          branchId: null,
          employeeId: 'e-1',
          permissions: Object.fromEntries(permissions.map((k) => [k, 'own' as const])),
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
  qc.setQueryData(listKey('operations', 'myDay', { date: 'today' }), DAY);
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/operations/my-day']}>
          <Routes>
            <Route
              path="/operations/my-day"
              element={
                <RequirePermission permission="operationsExecution.own">
                  <CaptainDayPage />
                </RequirePermission>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

describe('mobile-first, not a narrowed desktop', () => {
  it('never fixes a width the smallest target screen cannot hold', () => {
    // 360px is the narrowest device in the brief. A `w-[420px]`, a `min-w-` above that, or a
    // desktop-first `w-96` on a container is how a screen ends up scrolling sideways.
    for (const file of SOURCES) {
      const text = sourceOf(file);
      expect(text, file).not.toMatch(/\bmin-w-\[(4[0-9]{2}|[5-9][0-9]{2})px\]/);
      expect(text, file).not.toMatch(/\bw-\[(4[0-9]{2}|[5-9][0-9]{2})px\]/);
    }
  });

  it('constrains the page by max-width, so a wide phone or a tablet does not stretch a line', () => {
    expect(sourceOf('CaptainShell.tsx')).toContain('max-w-2xl');
  });

  it('measures the viewport with dvh, not vh', () => {
    // `vh` is the tallest the viewport ever gets; on a phone the browser chrome then covers the
    // bottom of the page, which is exactly where the action button is.
    expect(codeOf('CaptainShell.tsx')).toContain('min-h-dvh');
    expect(codeOf('CaptainShell.tsx')).not.toContain('min-h-screen');
  });

  it('does not mount the desktop console shell', () => {
    // A topbar, a navigation rail and a keyboard-shortcut palette are console furniture.
    for (const file of SOURCES) {
      expect(codeOf(file), file).not.toContain('AppShell');
    }
  });

  it('gives the primary action a thumb-sized target', () => {
    // 48px — the smallest reliably hittable target one-handed, standing up.
    expect(sourceOf('StopActions.tsx')).toContain('min-h-12');
    expect(sourceOf('StopLocation.tsx')).toContain('min-h-12');
  });
});

describe('accessibility and RTL', () => {
  const html = renderDay();

  it('names the current step for assistive technology, exactly once', () => {
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
  });

  it('gives every icon-only control a label', () => {
    // The back arrow is the one control on this surface with no visible text.
    expect(sourceOf('CaptainShell.tsx')).toContain('aria-label=');
  });

  it('hides decorative glyphs from a screen reader rather than reading them out', () => {
    // The sequence bubble and the pickup→delivery arrow are pictures of information stated in
    // words beside them; read aloud they are noise.
    expect(sourceOf('StopCard.tsx')).toContain('aria-hidden="true"');
    expect(sourceOf('StopDetailPage.tsx')).toContain('aria-hidden="true"');
  });

  it('marks the loading state busy instead of rendering a silent gap', () => {
    expect(sourceOf('CaptainDayPage.tsx')).toContain('aria-busy="true"');
    expect(sourceOf('StopDetailPage.tsx')).toContain('aria-busy="true"');
  });

  it('tells the three progress states apart in words, not by colour alone', () => {
    expect(html).toContain('محطتك الحالية');
    expect(html).toContain('مقفلة حتى إتمام المحطة السابقة');
    expect(html).toContain('تمت');
  });

  it('renders a heading for the page and a region for the route', () => {
    expect(html).toContain('<h1');
    expect(html).toContain('aria-label="مسارك اليوم"');
  });
});

describe('the Arabic screen is Arabic', () => {
  it('renders no untranslated English label', () => {
    const html = renderDay();
    // Reference numbers, branch codes and coordinates are identifiers and stay Latin; prose must
    // not. Anything matching an English word of four letters or more in the visible text is copy
    // that never reached the translation table.
    const visible = html
      .replace(/<[^>]+>/g, ' ')
      .replace(/REF-[\w-]+/g, ' ')
      .replace(/\d/g, ' ');
    expect(visible).not.toMatch(/\b(Stop|Collect|Deliver|Locked|Done|Current|Start|Confirm)\b/);
  });

  it('routes every visible string through the translation table', () => {
    // A literal in JSX is a string that cannot be translated. Attribute values and class names are
    // not visible text, so only JSX text nodes are checked.
    for (const file of SOURCES) {
      // `(?<![=-])` so an arrow function's `=>` followed by a generic — `=> Promise<unknown>` —
      // is not read as a text node between two tags.
      const jsxText = [
        ...codeOf(file).matchAll(/(?<![=-])>\s*([A-Za-z][A-Za-z ,.'’-]{3,})\s*</g),
      ].map((m) => m[1]);
      expect(jsxText, file).toEqual([]);
    }
  });
});

describe('a reload tells the truth', () => {
  it('keeps no execution state outside the server’s answer', () => {
    for (const file of SOURCES) {
      expect(sourceOf(file), file).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    }
  });

  it('reads the day from a URL date, so a reload lands on the same day', () => {
    expect(sourceOf('CaptainDayPage.tsx')).toContain('useSearchParams');
    expect(sourceOf('StopDetailPage.tsx')).toContain('useSearchParams');
  });

  it('addresses a stop by a real URL, so the browser’s back gesture works', () => {
    expect(sourceOf('StopCard.tsx')).toContain('<Link');
  });
});

describe('the header answers the questions the brief asks it to', () => {
  const html = renderDay();

  it('names the captain from the server’s answer', () => {
    expect(html).toContain('محمود سيد');
    expect(html).toContain('EMP-0007');
  });

  it('states the operating day’s own status, which is not the captain’s', () => {
    // A day still in `planning` has not been opened by the desk and a `closed` one is finished;
    // a captain looking at an empty or frozen route deserves to know which, rather than reading
    // it as a fault in his phone.
    expect(html).toContain('اليوم التشغيلي مفتوح');
  });

  it('says plainly whether he is the captain today', () => {
    expect(html).toContain('أنت القائد اليوم');
  });

  it('shows the day’s date', () => {
    expect(html).toMatch(/٢٠٢٦|2026/);
  });
});

describe('the grant is what opens the surface', () => {
  it('shows the captain’s day to an employee holding operationsExecution.own', () => {
    expect(renderDay()).toContain('أنت القائد اليوم');
  });

  it('refuses an employee who does not hold it, without leaking the day', () => {
    // RBAC decides who may OPEN the surface. It does NOT decide who is a captain — that is the
    // day's crew row, answered inside the screen. Both are needed and neither substitutes.
    const html = renderDay(['operationsShipment.view']);
    expect(html).not.toContain('محمود سيد');
    expect(html).not.toContain('أنت القائد اليوم');
  });
});
