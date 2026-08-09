// The expiry sweep (design §4.8, §8.1) — daily at 04:20, warranties and licences in one pass.
//
// It is a pure ANNOUNCER: it changes no business state, derives everything at run time, and writes
// nothing but its own marks (ADR-025). That is the Fleet `licenseExpirySweep` shape, and it is why
// there is no audit row here — nothing was decided, and nobody decided it. IT-3's `slaBreached` is
// audited for the opposite reason: a breach IS stamped on the ticket.
//
// Idempotency comes from the mark key, which embeds the date being announced. A renewal is a new
// date, so it re-arms both announcements by itself — nobody has to remember to clear a flag.
//
// A warn window of 0 disables the EARLY warning only. The `expired` announcement still fires,
// because "this licence has run out" is not a courtesy notice.
import { ItEvents, ItSettingKeys } from '@ecms/contracts';
import { type Types } from 'mongoose';
import { logger } from '../../../infrastructure/logging/logger';
import { emit } from '../../../platform/kernel/event-bus';
import { settingsService } from '../../../platform/settings';
import { ItAssetModel } from '../assets/asset.model';
import { itLicenseRepository } from '../licenses/license.repository';
import { itSoftwareProductRepository } from '../software/product.repository';
import { dayKey, markOnce } from './sweep-mark.model';

/** A bound per run: a sweep is a heartbeat, not a migration. Anything left is taken next tick. */
const BATCH = 500;
const DAY_MS = 86_400_000;

/** Organization scope — a warn window is a company policy, not a user's preference. */
const ORG = { userId: null, branchId: null };

const resolveWarnDays = async (key: string): Promise<number> => {
  const days = await settingsService.resolve<number>(key, ORG);
  return typeof days === 'number' && days >= 0 ? days : 0;
};

/**
 * Warranties whose end has passed, or falls inside the warn window.
 *
 * Backed by `ix_warranty_end`, the sparse index IT-1 shipped in the same commit as the field —
 * an asset with no warranty carries no date and never enters the scan.
 */
const warrantySweep = async (now: Date): Promise<number> => {
  const warnDays = await resolveWarnDays(ItSettingKeys.WarrantyWarnDays);
  const cutoff = new Date(now.getTime() + warnDays * DAY_MS);

  const assets = await ItAssetModel.find(
    {
      isDeleted: false,
      // A disposed asset's warranty is nobody's problem: the machine is gone.
      status: { $ne: 'disposed' },
      'warranty.end': { $lte: cutoff },
    },
    { assetCode: 1, warranty: 1 },
  )
    .limit(BATCH)
    .lean<{ _id: Types.ObjectId; assetCode: string; warranty: { end: Date; vendorId: Types.ObjectId | null } }[]>()
    .exec();

  let announced = 0;
  for (const asset of assets) {
    const end = asset.warranty.end;
    const expired = end.getTime() <= now.getTime();
    if (!expired && warnDays === 0) continue;
    const kind = expired ? 'expired' : 'expiring';
    if (!(await markOnce(`warranty:${kind}:${String(asset._id)}:${dayKey(end)}`))) continue;

    await emit(expired ? ItEvents.AssetWarrantyExpired : ItEvents.AssetWarrantyExpiring, {
      assetId: String(asset._id),
      assetCode: asset.assetCode,
      warrantyEnd: end.toISOString(),
      vendorId: asset.warranty.vendorId === null ? null : String(asset.warranty.vendorId),
    });
    announced += 1;
  }
  return announced;
};

/** The same shape for licences. A perpetual licence has no date and is never selected. */
const licenseSweep = async (now: Date): Promise<number> => {
  const warnDays = await resolveWarnDays(ItSettingKeys.LicenseWarnDays);
  const cutoff = new Date(now.getTime() + warnDays * DAY_MS);
  const licenses = await itLicenseRepository.findExpiringBefore(cutoff, BATCH);

  let announced = 0;
  for (const license of licenses) {
    const expiresAt = license.expiresAt;
    if (expiresAt === null) continue;
    const expired = expiresAt.getTime() <= now.getTime();
    if (!expired && warnDays === 0) continue;
    const kind = expired ? 'expired' : 'expiring';
    if (!(await markOnce(`lic:${kind}:${String(license._id)}:${dayKey(expiresAt)}`))) continue;

    // The product's name travels with the event: a subscriber that had to look it up would need
    // IT's read permissions to render its own notification.
    const product = await itSoftwareProductRepository.findById(String(license.productId));
    await emit(expired ? ItEvents.LicenseExpired : ItEvents.LicenseExpiring, {
      licenseId: String(license._id),
      productId: String(license.productId),
      productName: product?.name ?? '',
      expiresAt: expiresAt.toISOString(),
      seats: license.seats,
    });
    announced += 1;
  }
  return announced;
};

/** §4.8 — one daily pass over both expiring things IT owns. */
export const expirySweep = async (
  now: Date = new Date(),
): Promise<{ warranties: number; licenses: number }> => {
  const warranties = await warrantySweep(now);
  const licenses = await licenseSweep(now);
  if (warranties > 0 || licenses > 0) {
    logger.info({ warranties, licenses }, 'it: expiry announcements emitted');
  }
  return { warranties, licenses };
};
