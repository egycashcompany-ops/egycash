// What the boot-time go-live step did — on the screen it was supposed to fill.
//
// «مفيش عربيات اضافت». Twice, the deploy ran the import and the registry stayed empty, and the
// only account of why was a server log the owner cannot open. The steps now write what they found
// on their own row (`fleet_go_live_runs`), and this prints it where the missing data would have
// been: a refusal with its reasons, a partial run with its failures, a run in progress, or a
// finished run that had something to note. A finished run with nothing to say prints nothing —
// this is a notice, not a status bar.
//
// It prints the row AS IT IS. The reasons are the step's own words (a branch name, a car code, a
// file name, a validation detail) and the whole point is that the owner can copy them to whoever
// fixes the data; translating them into softer sentences would lose the one thing they carry.
import { type FleetGoLiveRunDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { AlertIcon } from '../../../shared/ui/icons';
import { useFleetGoLiveRuns } from '../api/fleet-queries';

export type GoLiveStep = 'vehicles' | 'driver-photos' | 'odometer';

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

export const GoLiveNotice = ({ step }: { step: GoLiveStep }): JSX.Element | null => {
  const t = useT();
  const can = useCan();
  // The same two grants the endpoint accepts — whoever may create a car or manage a driver.
  const mayRead = can('fleetVehicle.create') || can('fleetDriver.manage');
  const runs = useFleetGoLiveRuns(mayRead);
  if (!mayRead || runs.data === undefined) return null;
  const run = latestRun(runs.data.runs, step);
  if (run === null) return null;
  const state = runState(run);
  if (state === 'done' && !finishedWithNotes(run)) return null;

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
