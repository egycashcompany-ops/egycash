// The step bar's whole job is answering "how far along is this candidate?" at a glance, so the
// three things that must never be wrong are: the pipeline is complete, exactly one step is current,
// and everything before it reads as done. All three are silent failures in a screenshot.
//
// The fourth is newer and was a real bug: the bar takes the candidate's stage AND the stage of the
// screen it sits on, and it must draw the FIRST. Opening somebody from the interview queue while an
// offer is already out used to show them at «interview» — the bar was told the page's name and had
// nothing else to draw with.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { RECRUITMENT_STAGE_KINDS, type Locale } from '@ecms/contracts';
import { localeSlice } from '../../../../store/localeSlice';
import { RecruitmentStepBar } from './RecruitmentStepBar';

type Kind = (typeof RECRUITMENT_STAGE_KINDS)[number];

/** `viewing` defaults to the candidate's own stage — the common case, where the two coincide. */
const render = (current: Kind | null, locale: Locale = 'en', viewing?: Kind): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: { locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) } },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <RecruitmentStepBar current={current} viewing={viewing ?? current ?? 'applicants'} />
    </Provider>,
  );
};

describe('RecruitmentStepBar', () => {
  it('shows the whole pipeline, not just the stage you are on', () => {
    const markup = render('interview');
    for (const label of ['Applicant', 'Screening', 'Interview', 'Evaluation', 'Job offer', 'Ready to hire']) {
      expect(markup, `missing step: ${label}`).toContain(label);
    }
  });

  it('marks exactly one step as current', () => {
    for (const kind of RECRUITMENT_STAGE_KINDS) {
      const matches = render(kind).match(/aria-current="step"/g) ?? [];
      expect(matches.length, `${kind} did not mark exactly one current step`).toBe(1);
    }
  });

  it('ticks the steps already behind the candidate and no others', () => {
    // Third of six: two ticks behind it, three plain numbers ahead.
    const ticks = (render('interview').match(/<svg/g) ?? []).length;
    expect(ticks).toBe(2);
    expect((render('applicants').match(/<svg/g) ?? []).length).toBe(0);
    expect((render('employeesReady').match(/<svg/g) ?? []).length).toBe(5);
  });

  it('draws where the CANDIDATE stands, not the screen it is sitting on', () => {
    // Opened from the interview queue on somebody who already has an offer out.
    const markup = render('jobOffer', 'en', 'interview');
    // Exactly one current step, and it is theirs.
    expect((markup.match(/aria-current="step"/g) ?? []).length).toBe(1);
    // Four ticks: everything before `jobOffer`. If the bar were drawing the viewed stage it would
    // be two, which is precisely the bug this covers.
    expect((markup.match(/<svg/g) ?? []).length).toBe(4);
  });

  it('still says which stage you are standing on', () => {
    const markup = render('jobOffer', 'en', 'interview');
    expect(markup).toContain('Viewing this stage');
  });

  it('says it once, and only when the two differ', () => {
    const together = render('interview', 'en', 'interview');
    expect(together).not.toContain('Viewing this stage');
  });

  it('falls back to the viewed stage while the candidate’s is still unknown', () => {
    // `null` is the loading state, and a bar that guessed would be worse than one that waits.
    const markup = render(null, 'en', 'evaluation');
    expect((markup.match(/aria-current="step"/g) ?? []).length).toBe(1);
    expect((markup.match(/<svg/g) ?? []).length).toBe(3);
  });

  it('is a labelled landmark, in both languages', () => {
    expect(render('screening', 'en')).toContain('aria-label="Recruitment progress"');
    expect(render('screening', 'ar')).toContain('aria-label="مراحل التوظيف"');
  });

  it('leaks no raw translation key', () => {
    for (const locale of ['en', 'ar'] as Locale[]) {
      expect(render('screening', locale)).not.toContain('recruitment.step.');
    }
  });
});
