// Renders the REAL timeline list against the REAL locale catalogs, for EVERY entry type.
//
// The crash this guards was not about `attempt`: the renderer reads `entry.metadata['attempt']`,
// and entries stored with an empty metadata came back from Mongo without the field at all, so
// `undefined['attempt']` killed the page for every candidate whose history had no interview. The
// schema fix restores the DTO's guarantee; this proves the renderer holds up its end for all 31
// types — that an entry without an attempt renders as itself and is never treated as an interview
// event, and that an entry with one still shows its attempt badge.
//
// Same idiom as `InterviewStatusBadge.spec.tsx`: `renderToStaticMarkup`, no jsdom, no
// testing-library — a contract assertion the data layer cannot make on its own.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configureStore } from '@reduxjs/toolkit';
import {
  RECRUITMENT_TIMELINE_TYPES,
  type Locale,
  type RecruitmentTimelineEntryDto,
  type RecruitmentTimelineType,
} from '@ecms/contracts';
import { localeSlice } from '../../../../../store/localeSlice';
import { RecruitmentTimelineList } from './RecruitmentTimelineList';

/** A contract-shaped entry: everything optional is null, exactly as a bare event arrives. */
const entry = (
  type: RecruitmentTimelineType,
  metadata: Record<string, unknown>,
): RecruitmentTimelineEntryDto => ({
  eventId: `evt-${type}`,
  applicantId: '64b1f0aaaaaaaaaaaaaaaa01',
  applicantCode: 'APP-0001',
  at: '2026-08-03T09:00:00.000Z',
  actorUserId: null,
  actorName: '',
  // An act with nobody behind it — a queue row opened by a decision, an offer expired by the
  // sweep. The renderer must say so rather than leaving the «who» line blank, which is what every
  // entry used to do.
  actorKind: 'system',
  type,
  stage: null,
  fromStatus: null,
  toStatus: null,
  placement: null,
  placementLabel: null,
  entityRef: null,
  reason: null,
  note: null,
  correlationType: 'applicant',
  correlationId: 'corr-1',
  supersededAt: null,
  metadata,
});

const render = (entries: RecruitmentTimelineEntryDto[], locale: Locale): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: { locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) } },
  });
  // The actor's name is resolved from the shared directory cache (`ActorById`), the same way every
  // other stream in the product renders WHO — so the renderer needs a query client. Nothing is
  // fetched here: `renderToStaticMarkup` runs no effects, and an unresolved actor renders nothing.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <Provider store={store}>
        <RecruitmentTimelineList entries={entries} />
      </Provider>
    </QueryClientProvider>,
  );
};

describe('RecruitmentTimelineList — every event type, with and without metadata', () => {
  it('renders every type with an EMPTY metadata without throwing', () => {
    // One render holding all 31 types at once: the bug killed the whole list, not one row.
    expect(() =>
      render(
        RECRUITMENT_TIMELINE_TYPES.map((type) => entry(type, {})),
        'ar',
      ),
    ).not.toThrow();
  });

  for (const locale of ['en', 'ar'] as Locale[]) {
    it(`${locale}: no type leaks a raw translation key when metadata is empty`, () => {
      const leaked = RECRUITMENT_TIMELINE_TYPES.filter((type) =>
        render([entry(type, {})], locale).includes('timeline.type.'),
      );
      expect(leaked, `these types leaked their key in ${locale}`).toEqual([]);
    });
  }

  it('shows no attempt badge for an entry that carries no attempt — any type', () => {
    for (const type of RECRUITMENT_TIMELINE_TYPES) {
      const html = render([entry(type, {})], 'en');
      expect(html, `${type} rendered an attempt badge it does not have`).not.toContain('Attempt');
    }
  });

  it('shows the attempt badge on an interview entry that carries one', () => {
    expect(render([entry('interviewScheduled', { attempt: 2 })], 'en')).toContain('Attempt 2');
  });

  it('renders a NON-interview entry that happens to carry an attempt the same way', () => {
    // The renderer keys off the data, never off the event type — an evaluation re-opened on a
    // second attempt gets the same badge, and nothing is special-cased as "an interview event".
    expect(render([entry('evaluationOpened', { attempt: 3 })], 'en')).toContain('Attempt 3');
  });

  it('ignores a first attempt and a non-numeric attempt rather than mislabelling them', () => {
    expect(render([entry('interviewScheduled', { attempt: 1 })], 'en')).not.toContain('Attempt');
    expect(render([entry('interviewScheduled', { attempt: 'two' })], 'en')).not.toContain('Attempt');
  });

  it('names the actor on every entry — never a blank «who» line', () => {
    // The bug: the actor was drawn from `actorName`, which no recruitment writer ever set, so
    // every projected entry rendered without one. A system act must say «النظام», the candidate's
    // own act must say «المتقدّم», and neither may be silent.
    expect(render([entry('screeningOpened', {})], 'en')).toContain('System');
    expect(render([entry('screeningOpened', {})], 'ar')).toContain('النظام');
    const byCandidate = { ...entry('documentUploaded', {}), actorKind: 'candidate' as const };
    expect(render([byCandidate], 'en')).toContain('The applicant');
    expect(render([byCandidate], 'ar')).toContain('المتقدِّم');
  });

  it('names WHICH round or phase, so two phases opened in one minute are not one event twice', () => {
    // «فُتح التقييم» twice at the same minute was the security check and the medical check, which
    // open together — drawn without the one word that told them apart.
    const security = {
      ...entry('evaluationOpened', {}),
      eventId: 'evt-sec',
      stage: {
        kind: 'evaluation' as const,
        refId: '64b1f0aaaaaaaaaaaaaaaa11',
        key: 'evaluation:64b1f0aaaaaaaaaaaaaaaa11',
        name: { ar: 'الفحص الأمني', en: 'Security check' },
      },
    };
    const medical = {
      ...entry('evaluationOpened', {}),
      eventId: 'evt-med',
      stage: {
        kind: 'evaluation' as const,
        refId: '64b1f0aaaaaaaaaaaaaaaa12',
        key: 'evaluation:64b1f0aaaaaaaaaaaaaaaa12',
        name: { ar: 'الفحص الطبي', en: 'Medical check' },
      },
    };
    const html = render([security, medical], 'ar');
    expect(html).toContain('الفحص الأمني');
    expect(html).toContain('الفحص الطبي');
  });

  it('shows a decision’s result and its reason, not just that a decision happened', () => {
    const decided = {
      ...entry('interviewCompleted', { outcome: 'failed' }),
      reason: 'لم يجتز الاختبار الفني',
    };
    const html = render([decided], 'ar');
    expect(html).toContain('النتيجة');
    expect(html).toContain('غير ناجح');
    expect(html).toContain('لم يجتز الاختبار الفني');
  });

  it('shows a CORRECTION as a correction — the decision that was there and the one that replaced it', () => {
    // A flipped screening used to read exactly like a first decision: the renderer showed the new
    // status and nothing else, so «رُفض» appeared twice in a history and neither line said which
    // was the correction.
    const flipped = {
      ...entry('screeningDecided', {}),
      fromStatus: 'accepted',
      toStatus: 'rejected',
      reason: 'ظهرت مخالفة فى الفحص الأمني',
      actorKind: 'user' as const,
      actorUserId: '64b1f0aaaaaaaaaaaaaaaa99',
    };
    const html = render([flipped], 'ar');
    expect(html).toContain('مقبول');
    expect(html).toContain('مرفوض');
    expect(html).toContain('ظهرت مخالفة فى الفحص الأمني');
  });

  it('does not invent a correction when a status did not change', () => {
    const first = { ...entry('screeningDecided', {}), fromStatus: 'waiting', toStatus: 'accepted' };
    expect(render([first], 'en')).toContain('Accepted');
    const same = { ...entry('interviewCompleted', {}), fromStatus: 'completed', toStatus: 'completed' };
    expect(render([same], 'en')).toContain('Completed');
  });

  it('shows a change as a change — the old value and the new one', () => {
    const html = render(
      [entry('branchChanged', { from: 'فرع المعادي', to: 'فرع مدينة نصر' })],
      'ar',
    );
    expect(html).toContain('فرع المعادي');
    expect(html).toContain('فرع مدينة نصر');
  });

  it('names the paper a file event is about', () => {
    const html = render(
      [
        entry('documentReviewed', {
          documentKey: 'birthCertificate',
          documentName: { ar: 'شهادة الميلاد', en: 'Birth certificate' },
          outcome: 'accepted',
        }),
      ],
      'ar',
    );
    expect(html).toContain('شهادة الميلاد');
    expect(html).toContain('مقبول');
  });

  it('renders entries whose metadata carries unrelated keys', () => {
    // The projected types all store `{ eventId, eventName, ...payload }` — arbitrary shapes the
    // renderer must simply not care about.
    const html = render(
      [entry('screeningDecided', { eventId: 'e1', eventName: 'hr.screening.decided', to: 'approved' })],
      'en',
    );
    expect(html).toContain('Screening decided');
  });
});
