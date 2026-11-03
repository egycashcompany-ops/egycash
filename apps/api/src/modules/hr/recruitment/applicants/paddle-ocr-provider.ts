// Local PaddleOCR provider for the National-ID OCR seam (OQ-30).
//
// Implements `NationalIdOcrProvider` by calling the `nid-ocr` sidecar — a container that carries
// the PP-OCR weights baked in and performs recognition entirely offline. No third-party service,
// no external API: the only network hop is to a host the operator configures, which in the
// supplied compose file is a service on the internal network.
//
// The provider stays deliberately thin. Preprocessing, card geometry, Arabic post-processing and
// confidence banding all live in the sidecar, and everything the CONTRACT owns stays here:
//
//   * `parseNationalId` remains the sole source of birth date, gender and governorate. This
//     provider never returns them — `RawOcrResult` has no place for them, and
//     `extractNationalIdFields` derives them downstream exactly as it always did.
//   * Confidence bands are passed through untouched; the review dialog and its model are
//     unchanged.
//   * Nothing is persisted and nothing is confirmed. A human still reviews every field.
//
// Registration is OPT-IN (`NATIONAL_ID_OCR_URL`). Without it the null stub stays in place and the
// endpoint answers `available: false` exactly as before — an existing deployment that does not run
// the sidecar sees no behaviour change at all.
import { setTimeout as delay } from 'node:timers/promises';
import { OCR_QUALITY_REASONS, OCR_QUALITY_VERDICTS, type OcrSideQualityDto } from '@ecms/contracts';
import { OutboundBlockedError, outboundFetch } from '../../../../infrastructure/http/outbound';
import { logger } from '../../../../infrastructure/logging/logger';
import { fileService } from '../../../../platform/files';
import { type AuthContext } from '../../../../shared/types';
import {
  type NationalIdOcrProvider,
  type OcrInput,
  type RawOcrResult,
} from './national-id-ocr';

/** Confidence bands the sidecar may return; anything else is treated as unusable. */
const BANDS = new Set(['high', 'medium', 'low']);

/** Fields this provider will accept. Mirrors `RawOcrResult`, minus number-derived values. */
const ALLOWED_FIELDS = [
  'nationalId',
  'fullNameAr',
  'fullNameEn',
  'address',
  'city',
  'maritalStatus',
  'religion',
  'nationalIdExpiry',
] as const;

type AllowedField = (typeof ALLOWED_FIELDS)[number];

/** Per-side photo verdict. Describes the photograph (blurred, glare, too small), never the card. */
interface SidecarQuality {
  verdict?: unknown;
  reasons?: unknown;
}

/**
 * What the sidecar answers on `/extract`.
 *
 * Every member is optional and typed loosely ON PURPOSE. The sidecar is a separate process on its
 * own release cadence, so its body is untrusted input, not a shared contract — the same reason
 * `fields` carries `unknown` values that `sanitize` narrows one at a time. A newer sidecar adding
 * a member must not make an older API reject the response, and an older sidecar that omits one
 * must not make this one fail.
 *
 *   * `elapsedMs`      — recognition time, already rounded by the sidecar.
 *   * `quality`        — per side ('front' | 'back'), the actionable verdict: reason codes like
 *                        'too_small' or 'blurred', which say what to change about the PHOTOGRAPH.
 *                        Logged AND returned, sanitised — the review has to know that a side was
 *                        rejected, or it shows the guesses off that side as if they were read.
 *   * `diagnostics`    — per side, counts and coordinates explaining a poor read. Carries no card
 *                        content, by the sidecar's own design. Not consumed here.
 *   * `orientedImages` — each side cut out and turned upright, base64 JPEG. Asked for explicitly.
 *   * `portraitImage`  — the holder's photograph cut from the front, base64 JPEG. Asked for too.
 *
 * The two image members are the only ones that reach the caller, and only through
 * `sanitizeImages`, which admits nothing but a plain base64 JPEG under the size cap. They are
 * never stored and never logged — see `extract`.
 */
interface SidecarResponse {
  fields?: Record<string, { value?: unknown; confidence?: unknown } | undefined>;
  layoutProfile?: string;
  elapsedMs?: number;
  /** Additive in the current sidecar; absent from older ones. Keyed by side: `front` / `back`. */
  quality?: Record<string, SidecarQuality | undefined>;
  /** Geometry and counts only — logged by the sidecar itself, not consumed here. */
  diagnostics?: Record<string, unknown>;
  /** Each side as the reader saw it (cut out, upright), base64 JPEG. Sent when asked for. */
  orientedImages?: Record<string, unknown>;
  /** The holder's photograph cut from the front, base64 JPEG. Sent when asked for. */
  portraitImage?: unknown;
}

/**
 * Largest image the review will accept from the sidecar, in base64 characters. Its previews are
 * capped at 900 px (~150 KB); anything near this size is not a preview and is dropped.
 */
const MAX_IMAGE_BASE64 = 2_000_000;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** A sidecar image as a data URL, or undefined if it is not plainly a base64 JPEG of sane size. */
const asJpegDataUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_IMAGE_BASE64) return undefined;
  if (!BASE64.test(value) || !value.startsWith('/9j/')) return undefined; // '/9j/' = a JPEG's first bytes
  return `data:image/jpeg;base64,${value}`;
};

/** The card as read and the portrait, for the review to show. Untrusted input, like the fields. */
const sanitizeImages = (payload: SidecarResponse): RawOcrResult['images'] => {
  const oriented = payload.orientedImages ?? {};
  const cardFront = asJpegDataUrl(oriented['front']);
  const cardBack = asJpegDataUrl(oriented['back']);
  const portrait = asJpegDataUrl(payload.portraitImage);
  if (cardFront === undefined && cardBack === undefined && portrait === undefined) return undefined;
  return {
    ...(cardFront === undefined ? {} : { cardFront }),
    ...(cardBack === undefined ? {} : { cardBack }),
    ...(portrait === undefined ? {} : { portrait }),
  };
};

/**
 * Log the sidecar's photo verdicts. Safe to log for the same reason the sidecar logs them: reason
 * codes describe the capture, not its holder. A run of `rejected` captures is an operational
 * signal — usually a camera or lighting problem at one desk — that field counts alone would hide.
 */
const logQuality = (payload: SidecarResponse): void => {
  const quality = payload.quality;
  if (quality === undefined || quality === null || typeof quality !== 'object') return;
  const summary: Record<string, { verdict: string; reasons: string[] }> = {};
  for (const [side, report] of Object.entries(quality)) {
    if (report === undefined || report === null) continue;
    summary[side] = {
      verdict: typeof report.verdict === 'string' ? report.verdict : 'unknown',
      reasons: Array.isArray(report.reasons)
        ? report.reasons.filter((reason): reason is string => typeof reason === 'string')
        : [],
    };
  }
  logger.info(
    { quality: summary, elapsedMs: payload.elapsedMs },
    'national-id OCR sidecar read a card',
  );
};

const VERDICTS = new Set<string>(OCR_QUALITY_VERDICTS);
const REASONS = new Set<string>(OCR_QUALITY_REASONS);

/**
 * The photo verdicts, narrowed for the caller. Same untrusted input as `fields`: a verdict this
 * API does not know is dropped whole (not downgraded to `reject`, which would empty the review's
 * fields on nothing but a newer sidecar's vocabulary), and an unknown reason code is dropped from
 * an otherwise good report, because the review turns each code into words and cannot name one it
 * has never heard of.
 */
const sanitizeQuality = (payload: SidecarResponse): RawOcrResult['quality'] => {
  const quality = payload.quality;
  if (quality === undefined || quality === null || typeof quality !== 'object') return undefined;
  const out: { front?: OcrSideQualityDto; back?: OcrSideQualityDto } = {};
  for (const side of ['front', 'back'] as const) {
    const report = quality[side];
    if (report === undefined || report === null) continue;
    const verdict = typeof report.verdict === 'string' ? report.verdict : '';
    if (!VERDICTS.has(verdict)) continue;
    const reasons = Array.isArray(report.reasons)
      ? report.reasons.filter(
          (reason): reason is string => typeof reason === 'string' && REASONS.has(reason),
        )
      : [];
    out[side] = { verdict: verdict as OcrSideQualityDto['verdict'], reasons };
  }
  return out.front === undefined && out.back === undefined ? undefined : out;
};

export interface PaddleOcrProviderOptions {
  /** Base URL of the sidecar, e.g. `http://nid-ocr:8099`. */
  baseUrl: string;
  /** Per-request budget. Recognition is CPU-bound; a stuck request must not hold an API worker. */
  timeoutMs?: number;
  /** Retries for transport failures only — never for a 4xx, which would fail identically. */
  retries?: number;
}

/**
 * Reads the stored card images through the Files service.
 *
 * Uses the CALLER's context, so the existing download authorization applies unchanged: a user who
 * could not download the image cannot have it OCR'd on their behalf. Doing this here — rather than
 * handing the sidecar a file id and a credential — keeps the sidecar with no access to anything.
 */
const readImages = async (
  input: OcrInput,
  ctx: AuthContext,
): Promise<{ front?: string; back?: string }> => {
  const load = async (fileId: string | undefined): Promise<string | undefined> => {
    if (fileId === undefined) return undefined;
    // `readEntityOwnedBuffer` and not `readBuffer`: the generic file-level grant
    // (`file.download` for a private file) is the rule for the GENERIC file surface, and an
    // HR role does not hold it. The scan's entity type is claimed by
    // `hrApplicantCardScanFileAuthorizers`, which re-asks the question against
    // `applicant.create` — so this is a narrower check than the one it replaces, not a wider
    // one, and an unclaimed entity type is refused outright rather than waved through.
    const { buffer } = await fileService.readEntityOwnedBuffer(ctx, fileId);
    return buffer.toString('base64');
  };
  const [front, back] = await Promise.all([load(input.frontFileId), load(input.backFileId)]);
  return { ...(front === undefined ? {} : { front }), ...(back === undefined ? {} : { back }) };
};

/**
 * Keep only fields this provider recognizes, with a usable value and a valid band.
 *
 * The sidecar is a separate process on its own release cadence, so its output is treated as
 * untrusted input rather than as a typed contract. A field the API does not know, or a band it
 * cannot render, is dropped — silently accepting either would surface as a broken review dialog
 * rather than as a clear absence.
 */
const sanitize = (payload: SidecarResponse): RawOcrResult => {
  const result: RawOcrResult = {};
  const fields = payload.fields ?? {};
  for (const name of ALLOWED_FIELDS) {
    const entry = fields[name];
    if (entry === undefined || entry === null) continue;
    const value = typeof entry.value === 'string' ? entry.value.trim() : '';
    const confidence = typeof entry.confidence === 'string' ? entry.confidence : '';
    if (value === '' || !BANDS.has(confidence)) continue;
    result[name as AllowedField] = {
      value,
      confidence: confidence as 'high' | 'medium' | 'low',
    };
  }
  return result;
};

export class PaddleNationalIdOcrProvider implements NationalIdOcrProvider {
  readonly id = 'paddleocr-local';
  readonly available = true;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(options: PaddleOcrProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.retries = options.retries ?? 1;
  }

  /** The caller's context, set per request — see `extractNationalIdFields`. */
  private ctx: AuthContext | null = null;

  withContext(ctx: AuthContext): this {
    this.ctx = ctx;
    return this;
  }

  async extract(input: OcrInput): Promise<RawOcrResult> {
    const ctx = input.actor ?? this.ctx;
    if (ctx === null || ctx === undefined) {
      // Without a caller we cannot authorize the file read, and reading it unauthorized is not an
      // option. Returning nothing degrades to manual entry, which is the safe direction.
      logger.warn('national-id OCR called without an actor; skipping extraction');
      return {};
    }

    let images: { front?: string; back?: string };
    try {
      images = await readImages(input, ctx);
    } catch (error) {
      logger.warn({ err: error }, 'national-id OCR could not read the card images');
      return {};
    }
    if (images.front === undefined && images.back === undefined) return {};

    const body = JSON.stringify({
      ...(images.front === undefined ? {} : { frontImageBase64: images.front }),
      ...(images.back === undefined ? {} : { backImageBase64: images.back }),
      // Ask for the card as read and the portrait, so the review can show them beside the values.
      // An older sidecar ignores these and the review simply shows no images.
      returnOrientedImages: true,
      returnPortrait: true,
    });

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const response = await outboundFetch(`${this.baseUrl}/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.ok) {
          // A 4xx is deterministic — the same payload will fail the same way, so retrying only
          // burns the user's time. A 5xx is worth one more try.
          logger.warn({ status: response.status }, 'national-id OCR sidecar rejected the request');
          if (response.status < 500 || attempt === this.retries) return {};
        } else {
          const payload = (await response.json()) as SidecarResponse;
          logQuality(payload);
          const fields = sanitize(payload);
          const shown = sanitizeImages(payload);
          const quality = sanitizeQuality(payload);
          return {
            ...fields,
            ...(shown === undefined ? {} : { images: shown }),
            ...(quality === undefined ? {} : { quality }),
          };
        }
      } catch (error) {
        // Refused by the outbound policy: a configuration fault, and retrying cannot change it.
        if (error instanceof OutboundBlockedError) return {};
        logger.warn({ err: error, attempt }, 'national-id OCR sidecar unreachable');
        if (attempt === this.retries) return {};
      }
      await delay(250 * (attempt + 1));
    }
    return {};
  }
}
