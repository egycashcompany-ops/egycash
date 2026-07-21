// National-ID OCR seam (Sprint 4.1 plan §6, OQ-30). Image→text extraction depends on a
// capability (ADR-014) that is NOT built this sprint, so it lives behind a provider
// interface with a **null stub** default: registration always works without it, and a
// real provider (or a test double) plugs in later with zero changes to the service.
//
// What IS real here: once a 14-digit number exists (from OCR or manual entry), the birth
// date / gender / governorate derivation and structural validation are deterministic
// (`parseNationalId`, contracts) — no external dependency — and are always applied.
import { parseNationalId, type OcrExtractionDto, type OcrFieldDto } from '@ecms/contracts';

export interface OcrInput {
  frontFileId?: string | undefined;
  backFileId?: string | undefined;
}

/**
 * Raw provider output — every field carries a confidence band; nothing is trusted. A real
 * provider reads the National-ID card front + back together; the number-derived fields
 * (birth date, gender, governorate) are NOT part of this — they are computed downstream.
 */
export interface RawOcrResult {
  nationalId?: OcrFieldDto;
  fullNameAr?: OcrFieldDto;
  /** Suggested English name (transliteration of the Arabic name). */
  fullNameEn?: OcrFieldDto;
  address?: OcrFieldDto;
  city?: OcrFieldDto;
  maritalStatus?: OcrFieldDto;
  religion?: OcrFieldDto;
  nationalIdExpiry?: OcrFieldDto;
}

export interface NationalIdOcrProvider {
  id: string;
  /** `available: false` short-circuits — no provider wired. */
  readonly available: boolean;
  extract(input: OcrInput): Promise<RawOcrResult>;
}

/** The default until a real OCR capability is built: reports unavailable, extracts nothing. */
export const nullNationalIdOcrProvider: NationalIdOcrProvider = {
  id: 'null',
  available: false,
  extract: () => Promise.resolve({}),
};

let provider: NationalIdOcrProvider = nullNationalIdOcrProvider;

export const setNationalIdOcrProvider = (next: NationalIdOcrProvider): void => {
  provider = next;
};

export const getNationalIdOcrProvider = (): NationalIdOcrProvider => provider;

/** Test-only: restore the null stub between suites. */
export const resetNationalIdOcrProvider = (): void => {
  provider = nullNationalIdOcrProvider;
};

/**
 * Orchestrates an OCR attempt into the shape the API returns: run the provider, then —
 * regardless of the provider — deterministically derive birth date / gender / governorate
 * from the number if one was read and is structurally valid. Never persists anything and
 * never confirms identity (a human does that, §2.1 rule 4).
 */
export const extractNationalIdFields = async (input: OcrInput): Promise<OcrExtractionDto> => {
  const active = getNationalIdOcrProvider();
  if (!active.available) {
    return {
      available: false,
      nationalId: null,
      fullNameAr: null,
      fullNameEn: null,
      address: null,
      city: null,
      maritalStatus: null,
      religion: null,
      nationalIdExpiry: null,
      derived: null,
    };
  }
  const raw = await active.extract(input);
  const parsed =
    raw.nationalId !== undefined ? parseNationalId(raw.nationalId.value) : null;
  return {
    available: true,
    nationalId: raw.nationalId ?? null,
    fullNameAr: raw.fullNameAr ?? null,
    fullNameEn: raw.fullNameEn ?? null,
    address: raw.address ?? null,
    city: raw.city ?? null,
    maritalStatus: raw.maritalStatus ?? null,
    religion: raw.religion ?? null,
    nationalIdExpiry: raw.nationalIdExpiry ?? null,
    derived:
      parsed === null
        ? null
        : {
            birthDate: parsed.birthDate.toISOString(),
            gender: parsed.gender,
            governorate: parsed.governorate,
          },
  };
};
