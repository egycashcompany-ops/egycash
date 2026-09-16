// The go-live notice: what the boot-time import recorded, printed where the data should be.
//
// «مفيش عربيات اضافت» — twice, and the reason lived in a log the owner cannot open. The
// notice's job is to print the run row on the screen it was meant to fill, and to stay out of the
// way when there is nothing to say.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type FleetGoLiveRunDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { GoLiveNotice, formatValue, latestRun, runState, type GoLiveStep } from './components/GoLiveNotice';

const run = (over: Partial<FleetGoLiveRunDto> = {}): FleetGoLiveRunDto => ({
  key: 'go-live:vehicles:v3',
  status: 'running',
  startedAt: '2026-09-15T10:00:00.000Z',
  finishedAt: null,
  leaseUntil: '2026-09-15T10:00:00.000Z',
  outcome: null,
  ...over,
});

const store = (permissions: string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: { id: 'u1', permissions: Object.fromEntries(permissions.map((k) => [k, 'organization'])) } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

const render = (
  runs: FleetGoLiveRunDto[],
  { step = 'vehicles', permissions = ['fleetVehicle.create'] }: { step?: GoLiveStep; permissions?: string[] } = {},
): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['fleet', 'go-live'], { runs });
  return renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <GoLiveNotice step={step} />
      </QueryClientProvider>
    </Provider>,
  );
};

describe('what the notice says', () => {
  it('prints a REFUSAL with the step’s own reasons — a branch name, verbatim', () => {
    const markup = render([
      run({ outcome: { refused: true, reason: 'plan', missingBranches: [], inactiveBranches: ['المهندسين'], identifierClashes: [] } }),
    ]);
    expect(markup).toContain('data-go-live-state="refused"');
    expect(markup, 'the step').toContain('استيراد السيارات');
    expect(markup, 'the state').toContain('مرفوض، لم يبدأ');
    expect(markup, 'the field, in words').toContain('فروع غير مفعّلة');
    expect(markup, 'the branch, verbatim').toContain('المهندسين');
    expect(markup, 'the state keys are the title, not lines').not.toContain('refusedAt');
    expect(markup, 'an empty list is not a line').not.toContain('فروع غير موجودة في النظام');
    expect(markup, 'the reason code is said in words').toContain('البيانات تحتاج تصحيحًا');
    expect(markup).not.toContain('السبب: plan');
  });

  it('prints a PARTIAL run with each failure as «code: reason»', () => {
    const markup = render([
      run({
        outcome: {
          created: 0,
          updated: 0,
          photos: 0,
          failed: 2,
          failures: [
            { code: '150', reason: 'Validation failed — body.branchId: branch not found or inactive' },
            { code: '151', reason: 'Duplicate' },
          ],
          failedAt: '2026-09-15T10:00:01.000Z',
        },
      }),
    ]);
    expect(markup).toContain('data-go-live-state="failed"');
    expect(markup).toContain('code: 150 · reason: Validation failed — body.branchId: branch not found or inactive');
    expect(markup).toContain('code: 151 · reason: Duplicate');
  });

  it('says a run is in progress when it holds a live lease and has reported nothing', () => {
    expect(render([run()])).toContain('data-go-live-state="running"');
  });

  it('prints NOTHING for a finished run with nothing to note', () => {
    expect(render([run({ status: 'done', outcome: { created: 209, updated: 0, photos: 56 } })])).toBe('');
  });

  it('prints a finished run that skipped somebody — the scans with no driver of that code', () => {
    const markup = render(
      [run({ key: 'go-live:driver-photos:v2', status: 'done', outcome: { attached: 40, kept: 0, enrolled: 40, unknownCodes: ['0100999.jpg'], notDrivers: ['0100998.jpg — موظف مكتب'], exited: [] } })],
      { step: 'driver-photos', permissions: ['fleetDriver.manage'] },
    );
    expect(markup).toContain('data-go-live-state="done"');
    expect(markup).toContain('صور رخص السائقين');
    expect(markup).toContain('0100999.jpg');
    expect(markup, 'the two reasons, told apart').toContain('أضفهم في الموارد البشرية');
    expect(markup).toContain('ليسوا في سجل السائقين');
    expect(markup).toContain('0100998.jpg — موظف مكتب');
  });

  it('prints a finished odometer import with the names HR does not have, and the cars the registry does not', () => {
    const markup = render(
      [
        run({
          key: 'go-live:odometer:v1',
          status: 'done',
          outcome: {
            vehicles: 170,
            imported: 18734,
            alreadyThere: 0,
            closedByExisting: 0,
            openConflicts: [],
            skippedDeleted: 747,
            rejected: [{ id: '6963899b54423ddc3fbdfba3', reason: '176: the date cannot be read' }],
            unknownCars: ['194 (1)', 'تويوتا1 (2)'],
            noOutReading: 837,
            noOutReadingRows: ['150 2025-11-25'],
            closedByNext: 360,
            badInReading: 32,
            unmatchedDrivers: ['محمد محمود', 'عمرو عنتر على على'],
            ambiguousDrivers: ['محمد احمد — 0100026, 0100027'],
            placeholders: ['احتياطى', 'التوكيل'],
          },
        }),
      ],
      { step: 'odometer' },
    );
    expect(markup).toContain('data-go-live-state="done"');
    expect(markup).toContain('استيراد دفتر العداد');
    expect(markup, 'a count, in words').toContain('قراءات أُضيفت');
    expect(markup, 'the names, verbatim, for HR').toContain('أضفهم هناك');
    expect(markup).toContain('عمرو عنتر على على');
    expect(markup).toContain('محمد احمد — 0100026, 0100027');
    expect(markup).toContain('تويوتا1 (2)');
    expect(markup, 'an empty list is not a line').not.toContain('لم يُمكن وصل');
  });

  it('a finished run that reports only counts says nothing — whatever the step', () => {
    expect(
      render([run({ key: 'go-live:odometer:v1', status: 'done', outcome: { vehicles: 170, imported: 18734, unknownCars: [], unmatchedDrivers: [] } })], { step: 'odometer' }),
    ).toBe('');
  });

  it('prints nothing at all when there is no row for the step', () => {
    expect(render([run({ key: 'go-live:driver-photos:v1' })], { step: 'vehicles' })).toBe('');
  });
});

describe('who sees it', () => {
  it('asks nothing and shows nothing to a reader who could not act on it', () => {
    const refused = run({ outcome: { refused: true, reason: 'plan' } });
    expect(render([refused], { permissions: ['fleetVehicle.view'] })).toBe('');
    expect(render([refused], { permissions: ['fleetDriver.manage'] }), 'the other write grant').not.toBe('');
  });
});

describe('the rules', () => {
  it('reads the HIGHEST version of a step — v2 is history once v3 exists', () => {
    const runs = [run({ key: 'go-live:vehicles:v2', status: 'done' }), run({ key: 'go-live:vehicles:v3' }), run({ key: 'go-live:driver-photos:v1' })];
    expect(latestRun(runs, 'vehicles')?.key).toBe('go-live:vehicles:v3');
    expect(latestRun(runs, 'driver-photos')?.key).toBe('go-live:driver-photos:v1');
    expect(latestRun([], 'vehicles')).toBeNull();
  });

  it('classifies a row by its outcome first, its status second', () => {
    expect(runState(run({ outcome: { refused: true } }))).toBe('refused');
    expect(runState(run({ outcome: { failed: 3, failures: [] } }))).toBe('failed');
    expect(runState(run({ status: 'done', outcome: { created: 1 } }))).toBe('done');
    expect(runState(run())).toBe('running');
  });

  it('formats arrays, objects and scalars as text somebody can copy', () => {
    expect(formatValue(['أ', 'ب'])).toBe('أ ، ب');
    expect(formatValue({ code: '150', field: 'plateNumber' })).toBe('code: 150 · field: plateNumber');
    expect(formatValue(3)).toBe('3');
  });
});
