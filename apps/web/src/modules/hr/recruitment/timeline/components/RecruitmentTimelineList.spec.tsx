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
  return renderToStaticMarkup(
    <Provider store={store}>
      <RecruitmentTimelineList entries={entries} />
    </Provider>,
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
