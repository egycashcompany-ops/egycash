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

interface SidecarResponse {
  fields?: Record<string, { value?: unknown; confidence?: unknown } | undefined>;
  layoutProfile?: string;
}

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
    const { buffer } = await fileService.readBuffer(ctx, fileId);
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
    });

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}/extract`, {
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
          return sanitize((await response.json()) as SidecarResponse);
        }
      } catch (error) {
        logger.warn({ err: error, attempt }, 'national-id OCR sidecar unreachable');
        if (attempt === this.retries) return {};
      }
      await delay(250 * (attempt + 1));
    }
    return {};
  }
}
