// The edit dialog corrects «سائق الخروج» of a closed visit — «عاوز اقدر اعدل السواق التانى اللى هو
// سائق الخروج».
//
// Before, the only way to fix a wrong exit driver was to reopen the visit (which also wipes the
// exit date, the exit counter and the custody) and check it out again. The dialog now offers the
// exit driver right after «سائق الدخول», with the same picker and look, on a CLOSED visit only — an
// open visit has not left yet, and «إخراج من الورشة» sets it. Like the entry driver it is a
// correction, never a clear, and like the exit counter it is sent only when this edit changed it.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type FleetMaintenanceVisitDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { MaintenanceEditDialog } from './components/MaintenanceDialogs';

// `Dialog` portals into `document.body`; the suite runs without a DOM.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
/** The edit dialog's own code, comments left out. */
const editSource = (): string => {
  const code = readFileSync(join(HERE, 'components/MaintenanceDialogs.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  return code.slice(code.indexOf('export const MaintenanceEditDialog'));
};

const t = (key: string): string => translate('ar', key);

const PERMS = [
  'fleetMaintenance.view',
  'fleetMaintenance.edit',
  'fleetOdometer.view',
  'fleetVehicle.view',
];

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(PERMS.map((p) => [p, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const visit = (over: Partial<FleetMaintenanceVisitDto> = {}): FleetMaintenanceVisitDto =>
  ({
    id: '650000000000000000000091',
    vehicleId: '650000000000000000000001',
    vehicleCode: '219',
    driverInEmployeeId: '650000000000000000000e01',
    driverOutEmployeeId: '650000000000000000000e02',
    inDate: '2026-06-25T00:00:00.000Z',
    outDate: '2026-06-28T00:00:00.000Z',
    workshopId: 'w1',
    workTypeId: 'wt1',
    spareParts: [],
    sparePartIds: [],
    odometerAtService: 84_080,
    exitOdometer: 84_200,
    takenInByEmployeeId: null,
    takenOutByEmployeeId: null,
    notes: null,
    version: 0,
    createdAt: '2026-06-25T00:00:00.000Z',
    updatedAt: '2026-06-28T00:00:00.000Z',
    ...over,
  }) as FleetMaintenanceVisitDto;

const draw = (v: FleetMaintenanceVisitDto): string =>
  renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={new QueryClient()}>
        <MaintenanceEditDialog open onClose={() => undefined} visit={v} />
      </QueryClientProvider>
    </Provider>,
  );

const pickers = (markup: string): number =>
  (markup.match(/data-driver-picker="true"/g) ?? []).length;

describe('the edit dialog and «سائق الخروج»', () => {
  it('a CLOSED visit offers it, right after «سائق الدخول», with the same picker', () => {
    const markup = draw(visit());
    const entry = markup.indexOf(t('fleet.maintenance.fields.driverIn'));
    const exit = markup.indexOf(t('fleet.maintenance.fields.driverOut'));
    expect(entry).toBeGreaterThan(-1);
    expect(exit, 'after the entry driver').toBeGreaterThan(entry);
    // Nothing else sits between the two: the next field is the parts list.
    expect(exit).toBeLessThan(markup.indexOf(t('fleet.maintenance.fields.spareParts'), entry));
    expect(pickers(markup), 'the entry driver and the exit driver').toBe(2);
  });

  it('an OPEN visit does not — it has not left yet, and «إخراج من الورشة» sets it', () => {
    const markup = draw(visit({ outDate: null, exitOdometer: null, driverOutEmployeeId: null }));
    expect(markup).not.toContain(t('fleet.maintenance.fields.driverOut'));
    expect(pickers(markup), 'the entry driver only').toBe(1);
  });

  it('an old closed visit with none on file still offers it, empty and optional', () => {
    const markup = draw(visit({ driverOutEmployeeId: null }));
    expect(markup).toContain(t('fleet.maintenance.fields.driverOut'));
    expect(pickers(markup)).toBe(2);
    const code = editSource();
    const field = code.slice(
      code.indexOf("label={t('fleet.maintenance.fields.driverOut')}"),
      code.indexOf(
        '</DesignField>',
        code.indexOf("label={t('fleet.maintenance.fields.driverOut')}"),
      ),
    );
    // No star, and no rule holding Save.
    expect(field).not.toMatch(/\brequired\b/);
    const rules = code.slice(code.indexOf('useRequiredFields('));
    expect(rules.slice(0, rules.indexOf(');'))).not.toContain('driverOut');
  });

  it('it opens on the driver the visit closed with', () => {
    const code = editSource();
    expect(code).toContain("setDriverOut(visit.driverOutEmployeeId ?? '')");
    expect(code).toContain('<OptionalDriverField value={driverOut} onChange={setDriverOut} />');
  });

  it('it is sent only when this edit changed it, and never empty or null', () => {
    const code = editSource();
    expect(code).toMatch(
      /const driverOutChanged =\s*visit !== null && driverOut !== '' && driverOut !== \(visit\.driverOutEmployeeId \?\? ''\);/,
    );
    expect(code).toMatch(
      /\.\.\.\(closed && driverOutChanged \? \{ driverOutEmployeeId: driverOut \} : \{\}\)/,
    );
    // The only place the body names it.
    expect(code.match(/driverOutEmployeeId:/g) ?? []).toHaveLength(1);
    expect(code).not.toMatch(/driverOutEmployeeId:\s*null/);
  });
});
