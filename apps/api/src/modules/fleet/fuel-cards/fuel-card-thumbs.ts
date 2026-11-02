// The fuel card photo's THUMBNAIL (6d) — what a reader of the cards without `fleetFuelCard.reveal`
// sees, because the full photo shows the PIN on its sticker.
//
// Two sources, never a decoded image (the API has no image library, and gets none):
//   · the 406 GO-LIVE photos — thumbnails made once with ImageMagick (`scripts/make-fuel-card-
//     thumbs.sh`) and committed beside them, `fuel-card-photo-thumbs/<name>.jpg` + `manifest.json`.
//     A card's photo has one only when it IS that go-live photo: its file name and byte size are the
//     manifest's (a photo uploaded since, or moved by the repair, keeps its own name and size, so a
//     go-live photo moved with its number keeps its thumbnail);
//   · a photo UPLOADED since — the browser makes the thumbnail with the same parameters and sends it
//     beside the photo; it is checked from its header only (type, pixels, bytes) and stored as its
//     own Files entity (`fuelCardThumb`), linked from the card's `image.thumb`.
// A photo uploaded between the go-live and 6d has neither until an editor who may see the full
// photo opens it — the screen then makes and sends one (`POST /:id/image/thumb`).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ErrorCodes,
  FLEET_FUEL_CARD_THUMB_MAX_BYTES,
  FLEET_FUEL_CARD_THUMB_MAX_SIDE,
} from '@ecms/contracts';
import { AppError } from '../../../shared/errors';
import { type FleetFuelCardImage } from './fuel-card.model';
import { imageHeader, mimeOfHeader } from './image-header';

/** The folder beside the go-live photos. */
export const FUEL_CARD_PHOTO_THUMBS_DIR = 'fuel-card-photo-thumbs';

/**
 * Where the go-live data sits at run time — the same two places `go-live/vehicles.ts` looks (the
 * bundle's `dist/fleet-go-live`, copied by tsup's `publicDir`; the source tree under `tsx`).
 */
const DATA_DIR_CANDIDATES = ['fleet-go-live', '../../../../assets/fleet-go-live'];

interface ManifestEntry {
  sourceBytes: number;
  sourceSha256: string;
  thumbBytes: number;
  width: number;
  height: number;
}
export interface FuelCardThumbManifest {
  version: number;
  params: string;
  files: Record<string, ManifestEntry>;
}

let cached: { dir: string; files: Map<string, ManifestEntry> } | null = null;

/** The go-live thumbnails' manifest, read once; empty when this build has none. */
export const goLiveThumbs = (): { dir: string; files: ReadonlyMap<string, ManifestEntry> } => {
  if (cached !== null) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of DATA_DIR_CANDIDATES) {
    const dir = join(here, candidate, FUEL_CARD_PHOTO_THUMBS_DIR);
    const file = join(dir, 'manifest.json');
    if (!existsSync(file)) continue;
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as FuelCardThumbManifest;
    cached = { dir, files: new Map(Object.entries(manifest.files)) };
    return cached;
  }
  cached = { dir: '', files: new Map() };
  return cached;
};

type PhotoRef = Pick<FleetFuelCardImage, 'fileName' | 'size'> & {
  thumb?: FleetFuelCardImage['thumb'];
};

/**
 * The committed thumbnail of a go-live photo — its absolute path, or `null` when the card's photo
 * is not one (another name, or the same name with other bytes). The path comes only from the
 * manifest's own names, never from a request.
 */
export const goLiveThumbOf = (image: PhotoRef | null | undefined): string | null => {
  if (image == null) return null;
  const { dir, files } = goLiveThumbs();
  const entry = files.get(image.fileName);
  return entry !== undefined && entry.sourceBytes === image.size ? join(dir, image.fileName) : null;
};

/** A thumbnail can be served for this photo. */
export const hasThumb = (image: PhotoRef | null | undefined): boolean =>
  image != null && (image.thumb != null || goLiveThumbOf(image) !== null);

/**
 * A thumbnail the browser sent, checked from its header: JPEG / PNG / WebP, at most
 * `FLEET_FUEL_CARD_THUMB_MAX_SIDE` pixels on a side and `FLEET_FUEL_CARD_THUMB_MAX_BYTES` bytes. The
 * MIME type is the header's, never the client's. 422 `FLEET_FUEL_CARD_THUMB_INVALID` otherwise.
 */
export const validateThumb = (buffer: Buffer): { mime: string; width: number; height: number } => {
  const refuse = (code: string, message: string): AppError =>
    new AppError(ErrorCodes.FLEET_FUEL_CARD_THUMB_INVALID, 422, message, {
      details: [{ field: 'thumb', code, message }],
    });
  if (buffer.byteLength > FLEET_FUEL_CARD_THUMB_MAX_BYTES) {
    throw refuse(
      'BYTES',
      `a thumbnail is at most ${String(FLEET_FUEL_CARD_THUMB_MAX_BYTES)} bytes`,
    );
  }
  const header = imageHeader(buffer);
  if (header === null) throw refuse('TYPE', 'a thumbnail is a JPEG, PNG or WebP image');
  if (
    header.width > FLEET_FUEL_CARD_THUMB_MAX_SIDE ||
    header.height > FLEET_FUEL_CARD_THUMB_MAX_SIDE
  ) {
    throw refuse(
      'SIZE',
      `a thumbnail is at most ${String(FLEET_FUEL_CARD_THUMB_MAX_SIDE)} pixels on a side`,
    );
  }
  return { mime: mimeOfHeader(header), width: header.width, height: header.height };
};

/** The refusal when a thumbnail is required and none was sent. */
export const thumbRequired = (): AppError =>
  new AppError(ErrorCodes.FLEET_FUEL_CARD_THUMB_INVALID, 422, 'a thumbnail part is required', {
    details: [
      { field: 'thumb', code: 'REQUIRED', message: 'a file part named "thumb" is required' },
    ],
  });
