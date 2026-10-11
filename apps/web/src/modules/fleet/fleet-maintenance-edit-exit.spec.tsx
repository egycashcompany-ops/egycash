// The edit dialog offers the EXIT counter of a closed visit (C4).
//
// The exit counter is the alarm's baseline — the reading the car left the workshop on — and it
// was written once, at check-out, with no way back to it: the edit dialog showed only the entry
// counter, so a figure mistyped at check-out could not be corrected anywhere on the screen. The
// endpoint already took it (and checks it: not below the entry counter, not below the last
// reading on the check-out day). The dialog now offers it on a closed visit, optional as on
// check-out, and never on an open visit, which has not left yet.
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
    driverInEmployeeId: null,
    driverOutEmployeeId: null,
    inDate: '2026-06-25T00:00:00.000Z',
    outDate: '2026-06-28T00:00:00.000Z',
    workshopId: 'w1',
    workTypeId: 'wt1',
    spareParts: [],
    sparePartIds: [],
    odometerAtService: 84_080,
    exitOdometer: null,
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

const integerBoxes = (markup: string): number =>
  (markup.match(/data-input-rule="integer"/g) ?? []).length;

describe('the edit dialog and the exit counter', () => {
  it('a CLOSED visit offers it, beside the entry counter, as a whole-number box', () => {
    const markup = draw(visit());
    expect(markup).toContain(t('fleet.maintenance.fields.exitOdometer'));
    expect(integerBoxes(markup), 'the entry counter and the exit counter').toBe(2);
  });

  it('an OPEN visit does not — it has not left yet, and check-out writes that counter', () => {
    const markup = draw(visit({ outDate: null }));
    expect(markup).not.toContain(t('fleet.maintenance.fields.exitOdometer'));
    expect(integerBoxes(markup), 'the entry counter only').toBe(1);
  });

  it('it is optional — never starred, and empty never holds Save', () => {
    const code = editSource();
    const field = code.slice(
      code.indexOf("label={t('fleet.maintenance.fields.exitOdometer')}"),
      code.indexOf(
        '</AdvisedField>',
        code.indexOf("label={t('fleet.maintenance.fields.exitOdometer')}"),
      ),
    );
    // The star is a bare `required` prop on its own line; `required.isMissing(…)` is the guard.
    expect(field, 'no required star').not.toMatch(/^\s*required(?:=\{true\})?\s*$/m);
    expect(field, 'it says it is optional').toContain("t('fleet.maintenance.odometerOptional')");
    const rules = code.slice(code.indexOf('useRequiredFields('));
    expect(rules.slice(0, rules.indexOf(');'))).toContain(
      "ok: !closed || exitOdometer === '' || (exitValid && !exitBelowEntry && !exitBelowLast)",
    );
  });

  it('it is sent only when this edit changed it, and emptied it is cleared', () => {
    expect(editSource()).toMatch(
      /\.\.\.\(closed && exitChanged\s*\?\s*\{ exitOdometer: exitOdometer === '' \? null : exitNumber \}\s*:\s*\{\}\)/,
    );
  });

  it('it is held to the entry counter and to the chain on the day the car LEFT', () => {
    const code = editSource();
    // The entry counter as this edit leaves it — the same pair the server checks.
    expect(code).toContain('exitNumber < odometerNumber');
    // Below the last reading only when this edit CHANGES it, like the entry counter.
    expect(code).toContain(
      'exitValid && exitChanged && exitLast !== null && exitNumber < exitLast',
    );
    expect(code).toContain("visit?.outDate?.slice(0, 10) ?? ''");
    // Each refusal keeps its own words under the field.
    expect(code).toContain("? t('fleet.maintenance.exitBelowEntry')");
  });

  it('it opens on the counter the visit closed with', () => {
    expect(editSource()).toContain(
      "setExitOdometer(visit.exitOdometer == null ? '' : String(visit.exitOdometer))",
    );
  });
});
