// التمامات — «تحسين اختيار السواقيين … وتحسين شكل البيانات فى جداول … التمامات».
//
// The board draws its rows as the drivers and vehicles boards draw theirs: every value centred,
// a day year first with slashes in Latin digits, each driver as a badge with the name and the
// code under it. The record form picks the driver with `DriverPicker` — the whole roster the
// moment it opens — behind the same drivers' view grant the old search box asked for, and a
// driver already decided (an edit, the profile page) is drawn the same way in its fixed box.
//
// The web suite runs with `environment: 'node'` and no DOM: the table and the dialog are read
// out of their static markup.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type FleetDriverUnavailabilityDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { listKey } from '../../shared/lib/query-keys';
import { AttendancePage } from './pages/AttendancePage';
import { UnavailabilityDialog } from './components/UnavailabilityDialog';
import { readSorts, sortQuery } from './lib/table-sort';

// `DesignDialog` portals into `document.body`; the suite runs without a DOM. Rendering the
// portal's tree in place is enough to read what the dialog produces.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const t = (key: string): string => translate('ar', key);

const DRIVER_A = '64b1f0dddddddddddddddd01';
const DRIVER_B = '64b1f0dddddddddddddddd02';
/** Somebody the roster does not carry. */
const STRANGER = '64b1f0dddddddddddddddd99';

const ALL = [
  'fleetAvailability.view',
  'fleetAvailability.record',
  'fleetAvailability.edit',
  'fleetDriver.view',
];

const record = (o: Partial<FleetDriverUnavailabilityDto> = {}): FleetDriverUnavailabilityDto => ({
  id: 'u1',
  employeeId: DRIVER_A,
  from: '2026-10-25T00:00:00.000Z',
  to: '2026-10-27T00:00:00.000Z',
  reason: 'مأمورية',
  notes: null,
  version: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...o,
});

/** One row of Fleet's people list — the shape `/fleet/people` answers with. */
const person = (employeeId: string, code: string, fullNameAr: string) => ({
  employeeId,
  code,
  fullNameAr,
  status: 'active' as const,
  branchId: null,
  address: null,
  governorate: null,
  phone: null,
  hiredAt: null,
});

/** The key the board's own query reads: page 1, 25 a page, newest start first. */
const BOARD_KEY = listKey('fleet', 'availability', {
  page: 1,
  pageSize: 25,
  ...sortQuery(readSorts(null, 'from:desc')),
  coversDate: undefined,
});

const client = (rows: FleetDriverUnavailabilityDto[]): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(BOARD_KEY, {
    items: rows,
    meta: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1 },
  });
  qc.setQueryData(
    ['fleet', 'people'],
    [person(DRIVER_A, 'HR-1001', 'محمد السيد'), person(DRIVER_B, 'HR-1002', 'أحمد علي')],
  );
  return qc;
};

const store = (permissions: readonly string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(permissions.map((k) => [k, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

const wrap = (node: JSX.Element, qc: QueryClient, permissions: readonly string[] = ALL): string =>
  renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/fleet/attendance']}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const thead = (markup: string): string =>
  markup.slice(markup.indexOf('<thead'), markup.indexOf('</thead>'));
const tbody = (markup: string): string =>
  markup.slice(markup.indexOf('<tbody'), markup.indexOf('</tbody>'));

describe('the attendance board draws its rows as the drivers board does', () => {
  const rows = [
    record(),
    record({ id: 'u2', employeeId: DRIVER_B, notes: 'بإذن المشرف', reason: 'إجازة عارضة' }),
  ];
  const html = wrap(<AttendancePage />, client(rows));

  it('keeps every column, in its order, under its header', () => {
    const heads = [...thead(html).matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) =>
      (m[1] as string).replace(/<[^>]*>/g, '').trim(),
    );
    expect(heads).toEqual([
      t('fleet.attendance.fields.driver'),
      t('fleet.attendance.fields.from'),
      t('fleet.attendance.fields.to'),
      t('fleet.attendance.fields.reason'),
      t('fleet.attendance.fields.notes'),
      t('fleet.vehicles.columns.actions'),
    ]);
  });

  it('draws a driver as a badge, the name, and the code under it — never the code glued on', () => {
    const body = tbody(html);
    const cellOf = (name: string): string => {
      const at = body.indexOf(`>${name}<`);
      expect(at, `${name} is drawn`).toBeGreaterThan(-1);
      return body.slice(body.lastIndexOf('<td', at), body.indexOf('</td>', at));
    };
    const first = cellOf('محمد السيد');
    expect(first, 'the badge').toContain('rounded-full');
    expect(first, 'with the name’s initials').toContain('>مس<');
    expect(first, 'the code under the name').toContain('>HR-1001<');
    expect(cellOf('أحمد علي'), 'the code under the name').toContain('>HR-1002<');
    expect(body, 'no raw id where the roster knows the person').not.toContain(DRIVER_A.slice(-8));
  });

  it('writes each day year first with slashes, in Latin digits and the boards’ figure', () => {
    const body = tbody(html);
    for (const day of ['2026/10/25', '2026/10/27']) {
      const at = body.indexOf(`>${day}<`);
      expect(at, `${day} is drawn`).toBeGreaterThan(-1);
      const tag = body.slice(body.lastIndexOf('<span', at), at);
      expect(tag, `${day} reads left to right`).toContain('dir="ltr"');
      expect(tag, `${day} in tabular figures`).toContain('tabular-nums');
    }
    expect(body, 'no Arabic-Indic figure left in the grid').not.toMatch(/[٠-٩]/u);
  });

  it('keeps the reason and the note, and a missing note is a grey dash', () => {
    const body = tbody(html);
    expect(body).toContain('مأمورية');
    expect(body).toContain('إجازة عارضة');
    expect(body).toContain('بإذن المشرف');
    expect(body).toContain('<span class="text-slate-400">—</span>');
  });

  it('centres every column — the row’s actions stay at its end', () => {
    const heads = [...thead(html).matchAll(/<th\b[^>]*class="([^"]*)"/g)].map(
      (m) => m[1] as string,
    );
    expect(heads).toHaveLength(6);
    heads.slice(0, -1).forEach((cls) => expect(cls).toContain('text-center'));
    expect(heads.at(-1), 'the actions header').toContain('text-end');
    const firstRow = tbody(html).split('<tr').slice(1)[0] as string;
    const cells = [...firstRow.matchAll(/<td\b[^>]*class="([^"]*)"/g)].map((m) => m[1] as string);
    expect(cells).toHaveLength(6);
    cells.slice(0, -1).forEach((cls) => expect(cls).toContain('text-center'));
    expect(cells.at(-1), 'the actions cell').toContain('text-end');
  });

  it('still offers edit and cancel only under the edit grant', () => {
    const withEdit = tbody(html);
    expect(withEdit).toContain(`aria-label="${t('fleet.attendance.edit')}"`);
    expect(withEdit).toContain(`aria-label="${t('fleet.attendance.cancel')}"`);
    const viewer = wrap(<AttendancePage />, client(rows), ['fleetAvailability.view']);
    expect(tbody(viewer)).not.toContain(`aria-label="${t('fleet.attendance.edit')}"`);
    expect(thead(viewer)).not.toContain(t('fleet.vehicles.columns.actions'));
  });
});

describe('the attendance form picks the driver from the roster', () => {
  const SOURCE = readFileSync(join(HERE, 'components/UnavailabilityDialog.tsx'), 'utf8');
  const recordForm = (permissions: readonly string[] = ALL): string =>
    wrap(
      <UnavailabilityDialog open onClose={() => undefined} record={null} />,
      client([]),
      permissions,
    );

  it('uses the shared driver picker, not the old search box', () => {
    expect(SOURCE).toContain('<DriverPicker');
    expect(SOURCE).not.toContain('EmployeeSearchPicker');
    const html = recordForm();
    expect(html, 'the picker').toContain('data-driver-picker="true"');
    expect(html, 'its placeholder until somebody is picked').toContain(
      t('fleet.drivers.pickerPlaceholder'),
    );
  });

  it('says so, rather than offering an empty list, to a reader who cannot read the roster', () => {
    const html = recordForm(ALL.filter((p) => p !== 'fleetDriver.view'));
    expect(html).toContain(t('fleet.drivers.pickerNeedsDirectory'));
    expect(html).not.toContain('data-driver-picker="true"');
  });

  it('keeps the driver required — its rule and its star', () => {
    expect(SOURCE).toMatch(
      /key: 'driver', label: t\('fleet\.attendance\.fields\.driver'\), ok: form\.employeeId !== ''/u,
    );
    expect(SOURCE).toMatch(/required\s+missing=\{required\.isMissing\('driver'\)\}/u);
  });

  it('draws a driver already decided as the picker draws its pick — badge, name, code', () => {
    const edit = wrap(
      <UnavailabilityDialog open onClose={() => undefined} record={record()} />,
      client([]),
    );
    const box = edit.slice(edit.indexOf('data-attendance-driver="fixed"'));
    expect(box, 'the badge').toContain('rounded-full');
    expect(box).toContain('>محمد السيد<');
    expect(box, 'the code under the name').toContain('>HR-1001<');
    expect(edit, 'no picker on an edit — a record never moves to another person').not.toContain(
      'data-driver-picker="true"',
    );

    const fromProfile = wrap(
      <UnavailabilityDialog
        open
        onClose={() => undefined}
        record={null}
        fixedEmployeeId={DRIVER_B}
      />,
      client([]),
    );
    expect(fromProfile).toContain('data-attendance-driver="fixed"');
    expect(fromProfile).toContain('>أحمد علي<');
    expect(fromProfile).not.toContain('data-driver-picker="true"');
  });

  it('a decided driver the roster does not carry keeps the id’s tail, as before', () => {
    const html = wrap(
      <UnavailabilityDialog
        open
        onClose={() => undefined}
        record={null}
        fixedEmployeeId={STRANGER}
      />,
      client([]),
    );
    expect(html).toContain(STRANGER.slice(-8));
  });
});
