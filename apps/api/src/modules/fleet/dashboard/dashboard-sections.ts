// The section registry (plan §5.2) — how R1 and R2 decide what to compute and survive what fails.
//
// Each section declares three things and nothing else:
//   · its GATE — the contracts' `FLEET_DASHBOARD_GATES` entry: the API key its data comes from AND
//     the route guard of the screen its figure links to (R-28). Both are required;
//   · its SCOPE — `'screen'` (the reader's `scopeSelector`, for the branch-scoped screens: vehicles,
//     roster, licensing) or `'company+set'` (no permission scope, narrowed only by the vehicle set),
//     R-27. Declared for the reader of this file and pinned by the specs; the compute uses it;
//   · its COMPUTE — a call into the module that owns the screen, with the query that screen sends.
//
// A section the reader may not see is `null` and its compute is NEVER called (no query, no 403, no
// audit row). The permitted ones run together under `Promise.allSettled`: one that throws is `null`,
// is named in `unavailable`, is logged, and takes nothing else down. One structured log line per read
// records each section's duration.
import { FLEET_DASHBOARD_GATES, type FleetDashboardGate } from '@ecms/contracts';
import { logger } from '../../../infrastructure/logging/logger';
import { type DashboardContext } from './dashboard-context';

export type SectionScope = 'screen' | 'company+set';

export interface DashboardSection<K extends keyof typeof FLEET_DASHBOARD_GATES, V> {
  readonly key: K;
  readonly scope: SectionScope;
  readonly compute: (dctx: DashboardContext) => Promise<V>;
}

/** The gate a section is judged by — always the contracts' table, never a local copy. */
export const gateOf = (key: keyof typeof FLEET_DASHBOARD_GATES): FleetDashboardGate =>
  FLEET_DASHBOARD_GATES[key];

/** A registry entry, typed by its key so its value lands in the DTO field of the same name. */
export const section = <K extends keyof typeof FLEET_DASHBOARD_GATES, V>(
  key: K,
  scope: SectionScope,
  compute: (dctx: DashboardContext) => Promise<V>,
): DashboardSection<K, V> => ({ key, scope, compute });

export interface SectionsOutcome<K extends string> {
  /** Every registered key: the value, or `null` (not permitted, or failed). */
  values: Record<K, unknown>;
  /** The permitted sections that threw, in registry order. */
  unavailable: K[];
}

/** Monotonic milliseconds for the timing log — a duration, never a date. */
const tick = (): number => performance.now();

/**
 * Runs the PERMITTED sections together and collects the rest as `null`.
 *
 * `read` names the read in the log line ('now' | 'period'). Nothing about a failure reaches the
 * reader beyond the section's name in `unavailable`; the error itself goes to the log.
 */
export const runSections = async <K extends keyof typeof FLEET_DASHBOARD_GATES>(
  read: 'now' | 'period',
  dctx: DashboardContext,
  sections: readonly DashboardSection<K, unknown>[],
): Promise<SectionsOutcome<K>> => {
  const values = {} as Record<K, unknown>;
  const durations: Record<string, number> = {};
  const permitted = sections.filter((entry) => {
    const allowed = dctx.permits(entry.key);
    if (!allowed) values[entry.key] = null;
    return allowed;
  });
  const started = tick();
  const settled = await Promise.allSettled(
    permitted.map(async (entry) => {
      const begin = tick();
      try {
        return await entry.compute(dctx);
      } finally {
        durations[entry.key] = Math.round(tick() - begin);
      }
    }),
  );
  const unavailable: K[] = [];
  settled.forEach((result, index) => {
    const entry = permitted[index] as DashboardSection<K, unknown>;
    if (result.status === 'fulfilled') {
      values[entry.key] = result.value;
      return;
    }
    values[entry.key] = null;
    unavailable.push(entry.key);
    logger.error(
      { err: result.reason as unknown, read, section: entry.key },
      'fleet dashboard section failed',
    );
  });
  logger.info(
    {
      read,
      today: dctx.today,
      branchId: dctx.branchId,
      totalMs: Math.round(tick() - started),
      sections: durations,
      skipped: sections.length - permitted.length,
      unavailable,
    },
    'fleet dashboard read',
  );
  return { values, unavailable };
};
