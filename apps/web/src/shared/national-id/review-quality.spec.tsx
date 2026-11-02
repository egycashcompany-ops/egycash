// A photograph the reader could not read must not furnish the form.
//
// HR photographed a real card on the live site in warm light, held a little far. The back came
// back `reject`, and the review filled the form from it anyway: a religion of «ستدم T», a marital
// status of nothing, no expiry. Three wrong answers, shown exactly like three read ones — and a
// wrong value in a record is harder to notice than an empty box, because an empty box is
// obviously unfinished.
//
// So this pins both halves of the rule: the fields off a rejected side come through EMPTY, and the
// screen says which side to photograph again and why. The web suite runs with `environment: 'node'`
// and no jsdom, and the review dialog mounts through a portal, so the pieces that carry a rule of
// their own are rendered directly and every claim is about the first paint.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { type Locale, type OcrExtractionDto } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { translate } from '../../platform/localization/i18n';
import { Labelled, QualityNotice } from './NationalIdReviewDialog';
import { SIDE_FIELDS, ocrToMeta, ocrToReview, unreadFields } from './mapping';

const render = (node: JSX.Element, locale: Locale = 'en'): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
    },
  });
  return renderToStaticMarkup(<Provider store={store}>{node}</Provider>);
};

const band = (value: string): { value: string; confidence: 'low' } => ({
  value,
  confidence: 'low',
});

/** What the reader answered for the card HR photographed: a readable front, an unreadable back. */
const read = (quality: OcrExtractionDto['quality']): OcrExtractionDto => ({
  available: true,
  nationalId: band('29001011234567'),
  fullNameAr: band('حسن علي محمد فارس'),
  fullNameEn: null,
  address: band('شارع الجمهورية - طنطا'),
  city: band('طنطا'),
  maritalStatus: band('آنسة'),
  religion: band('ستدم T'),
  nationalIdExpiry: band('2030-01-01'),
  derived: null,
  ...(quality === undefined ? {} : { quality }),
});

describe('a rejected photograph furnishes nothing', () => {
  const rejectedBack = read({
    front: { verdict: 'ok', reasons: [] },
    back: { verdict: 'reject', reasons: ['blurred'] },
  });

  it("leaves every field of the rejected side empty rather than showing the reader's guess", () => {
    const data = ocrToReview(rejectedBack);
    expect(data.religion).toBe('');
    expect(data.maritalStatus).toBe('');
    expect(data.nationalIdExpiry).toBe('');
  });

  it('keeps the side that was readable, the number included', () => {
    const data = ocrToReview(rejectedBack);
    expect(data.nationalId).toBe('29001011234567');
    expect(data.fullNameAr).toBe('حسن علي محمد فارس');
    expect(data.addressLine).toBe('شارع الجمهورية - طنطا');
    // Derived from the number, which survived: the blue box still has something to show.
    expect(data.birthDate).not.toBe('');
  });

  it('empties the front and its number when the FRONT is the rejected side', () => {
    const data = ocrToReview(
      read({
        front: { verdict: 'reject', reasons: ['glare'] },
        back: { verdict: 'ok', reasons: [] },
      }),
    );
    expect(data.fullNameAr).toBe('');
    expect(data.fullNameEn).toBe('');
    expect(data.nationalId).toBe('');
    expect(data.addressLine).toBe('');
    expect(data.birthDate).toBe('');
    // The back was readable, so what it said stands.
    expect(data.maritalStatus).toBe('single');
  });

  it('carries no confidence for a field it left empty — there is nothing to be sure of', () => {
    const meta = ocrToMeta(rejectedBack);
    expect(meta.confidence.religion).toBeUndefined();
    expect(meta.confidence.maritalStatus).toBeUndefined();
    expect(meta.confidence.nationalIdExpiry).toBeUndefined();
    expect(meta.confidence.fullNameAr).toBe('low');
  });

  it('names exactly the fields of the sides that were rejected', () => {
    expect(unreadFields(rejectedBack.quality)).toEqual([...SIDE_FIELDS.back]);
    expect(unreadFields(undefined)).toEqual([]);
    expect(
      unreadFields({ front: { verdict: 'degraded', reasons: ['glare'] } }),
    ).toEqual([]);
  });

  it('fills every field as before when the reader reported no verdict at all', () => {
    const data = ocrToReview(read(undefined));
    expect(data.religion).toBe('ستدم T');
    expect(data.maritalStatus).toBe('single');
  });

  it('fills a DEGRADED side as before — it was read, only not sharply', () => {
    const data = ocrToReview(
      read({ back: { verdict: 'degraded', reasons: ['blurred'] } }),
    );
    expect(data.religion).toBe('ستدم T');
    expect(data.nationalIdExpiry).toBe('2030-01-01');
  });
});

describe('the notice the review shows about a photograph', () => {
  const retake = (): void => undefined;

  it('asks for the rejected side again, and says what was wrong with it', () => {
    const html = render(
      <QualityNotice
        side="back"
        report={{ verdict: 'reject', reasons: ['blurred', 'low_contrast'] }}
        onRetake={retake}
      />,
    );
    expect(html).toContain('The back photo cannot be read');
    expect(html).toContain('too blurred');
    expect(html).toContain('too dark');
    expect(html).toContain(translate('en', 'nationalIdOcr.review.quality.rejectFields'));
    expect(html).toContain('Retake the back');
    expect(html).toContain('border-red-300');
  });

  it('still names a verdict the reader gave no reason for', () => {
    const html = render(
      <QualityNotice side="front" report={{ verdict: 'reject', reasons: [] }} />,
    );
    expect(html).toContain('The front photo cannot be read');
    expect(html).toContain('not clear enough');
    // No way back to the camera was given, so none is offered.
    expect(html).not.toContain('Retake the front');
  });

  it('asks only for a careful look at a degraded side — amber, and no retake', () => {
    const html = render(
      <QualityNotice
        side="back"
        report={{ verdict: 'degraded', reasons: ['glare'] }}
        onRetake={retake}
      />,
    );
    expect(html).toContain('The back photo is not sharp');
    expect(html).toContain('glare on the card');
    expect(html).toContain('bg-amber-50');
    expect(html).not.toContain('Retake the back');
  });

  it('drops a reason code it has no words for, rather than printing the code', () => {
    const html = render(
      <QualityNotice side="back" report={{ verdict: 'reject', reasons: ['moon_phase'] }} />,
    );
    expect(html).not.toContain('moon_phase');
    expect(html).toContain('not clear enough');
  });

  it('says nothing at all about a photograph that read fine', () => {
    expect(render(<QualityNotice side="front" report={{ verdict: 'ok', reasons: [] }} />)).toBe('');
  });

  it('speaks formal Arabic', () => {
    const html = render(
      <QualityNotice
        side="back"
        report={{ verdict: 'reject', reasons: ['blurred'] }}
        onRetake={retake}
      />,
      'ar',
    );
    expect(html).toContain('تعذّرت قراءة صورة الوجه الخلفي');
    expect(html).toContain('الصورة مهزوزة');
    expect(html).toContain('إعادة تصوير الوجه الخلفي');
  });
});

describe('a field left empty says why', () => {
  it('marks the field as not read, and asks for the photograph again', () => {
    const html = render(
      <Labelled id="f" label="Religion" notRead>
        <input id="f" value="" readOnly />
      </Labelled>,
    );
    expect(html).toContain(translate('en', 'nationalIdOcr.review.quality.notRead'));
    expect(html).toContain(translate('en', 'nationalIdOcr.review.quality.notReadBadge'));
  });

  it('says nothing of the sort once the person has typed the value in themselves', () => {
    const html = render(
      <Labelled id="f" label="Religion" edited notRead>
        <input id="f" value="مسلم" readOnly />
      </Labelled>,
    );
    expect(html).not.toContain(translate('en', 'nationalIdOcr.review.quality.notRead'));
    expect(html).toContain(translate('en', 'nationalIdOcr.review.edited'));
  });
});
