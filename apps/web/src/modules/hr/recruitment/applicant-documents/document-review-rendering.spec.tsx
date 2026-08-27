// What the reviewer is offered, and what they are not.
//
// Three of this component's rules live entirely in the render, so a typecheck sees none of them
// and a screenshot would not catch them going wrong:
//
//   • A SETTLED SLOT SHOWS ITS VERDICT AND NO BUTTONS. Re-deciding is not a review — the server
//     answers 409 — so the screen must not offer it and then apologise.
//   • THE REFUSAL REASON REACHES THE PERSON WHO MUST ACT ON IT. A rejected slot reopens for the
//     candidate (D-APP-7ج), and the note is the whole of what they are being told.
//   • A READER WITHOUT `applicantDocument.review` IS OFFERED NOTHING. The buttons are the only
//     thing the permission gates here; everything else on the row is theirs to read.
//
// The web suite runs with `environment: 'node'` and no jsdom, so nothing clicks: markup comes from
// `renderToStaticMarkup`, and every claim below is about the FIRST paint.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type ApplicantDocumentDto,
  type ApplicantDocumentSetDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../../store/localeSlice';
import { authSlice } from '../../../../store/authSlice';
import { translate } from '../../../../platform/localization/i18n';
import { ApplicantDocumentReview } from './components/ApplicantDocumentReview';

const doc = (over: Partial<ApplicantDocumentDto> = {}): ApplicantDocumentDto => ({
  typeId: 'ty1',
  typeKey: 'nationalId',
  typeName: { ar: 'بطاقة الرقم القومي', en: 'National ID' },
  required: true,
  status: 'pending',
  fileId: 'f1',
  fileName: 'id.pdf',
  fileVersion: 1,
  licenseClass: null,
  uploadedAt: '2026-08-01T00:00:00.000Z',
  reviewedAt: null,
  reviewNote: null,
  mayReplace: false,
  ...over,
});

const set = (over: Partial<ApplicantDocumentSetDto> = {}): ApplicantDocumentSetDto => ({
  id: 's1',
  applicantId: 'a1',
  applicantCode: 'APP-2026-000123',
  applicantName: 'سعاد عبد الرحمن',
  documents: [doc()],
  missing: [],
  complete: false,
  pendingReview: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

const store = (permissions: string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(permissions.map((k) => [k, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

const render = (
  value: ApplicantDocumentSetDto,
  permissions: string[] = ['applicantDocument.review'],
): string =>
  renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ApplicantDocumentReview set={value} />
      </QueryClientProvider>
    </Provider>,
  );

const t = (key: string): string => translate('ar', key);

/**
 * «there is nothing to click here», asserted on the ELEMENTS rather than on the labels.
 *
 * Matching the label was the obvious way and it is wrong in Arabic: «قبول» (accept) is a substring
 * of «مقبول» (accepted), so a settled slot showing its own verdict reads as though it still
 * offered the button. The component renders a `Button` only where a decision is on offer, so the
 * absence of one is the claim being made, and it is exact.
 */
const hasControls = (markup: string): boolean => markup.includes('<button');

describe('a slot that is still waiting', () => {
  it('offers both decisions to a reviewer', () => {
    const markup = render(set());
    expect(markup).toContain(t('hr.applicantDocuments.accept'));
    expect(markup).toContain(t('hr.applicantDocuments.reject'));
  });

  it('says it is waiting, and names the file and its version', () => {
    const markup = render(set());
    expect(markup).toContain(t('hr.applicantDocuments.status.pending'));
    expect(markup).toContain('id.pdf');
    expect(markup).toContain(translate('ar', 'hr.applicantDocuments.version', { n: '1' }));
  });

  /** The reason field is a SECOND step. Offering it up front would suggest refusing is the default. */
  it('does not show the reason field until refusing is chosen', () => {
    expect(render(set())).not.toContain(t('hr.applicantDocuments.rejectReason'));
  });
});

describe('a slot that has been settled', () => {
  it.each(['accepted', 'rejected'] as const)('shows the %s verdict and no buttons', (status) => {
    const markup = render(set({ documents: [doc({ status, reviewedAt: '2026-08-02T00:00:00.000Z' })] }));
    expect(markup).toContain(t(`hr.applicantDocuments.status.${status}`));
    expect(hasControls(markup)).toBe(false);
  });

  /**
   * The note is not decoration: a rejected slot reopens for the candidate, and this is the whole
   * of what they are being asked to fix. Losing it would leave «ارفع واحدة تانية» with no why.
   */
  it('carries the refusal reason through', () => {
    const markup = render(
      set({ documents: [doc({ status: 'rejected', reviewNote: 'الصورة غير واضحة' })] }),
    );
    expect(markup).toContain('الصورة غير واضحة');
  });
});

describe('what the permission gates', () => {
  /** Not «no screen» — a reader may still read. It is the DECISIONS that are not theirs. */
  it('offers no decision to a reader who cannot review, but shows the document', () => {
    const markup = render(set(), ['applicantDocument.view']);
    expect(markup).toContain('id.pdf');
    expect(markup).toContain(t('hr.applicantDocuments.status.pending'));
    expect(hasControls(markup)).toBe(false);
    // And the reviewer's own view of the same row DOES offer them — or the assertion above
    // would pass just as well against a component that rendered no buttons for anybody.
    expect(hasControls(render(set()))).toBe(true);
  });
});

describe('what has not been handed in', () => {
  it('is listed when something is outstanding', () => {
    const markup = render(
      set({
        missing: [
          {
            typeId: 'ty2',
            typeKey: 'photo',
            typeName: { ar: 'صورة شخصية', en: 'Photo' },
            required: true,
            licenseClassRequired: false,
            order: 2,
          },
        ],
      }),
    );
    expect(markup).toContain(t('hr.applicantDocuments.stillMissing'));
    expect(markup).toContain('صورة شخصية');
  });

  /** An empty «not handed in yet» block reads as a finding. Silence is the correct answer. */
  it('is absent when nothing is', () => {
    expect(render(set())).not.toContain(t('hr.applicantDocuments.stillMissing'));
  });
});
