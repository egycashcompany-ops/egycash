// What the boot-time go-live steps did — on ONE page, not on every screen they filled.
//
// «مفيش عربيات اضافت». Twice, the deploy ran the import and the registry stayed empty, and the
// only account of why was a server log the owner cannot open. The steps write what they found on
// their own row (`fleet_go_live_runs`), and this prints it: a refusal with its reasons, a partial
// run with its failures, a run in progress, or a finished run that had something to note.
//
// IT USED TO SIT ON THE SCREENS THEMSELVES, above the readings, the visits, the fines and the
// files — and earned its place twice over, because it is how the seventeen buried readings and
// the workshop book that never started were both found. It is also six walls of text, hundreds
// of names that will not change, permanent, on every screen in the module: «انا مش عاوز الرسايل
// تظهر هنا». So it lives on the Fleet settings page now, all six runs together, and the screens
// show the data instead of the story of how it got there. Nothing is lost — the rows are the
// same rows, the detail is the same detail, and `GoLiveRunsPanel` is one click away.
//
// It prints the row AS IT IS. The reasons are the step's own words (a branch name, a car code, a
// file name, a validation detail) and the whole point is that the owner can copy them to whoever
// fixes the data; translating them into softer sentences would lose the one thing they carry.
import { type FleetGoLiveRunDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { AlertIcon } from '../../../shared/ui/icons';
import { useFleetGoLiveRuns } from '../api/fleet-queries';

export type GoLiveStep =
  | 'vehicles'
  | 'driver-photos'
  | 'odometer'
  | 'maintenance'
  | 'violations'
  | 'accidents';

/** The keys the notice never prints as a line — they are the state, shown as the title. */
const STATE_KEYS = new Set(['refused', 'refusedAt', 'failedAt']);

type State = 'refused' | 'failed' | 'running' | 'done';

export const runState = (run: FleetGoLiveRunDto): State => {
  if (run.outcome?.refused === true) return 'refused';
  if (typeof run.outcome?.failed === 'number') return 'failed';
  return run.status === 'done' ? 'done' : 'running';
};

/**
 * Does a FINISHED run have anything worth a notice? Any LIST the step left non-empty — skipped
 * drivers, skipped scans, the odometer book's unmatched names and unknown cars. A run that
 * reports only counts said nothing anybody has to act on.
 */
const finishedWithNotes = (run: FleetGoLiveRunDto): boolean =>
  Object.values(run.outcome ?? {}).some((value) => Array.isArray(value) && value.length > 0);

/**
 * The run this screen is about: the HIGHEST version of its step. `go-live:vehicles:v3` outranks
 * `v2`, whose row is history the owner acted on already.
 */
export const latestRun = (runs: readonly FleetGoLiveRunDto[], step: GoLiveStep): FleetGoLiveRunDto | null => {
  const prefix = `go-live:${step}:v`;
  const mine = runs
    .filter((run) => run.key.startsWith(prefix))
    .sort((a, b) => Number(b.key.slice(prefix.length)) - Number(a.key.slice(prefix.length)));
  return mine[0] ?? null;
};

/** One value of the outcome, as text somebody can copy. */
export const formatValue = (value: unknown): string => {
  if (Array.isArray(value)) return value.map(formatValue).join(' ، ');
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${formatValue(v)}`)
      .join(' · ');
  }
  return String(value);
};

const TONES: Record<State, string> = {
  refused: 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100',
  failed: 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100',
  running: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100',
  done: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
};

export const GoLiveNotice = ({
  step,
  always = false,
}: {
  step: GoLiveStep;
  /** On the report page, a run that finished cleanly is worth a line too — «تم، من غير ملاحظات». */
  always?: boolean;
}): JSX.Element | null => {
  const t = useT();
  const can = useCan();
  // The same two grants the endpoint accepts — whoever may create a car or manage a driver.
  const mayRead = can('fleetVehicle.create') || can('fleetDriver.manage');
  const runs = useFleetGoLiveRuns(mayRead);
  if (!mayRead || runs.data === undefined) return null;
  const run = latestRun(runs.data.runs, step);
  if (run === null) return null;
  const state = runState(run);
  if (state === 'done' && !finishedWithNotes(run) && !always) return null;

  // A key the catalogue does not name is printed as itself — the step's own word beats a blank.
  const fieldLabel = (key: string): string => {
    const label = t(`fleet.goLive.field.${key}`);
    return label === `fleet.goLive.field.${key}` ? key : label;
  };
  const reasonLabel = (reason: string): string => {
    const label = t(`fleet.goLive.reason.${reason}`);
    return label === `fleet.goLive.reason.${reason}` ? reason : label;
  };
  // An empty list says nothing — «deactivated branches: » with nothing after it is a line the
  // reader has to work out is fine. The refusal's `reason` is a code; it is said in words.
  const lines = Object.entries(run.outcome ?? {})
    .filter(([key]) => !STATE_KEYS.has(key))
    .filter(([, value]) => !(Array.isArray(value) && value.length === 0))
    .map(([key, value]): [string, unknown] =>
      key === 'reason' && typeof value === 'string' ? [key, reasonLabel(value)] : [key, value],
    );
  return (
    <div
      role="status"
      data-go-live-notice={step}
      data-go-live-state={state}
      className={`mb-4 rounded-md border px-4 py-3 text-sm ${TONES[state]}`}
    >
      <div className="flex items-center gap-2 font-semibold">
        <AlertIcon className="h-4 w-4 shrink-0" />
        <span>
          {t(`fleet.goLive.step.${step}`)} — {t(`fleet.goLive.state.${state}`)}
        </span>
      </div>
      {lines.length > 0 && (
        <dl className="mt-2 space-y-1 text-xs">
          {lines.map(([key, value]) => (
            <div key={key} className="flex flex-wrap gap-x-2">
              <dt className="font-medium">{fieldLabel(key)}:</dt>
              <dd className="min-w-0 break-words" dir="auto">
                {formatValue(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-2 text-xs opacity-80">{t('fleet.goLive.hint')}</p>
    </div>
  );
};

/** Every step in the order the boot runs them — the report page's whole content. */
const STEPS: readonly GoLiveStep[] = [
  'vehicles',
  'driver-photos',
  'odometer',
  'maintenance',
  'violations',
  'accidents',
];

/**
 * All six runs, on the page the owner goes to when they want to know what the import did — and
 * nowhere else. A step that has never run at all prints nothing, as it always did.
 */
export const GoLiveRunsPanel = (): JSX.Element | null => {
  const t = useT();
  const can = useCan();
  const mayRead = can('fleetVehicle.create') || can('fleetDriver.manage');
  const runs = useFleetGoLiveRuns(mayRead);
  if (!mayRead || runs.data === undefined || runs.data.runs.length === 0) return null;
  return (
    <section data-go-live-panel="">
      <h2 className="mb-1 text-base font-semibold text-slate-900 dark:text-slate-100">
        {t('fleet.goLive.panel.title')}
      </h2>
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">{t('fleet.goLive.panel.hint')}</p>
      {STEPS.map((step) => (
        <GoLiveNotice key={step} step={step} always />
      ))}
    </section>
  );
};
