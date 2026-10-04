// The go-live FUEL CARD PHOTOS, as a boot step — «صوره كل فيزا», one photo per card, named for the
// card's number, attached to that card by the deploy.
//
// The licence scans' shape (`driver-photos.ts`): the same lease, the same refusals before the
// claim, not on the boot's critical path, nothing here can fail a boot.
//
// THE NUMBER IS THE JOIN. The owner sent the photos in a folder per car; each was read for the
// number printed on the card and saved as `<number>.jpg`, the clearest photo showing the card's
// latest date. A number no live card has is reported and skipped — the card is not invented here.
//
// IT WAITS FOR THE CARDS (`go-live:fuel-cards:v1`), which create the cards these photos go on.
//
// IT IS IDEMPOTENT PER CARD: a card that already has a photo — this run's, before a take-over, or
// one the clerk uploaded — is left alone and counted as kept.
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, parse } from 'node:path';
import { env, isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { userService } from '../../../platform/users';
import { type AuthContext } from '../../../shared/types';
import { FleetFuelCardModel } from '../fuel-cards/fuel-card.model';
import { fleetFuelCardService } from '../fuel-cards/fuel-card.service';
import { FUEL_CARDS_GO_LIVE_MARK } from './fuel-cards';
import {
  claimGoLiveRun,
  finishGoLiveRun,
  recordGoLiveFailure,
  recordGoLiveRefusal,
  waitForGoLiveRuns,
} from './go-live-run.model';
import { resolveGoLiveDataDir } from './vehicles';
import { MIME } from './vehicles-import';

/** The run key — versioned like every go-live step's. */
export const FUEL_CARD_PHOTOS_GO_LIVE_MARK = 'go-live:fuel-card-photos:v1';

/** Four hundred photos is a minute or two; thirty minutes is «certainly dead». */
export const FUEL_CARD_PHOTOS_GO_LIVE_LEASE_MS = 30 * 60 * 1000;

/** The folder beside the cards' sheet — one file per card, named `<card number>.jpg`. */
export const FUEL_CARD_PHOTOS_DIR = 'fuel-card-photos';

const REPORT_CAP = 25;

export interface FuelCardPhotoPlan {
  /** Files with a live card to go on, in name order. */
  matched: { file: string; number: string; cardId: string; hasImage: boolean }[];
  /** Files whose number is no live card's. Reported, not attached. */
  unmatched: string[];
  /** Files that are not an image the card takes. A refusal: the build is wrong. */
  notImages: string[];
  /** Numbers under two extensions. A refusal: a card has one photo. */
  duplicates: string[];
}

/**
 * Match the folder to the cards. Pure: a stem is a number, a number is one live card, and every
 * file lands in exactly one of the four lists.
 */
export const planFuelCardPhotos = (
  files: readonly string[],
  cards: ReadonlyMap<string, { cardId: string; hasImage: boolean }>,
): FuelCardPhotoPlan => {
  const plan: FuelCardPhotoPlan = { matched: [], unmatched: [], notImages: [], duplicates: [] };
  const seen = new Set<string>();
  for (const file of [...files].sort()) {
    if (MIME[extname(file).toLowerCase()] === undefined) {
      plan.notImages.push(file);
      continue;
    }
    const number = parse(file).name;
    if (seen.has(number)) {
      plan.duplicates.push(number);
      continue;
    }
    seen.add(number);
    const card = cards.get(number);
    if (card === undefined) plan.unmatched.push(file);
    else plan.matched.push({ file, number, ...card });
  }
  return plan;
};

/**
 * The privileged context the step acts as. `fleetFuelCard.edit` is what the Files service asks
 * Fleet about (ADR-023) before it will plant a photo on a card.
 */
export const fuelCardPhotosContext = (adminId: string): AuthContext => ({
  userId: adminId,
  sessionId: 'go-live:fuel-card-photos',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions: {
    'fleetFuelCard.view': 'organization',
    'fleetFuelCard.edit': 'organization',
    'file.view': 'organization',
    'file.download': 'organization',
  },
  permissionVersion: 0,
  isPrivileged: true,
});

/** Attach every matched photo. One failure does not stop the next card. */
export const applyFuelCardPhotos = async (
  plan: FuelCardPhotoPlan,
  photoDir: string,
  ctx: AuthContext,
): Promise<{ attached: number; kept: number; failures: string[] }> => {
  const outcome = { attached: 0, kept: 0, failures: [] as string[] };
  for (const { file, number, cardId, hasImage } of plan.matched) {
    if (hasImage) {
      outcome.kept += 1;
      continue;
    }
    try {
      const buffer = await readFile(join(photoDir, file));
      await fleetFuelCardService.setImage(ctx, cardId, {
        originalName: file,
        mime: MIME[extname(file).toLowerCase()] as string,
        size: buffer.byteLength,
        buffer,
      });
      outcome.attached += 1;
    } catch (error) {
      outcome.failures.push(`${number}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return outcome;
};

/**
 * Run the step, once, and report. Exported so a test can await it; the boot uses
 * `startFuelCardPhotosGoLive` below, which is this without the waiting.
 */
export const runFuelCardPhotosGoLive = async (dataDir?: string): Promise<void> => {
  const dir = dataDir ?? resolveGoLiveDataDir();
  if (dir === null) {
    logger.error(
      'fleet go-live: the go-live data is not in this build — apps/api/assets/fleet-go-live is missing, so no card photo was attached',
    );
    return;
  }
  const photoDir = join(dir, FUEL_CARD_PHOTOS_DIR);
  if (!existsSync(photoDir)) {
    logger.error(
      { dir: photoDir },
      'fleet go-live: the fuel card photos are not in this build — none was attached and the run is NOT claimed',
    );
    return;
  }
  const files = await readdir(photoDir);

  if (!(await waitForGoLiveRuns([FUEL_CARDS_GO_LIVE_MARK]))) {
    logger.error(
      'fleet go-live: the fuel cards are not imported yet — their photos wait for the next boot; the run is NOT claimed',
    );
    await recordGoLiveRefusal(FUEL_CARD_PHOTOS_GO_LIVE_MARK, { reason: 'cards-not-imported' });
    return;
  }

  const admin = await userService.findByEmail(env.SEED_ADMIN_EMAIL);
  if (admin === null) {
    logger.error(
      { email: env.SEED_ADMIN_EMAIL },
      'fleet go-live: no seeded admin to author the card photos — run the seed first; nothing was attached and the run is NOT claimed',
    );
    await recordGoLiveRefusal(FUEL_CARD_PHOTOS_GO_LIVE_MARK, {
      reason: 'no-admin',
      email: env.SEED_ADMIN_EMAIL,
    });
    return;
  }

  // THE CLAIM. Either this process holds the lease from here, or the job is done / somebody
  // else's — and in both of those cases there is nothing for this boot to do.
  if (!(await claimGoLiveRun(FUEL_CARD_PHOTOS_GO_LIVE_MARK, FUEL_CARD_PHOTOS_GO_LIVE_LEASE_MS))) {
    return;
  }

  // Read AFTER the claim, so a take-over sees every photo the run before it attached.
  const cards = await FleetFuelCardModel.find({ isDeleted: false }, { number: 1, image: 1 })
    .lean()
    .exec();
  const plan = planFuelCardPhotos(
    files,
    new Map(
      cards.map((card) => [
        card.number,
        { cardId: String(card._id), hasImage: card.image != null },
      ]),
    ),
  );
  if (plan.notImages.length > 0 || plan.duplicates.length > 0) {
    // Claimed already, so the lease is left to lapse: the next build carrying a fixed folder
    // takes the job over. Written on the row so it is readable without the log.
    await recordGoLiveFailure(FUEL_CARD_PHOTOS_GO_LIVE_MARK, {
      reason: 'plan',
      notImages: plan.notImages,
      duplicates: plan.duplicates,
    });
    logger.error(
      { notImages: plan.notImages, duplicates: plan.duplicates },
      'fleet go-live: refused — the card photo folder holds a file that is not an image, or one number under two names',
    );
    return;
  }

  logger.info({ photos: plan.matched.length }, 'fleet go-live: attaching the fuel card photos');
  const outcome = await applyFuelCardPhotos(
    plan,
    photoDir,
    fuelCardPhotosContext(String(admin._id)),
  );
  const counts = {
    files: files.length,
    attached: outcome.attached,
    kept: outcome.kept,
    unmatched: plan.unmatched,
  };
  if (outcome.failures.length > 0) {
    await recordGoLiveFailure(FUEL_CARD_PHOTOS_GO_LIVE_MARK, {
      ...counts,
      failed: outcome.failures.length,
      failures: outcome.failures.slice(0, REPORT_CAP),
    });
    logger.error(
      { count: outcome.failures.length, failures: outcome.failures },
      'fleet go-live: card photos finished WITH FAILURES — the run is left unfinished and will be retried by the next boot once its lease expires',
    );
    return;
  }
  await finishGoLiveRun(FUEL_CARD_PHOTOS_GO_LIVE_MARK, counts);
  logger.info(counts, 'fleet go-live: the fuel card photos are in — done, and never again');
};

/**
 * What the long-running processes call: start the step and carry on. Not awaited, cannot reject,
 * and skipped under test — all for the reasons `startVehicleGoLive` gives.
 */
export const startFuelCardPhotosGoLive = (): void => {
  if (isTest) return;
  void runFuelCardPhotosGoLive().catch((error: unknown) => {
    logger.error({ err: error }, 'fleet go-live: fuel card photos failed — no boot was harmed');
  });
};
