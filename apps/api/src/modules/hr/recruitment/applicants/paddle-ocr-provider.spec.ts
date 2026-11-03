// The local OCR provider's contract with the seam.
//
// What matters here is not the happy path — it is that every way the sidecar can misbehave
// degrades to "no fields" rather than to bad data or a failed request. National-ID OCR is an
// assist: when it cannot help, the user types the card in, and recruitment continues. A provider
// that threw, or that passed a malformed value through to the review dialog, would turn an
// optional convenience into an outage.
//
// `fetch` and the Files service are stubbed, so these run with no sidecar and no database.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OCR_QUALITY_VERDICTS } from '@ecms/contracts';
import { setOutboundPolicyForTests } from '../../../../infrastructure/http/outbound';

// The outbound policy pins what the environment configured; this spec configured nothing, so it
// pins the fake sidecar itself. The policy has its own spec.
beforeAll(() =>
  setOutboundPolicyForTests({ allowHosts: [], pinnedHosts: ['nid-ocr', 'x'], allowPrivate: false }),
);
afterAll(() => setOutboundPolicyForTests(null));

// `vi.mock` is hoisted above every top-level statement, so the stub has to be created inside
// `vi.hoisted` to exist by the time the factory runs.
// The provider reads through the entity-owned path, not the generic one: the generic file-level
// grant (`file.download` for a private file) is the rule for the GENERIC file surface, and an HR
// role does not hold it — so a registrar could file a card they could never read back. The scan's
// entity type is claimed by `hrApplicantCardScanFileAuthorizers`, which asks `applicant.create`.
const { readEntityOwnedBuffer } = vi.hoisted(() => ({ readEntityOwnedBuffer: vi.fn() }));
vi.mock('../../../../platform/files', () => ({ fileService: { readEntityOwnedBuffer } }));

import { PaddleNationalIdOcrProvider } from './paddle-ocr-provider';
import { type AuthContext } from '../../../../shared/types';

const ctx = { userId: 'u1', permissions: {} } as unknown as AuthContext;
const provider = new PaddleNationalIdOcrProvider({ baseUrl: 'http://nid-ocr:8099/', retries: 0 });

const respond = (body: unknown, status = 200): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: status < 400, status, json: () => Promise.resolve(body) }),
  );
};

beforeEach(() => {
  readEntityOwnedBuffer.mockResolvedValue({ doc: {}, buffer: Buffer.from('image-bytes') });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('PaddleNationalIdOcrProvider — happy path', () => {
  it('maps sidecar fields onto RawOcrResult, preserving the confidence band', async () => {
    respond({
      fields: {
        nationalId: { value: '28709011202408', confidence: 'high' },
        fullNameAr: { value: 'ندى محمد', confidence: 'medium' },
      },
    });
    const result = await provider.extract({ frontFileId: 'f1', actor: ctx });
    expect(result.nationalId).toEqual({ value: '28709011202408', confidence: 'high' });
    expect(result.fullNameAr).toEqual({ value: 'ندى محمد', confidence: 'medium' });
  });

  it('reads the images through the CALLER context, not a standing credential', async () => {
    respond({ fields: {} });
    await provider.extract({ frontFileId: 'f1', backFileId: 'b1', actor: ctx });
    expect(readEntityOwnedBuffer).toHaveBeenCalledTimes(2);
    expect(readEntityOwnedBuffer).toHaveBeenCalledWith(ctx, 'f1');
    expect(readEntityOwnedBuffer).toHaveBeenCalledWith(ctx, 'b1');
  });

  it('sends only the side that was supplied', async () => {
    respond({ fields: {} });
    await provider.extract({ backFileId: 'b1', actor: ctx });
    const [, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { body: string },
    ];
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toHaveProperty('backImageBase64');
    expect(body).not.toHaveProperty('frontImageBase64');
  });

  it('never returns a derived field — parseNationalId owns those', async () => {
    // The sidecar offering them would be a bug; passing them on would create a second source of
    // truth for values the contract computes deterministically.
    respond({
      fields: {
        nationalId: { value: '28709011202408', confidence: 'high' },
        birthDate: { value: '1987-09-01', confidence: 'high' },
        gender: { value: 'female', confidence: 'high' },
        governorate: { value: 'Dakahlia', confidence: 'high' },
      },
    });
    const result = await provider.extract({ frontFileId: 'f1', actor: ctx });
    expect(Object.keys(result)).toEqual(['nationalId']);
  });
});

describe('PaddleNationalIdOcrProvider — untrusted sidecar output', () => {
  it('drops a field with an unknown confidence band', async () => {
    respond({ fields: { fullNameAr: { value: 'ندى', confidence: 'very-sure' } } });
    expect(await provider.extract({ frontFileId: 'f1', actor: ctx })).toEqual({});
  });

  it('drops an empty or whitespace-only value', async () => {
    respond({ fields: { address: { value: '   ', confidence: 'high' } } });
    expect(await provider.extract({ frontFileId: 'f1', actor: ctx })).toEqual({});
  });

  it('drops a non-string value rather than coercing it', async () => {
    respond({ fields: { nationalId: { value: 28709011202408, confidence: 'high' } } });
    expect(await provider.extract({ frontFileId: 'f1', actor: ctx })).toEqual({});
  });

  it('trims surrounding whitespace on values it keeps', async () => {
    respond({ fields: { religion: { value: '  مسلم  ', confidence: 'high' } } });
    const result = await provider.extract({ frontFileId: 'f1', actor: ctx });
    expect(result.religion?.value).toBe('مسلم');
  });

  it('survives a response with no fields at all', async () => {
    respond({});
    expect(await provider.extract({ frontFileId: 'f1', actor: ctx })).toEqual({});
  });

  it('accepts the current sidecar shape, keeping the verdicts it knows', async () => {
    respond({
      fields: { nationalId: { value: '28709011202408', confidence: 'high' } },
      elapsedMs: 812.4,
      layoutProfile: 'egypt-nid',
      quality: {
        // 'rejected' is not a verdict this API knows ('reject' is), so that side is dropped
        // WHOLE — not read as a rejection, which would empty the review's fields on nothing
        // but a newer sidecar's vocabulary. The stray 42 beside a known verdict is dropped too.
        front: { verdict: 'ok', reasons: [], metrics: { sharpness: 412.1 } },
        back: { verdict: 'rejected', reasons: ['blurred', 42], metrics: {} },
      },
      diagnostics: { front: { linesDetected: 9, rotated: 180 } },
    });
    const result = await provider.extract({ frontFileId: 'f1', backFileId: 'b1', actor: ctx });
    expect(result).toEqual({
      nationalId: { value: '28709011202408', confidence: 'high' },
      quality: { front: { verdict: 'ok', reasons: [] } },
    });
  });

  it('tolerates a malformed quality block', async () => {
    respond({ fields: {}, quality: { front: null, back: { verdict: 7, reasons: 'blurred' } } });
    expect(await provider.extract({ frontFileId: 'f1', actor: ctx })).toEqual({});
  });
});

describe('PaddleNationalIdOcrProvider — degradation', () => {
  it('returns nothing when the sidecar is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await provider.extract({ frontFileId: 'f1', actor: ctx })).toEqual({});
  });

  it('returns nothing on a sidecar error status', async () => {
    respond({ error: 'boom' }, 500);
    expect(await provider.extract({ frontFileId: 'f1', actor: ctx })).toEqual({});
  });

  it('does not retry a 4xx — the same payload fails identically', async () => {
    const retrying = new PaddleNationalIdOcrProvider({ baseUrl: 'http://x', retries: 3 });
    respond({ error: 'bad request' }, 400);
    await retrying.extract({ frontFileId: 'f1', actor: ctx });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns nothing when the images cannot be read', async () => {
    readEntityOwnedBuffer.mockRejectedValue(new Error('forbidden'));
    respond({ fields: { nationalId: { value: '28709011202408', confidence: 'high' } } });
    expect(await provider.extract({ frontFileId: 'f1', actor: ctx })).toEqual({});
  });

  it('never calls the sidecar without an actor to authorize the read', async () => {
    respond({ fields: {} });
    expect(await provider.extract({ frontFileId: 'f1' })).toEqual({});
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns nothing when neither side was supplied', async () => {
    respond({ fields: {} });
    expect(await provider.extract({ actor: ctx })).toEqual({});
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// The sidecar answers `quality`, `diagnostics` and `elapsedMs` alongside the fields it always
// returned. `quality` now reaches the review — it has to, or a side the reader could not read
// shows its guesses as if they were read — but `diagnostics` and `elapsedMs` still reach nothing.
//
// So what is pinned here is the FIELDS: whatever shape the new blocks arrive in, a good read comes
// back whole. The sidecar is a separate process on its own release cadence, and a card someone
// photographed well must not stop extracting because the sidecar's quality scorer regressed. What
// survives sanitising beside those fields is a well-formed report or nothing — never the raw block.
describe('PaddleNationalIdOcrProvider — the sidecar‘s additive blocks', () => {
  const fields = {
    nationalId: { value: '28709011202408', confidence: 'high' },
    fullNameAr: { value: 'ندى محمد', confidence: 'medium' },
  };
  const extracted = {
    nationalId: { value: '28709011202408', confidence: 'high' },
    fullNameAr: { value: 'ندى محمد', confidence: 'medium' },
  };

  it('extracts unchanged from a response carrying quality, diagnostics and elapsedMs', async () => {
    respond({
      fields,
      layoutProfile: 'egypt-nid',
      elapsedMs: 1843.2,
      quality: {
        front: { verdict: 'ok', reasons: [], metrics: { cardWidthPx: 1024, sharpness: 182.4 } },
        back: { verdict: 'degraded', reasons: ['glare'], metrics: { glare: 0.21 } },
      },
      diagnostics: {
        front: { lines: 11, boxes: { profile: 6, detector: 5 } },
        back: { lines: 7, boxes: { profile: 7 }, detectionFailed: true },
      },
    });
    // The verdicts come through, without the metrics the review has no use for; the diagnostics
    // and the timing reach nothing at all.
    expect(await provider.extract({ frontFileId: 'f1', backFileId: 'b1', actor: ctx })).toEqual({
      ...extracted,
      quality: {
        front: { verdict: 'ok', reasons: [] },
        back: { verdict: 'degraded', reasons: ['glare'] },
      },
    });
  });

  // Each of these is a different way the block can be wrong, and none of them is about the fields.
  // A `quality` that is a string, an array, null, or an object whose per-side entries are not
  // objects at all — every one must leave the extraction untouched rather than throw out of
  // `sanitize` and degrade the whole read to `{}`.
  it.each([
    ['a string', 'ok'],
    ['an array', ['ok']],
    ['null', null],
    ['a number', 7],
    ['per-side primitives', { front: 'ok', back: 3 }],
    ['per-side nulls', { front: null, back: null }],
    ['reasons that are not a list', { front: { verdict: 'ok', reasons: 'glare' } }],
    ['no metrics at all', { front: { verdict: 'reject' } }],
  ])('still extracts when `quality` is %s', async (_label, quality) => {
    respond({ fields, quality, diagnostics: null, elapsedMs: 'not-a-number' });
    const { quality: reported, ...read } = await provider.extract({
      frontFileId: 'f1',
      actor: ctx,
    });
    expect(read).toEqual(extracted);
    for (const report of Object.values(reported ?? {})) {
      expect(OCR_QUALITY_VERDICTS).toContain(report?.verdict);
      expect(Array.isArray(report?.reasons)).toBe(true);
    }
  });

  // The block being absent is the OLD sidecar's response, which must keep working for exactly as
  // long as someone is still running one.
  it('still extracts when the blocks are absent entirely, as the old sidecar answered', async () => {
    respond({ fields, layoutProfile: 'egypt-nid' });
    expect(await provider.extract({ frontFileId: 'f1', actor: ctx })).toEqual(extracted);
  });

  // A malformed block must not rescue a malformed FIELD. The field rules are unchanged: an
  // unknown confidence band is still dropped, however healthy the quality verdict beside it.
  it('does not let a healthy quality verdict admit a field with a bad band', async () => {
    respond({
      fields: { nationalId: { value: '28709011202408', confidence: 'excellent' } },
      quality: { front: { verdict: 'ok', reasons: [], metrics: {} } },
    });
    const { quality, ...read } = await provider.extract({ frontFileId: 'f1', actor: ctx });
    expect(read).toEqual({});
    expect(quality).toEqual({ front: { verdict: 'ok', reasons: [] } });
  });
});

describe('PaddleNationalIdOcrProvider — card images for the review', () => {
  const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD';

  it('asks the sidecar for the card as read and the portrait', async () => {
    respond({ fields: {} });
    await provider.extract({ frontFileId: 'f1', actor: ctx });
    const [, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { body: string },
    ];
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toMatchObject({ returnOrientedImages: true, returnPortrait: true });
  });

  it('passes the images on as JPEG data URLs', async () => {
    respond({
      fields: { nationalId: { value: '28709011202408', confidence: 'high' } },
      orientedImages: { front: JPEG, back: JPEG },
      portraitImage: JPEG,
    });
    const result = await provider.extract({ frontFileId: 'f1', actor: ctx });
    expect(result.images).toEqual({
      cardFront: `data:image/jpeg;base64,${JPEG}`,
      cardBack: `data:image/jpeg;base64,${JPEG}`,
      portrait: `data:image/jpeg;base64,${JPEG}`,
    });
    expect(result.nationalId?.value).toBe('28709011202408');
  });

  it('drops anything that is not plainly a base64 JPEG', async () => {
    respond({
      fields: {},
      orientedImages: { front: 'iVBORw0KGgo=', back: '<svg onload=alert(1)>' },
      portraitImage: 42,
    });
    const result = await provider.extract({ frontFileId: 'f1', actor: ctx });
    expect(result.images).toBeUndefined();
  });

  it('drops an image too large to be a preview', async () => {
    respond({ fields: {}, portraitImage: `/9j/${'A'.repeat(2_000_001)}` });
    expect((await provider.extract({ frontFileId: 'f1', actor: ctx })).images).toBeUndefined();

  });
});

// What the reader thought of each PHOTOGRAPH, on its way to the review.
//
// Logging it was never enough. On the card HR photographed on the live site the back came back
// `reject` and the review filled the form from it anyway: a religion of «ستدم T», a marital
// status of nothing, no expiry — three wrong answers that look exactly like three read ones. The
// verdict has to travel with the fields so the review can leave that side empty and ask for
// another photograph instead.
//
// It is still untrusted input, so the same rule as the fields applies: a code this API cannot name
// is dropped, because the review turns each code into words and has none for a code it has never
// heard of.
describe('PaddleNationalIdOcrProvider — the photo verdicts', () => {
  const fields = { nationalId: { value: '28709011202408', confidence: 'high' } };
  const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD';

  it('passes a verdict and its reasons through to the review', async () => {
    respond({
      fields,
      quality: {
        front: { verdict: 'ok', reasons: [] },
        back: { verdict: 'reject', reasons: ['blurred', 'low_contrast'] },
      },
    });
    const result = await provider.extract({ frontFileId: 'f1', backFileId: 'b1', actor: ctx });
    expect(result.quality).toEqual({
      front: { verdict: 'ok', reasons: [] },
      back: { verdict: 'reject', reasons: ['blurred', 'low_contrast'] },
    });
  });

  it('drops a reason code it cannot name, keeping the rest of the report', async () => {
    respond({
      fields,
      quality: { back: { verdict: 'degraded', reasons: ['glare', 'moon_phase', 7, null] } },
    });
    const result = await provider.extract({ frontFileId: 'f1', actor: ctx });
    expect(result.quality).toEqual({ back: { verdict: 'degraded', reasons: ['glare'] } });
  });

  it('drops a side whose verdict word it does not know, rather than reading it as a rejection', async () => {
    respond({ fields, quality: { front: { verdict: 'unreadable', reasons: ['blurred'] } } });
    expect((await provider.extract({ frontFileId: 'f1', actor: ctx })).quality).toBeUndefined();
  });

  it('reports no quality at all when the sidecar sends none', async () => {
    respond({ fields });
    expect((await provider.extract({ frontFileId: 'f1', actor: ctx })).quality).toBeUndefined();
  });

  it('carries the verdicts beside the images, not instead of them', async () => {
    respond({
      fields,
      orientedImages: { front: JPEG },
      quality: { front: { verdict: 'degraded', reasons: ['too_small'] } },
    });
    const result = await provider.extract({ frontFileId: 'f1', actor: ctx });
    expect(result.images?.cardFront).toBe(`data:image/jpeg;base64,${JPEG}`);
    expect(result.quality).toEqual({ front: { verdict: 'degraded', reasons: ['too_small'] } });
  });
});
