// The go-live FUEL CARDS, as a boot step — the owner's two sheets of cards («عاوز اضيف دول عندى فى
// شاشة البطاقات») onto the fuel-cards screen, with their balances and passwords.
//
// The shape of every go-live step (`vehicles.ts` at length): refusals before the claim, the lease,
// not on the boot's critical path, nothing here can fail a boot. What the sheets say, and where
// each card goes, is in `fuel-cards-import.ts`.
//
// IT WAITS FOR THE CARS. A card goes on a car by its code, and the codes are the registry's after
// the second cars export (`go-live:vehicle-changes:v1`), so both car runs must be done first.
//
// IT IS IDEMPOTENT BY CARD NUMBER: a re-run after the lease is taken over finds every card already
// written under «already there» and writes only the rest.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env, isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { userService } from '../../../platform/users';
import { FleetFuelCardModel } from '../fuel-cards/fuel-card.model';
import { FleetVehicleModel } from '../vehicles/vehicle.model';
import {
  applyFuelCards,
  FUEL_CARDS_FILE,
  parseFuelCards,
  planFuelCards,
} from './fuel-cards-import';
import {
  claimGoLiveRun,
  finishGoLiveRun,
  recordGoLiveFailure,
  recordGoLiveRefusal,
  waitForGoLiveRuns,
} from './go-live-run.model';
import { VEHICLE_CHANGES_GO_LIVE_MARK } from './vehicle-changes';
import { resolveGoLiveDataDir, VEHICLE_GO_LIVE_MARK } from './vehicles';

/** The run key — versioned like every go-live step's. */
export const FUEL_CARDS_GO_LIVE_MARK = 'go-live:fuel-cards:v1';

/** Four hundred cards is seconds; thirty minutes is «certainly dead». */
export const FUEL_CARDS_GO_LIVE_LEASE_MS = 30 * 60 * 1000;

const REPORT_CAP = 25;

/**
 * Run the step, once, and report. Exported so a test can await it; the boot uses
 * `startFuelCardsGoLive` below, which is this without the waiting.
 */
export const runFuelCardsGoLive = async (dataDir?: string): Promise<void> => {
  const dir = dataDir ?? resolveGoLiveDataDir();
  if (dir === null) {
    logger.error(
      'fleet go-live: the go-live data is not in this build — apps/api/assets/fleet-go-live is missing, so no fuel card was imported',
    );
    return;
  }
  const file = join(dir, FUEL_CARDS_FILE);
  if (!existsSync(file)) {
    logger.error(
      { file },
      'fleet go-live: the fuel-card sheets are not in this build — nothing was imported and the run is NOT claimed',
    );
    return;
  }

  const parsed = parseFuelCards(JSON.parse(await readFile(file, 'utf8')));
  if (parsed.rejected.length > 0) {
    logger.error(
      { rejected: parsed.rejected },
      'fleet go-live: fuel-card rows that are not cards — nothing was imported and the run is NOT claimed, so a corrected build will import them',
    );
    await recordGoLiveRefusal(FUEL_CARDS_GO_LIVE_MARK, {
      reason: 'rejected-rows',
      rows: parsed.rejected.slice(0, REPORT_CAP),
    });
    return;
  }

  if (!(await waitForGoLiveRuns([VEHICLE_GO_LIVE_MARK, VEHICLE_CHANGES_GO_LIVE_MARK]))) {
    logger.error(
      'fleet go-live: the cars are not imported yet — the fuel cards wait for the next boot; the run is NOT claimed',
    );
    await recordGoLiveRefusal(FUEL_CARDS_GO_LIVE_MARK, { reason: 'cars-not-imported' });
    return;
  }

  const admin = await userService.findByEmail(env.SEED_ADMIN_EMAIL);
  if (admin === null) {
    logger.error(
      { email: env.SEED_ADMIN_EMAIL },
      'fleet go-live: no seeded admin to author the fuel cards — run the seed first; nothing was imported and the run is NOT claimed',
    );
    await recordGoLiveRefusal(FUEL_CARDS_GO_LIVE_MARK, {
      reason: 'no-admin',
      email: env.SEED_ADMIN_EMAIL,
    });
    return;
  }

  // THE CLAIM. Either this process holds the lease from here, or the job is done / somebody
  // else's — and in both of those cases there is nothing for this boot to do.
  if (!(await claimGoLiveRun(FUEL_CARDS_GO_LIVE_MARK, FUEL_CARDS_GO_LIVE_LEASE_MS))) return;

  // Read AFTER the claim, so the plan sees every card a lease-holder before us managed to write.
  const vehicles = await FleetVehicleModel.find({ isDeleted: false }, { code: 1 }).lean().exec();
  const cards = await FleetFuelCardModel.find(
    { isDeleted: false },
    { number: 1, vehicleId: 1, company: 1 },
  )
    .lean()
    .exec();
  const plan = planFuelCards(
    parsed.rows,
    new Map(vehicles.map((vehicle) => [vehicle.code, String(vehicle._id)])),
    new Set(cards.map((card) => card.number)),
    new Set(
      cards.flatMap((card) =>
        card.vehicleId == null ? [] : [`${String(card.vehicleId)}|${card.company}`],
      ),
    ),
  );

  logger.info({ cards: plan.create.length }, 'fleet go-live: writing the fuel cards');
  const outcome = await applyFuelCards(plan, String(admin._id));
  const counts = {
    rows: parsed.rows.length,
    created: outcome.created,
    onNoCar: plan.create.filter((card) => card.vehicleId === null).length,
    alreadyThere: plan.alreadyThere.length,
    unknownCodes: plan.unknownCodes,
    carTaken: plan.carTaken,
  };
  if (outcome.failures.length > 0) {
    // NOT finished — the lease is left to expire and the next boot takes the job over, finding
    // every card written so far by its number.
    await recordGoLiveFailure(FUEL_CARDS_GO_LIVE_MARK, {
      ...counts,
      failed: outcome.failures.length,
      failures: outcome.failures.slice(0, REPORT_CAP),
    });
    logger.error(
      { count: outcome.failures.length, failures: outcome.failures },
      'fleet go-live: fuel cards finished WITH FAILURES — the run is left unfinished and will be retried by the next boot once its lease expires',
    );
    return;
  }
  await finishGoLiveRun(FUEL_CARDS_GO_LIVE_MARK, counts);
  logger.info(counts, 'fleet go-live: the fuel cards are in — done, and never again');
};

/**
 * What the long-running processes call: start the step and carry on. Not awaited, cannot reject,
 * and skipped under test — all for the reasons `startVehicleGoLive` gives.
 */
export const startFuelCardsGoLive = (): void => {
  if (isTest) return;
  void runFuelCardsGoLive().catch((error: unknown) => {
    logger.error({ err: error }, 'fleet go-live: fuel cards failed — no boot was harmed');
  });
};
