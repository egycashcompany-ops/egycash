// The step bar's whole job is answering "how far along is this candidate?" at a glance, so the
// three things that must never be wrong are: the pipeline is complete, exactly one step is current,
// and everything before it reads as done. All three are silent failures in a screenshot.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { RECRUITMENT_STAGE_KINDS, type Locale } from '@ecms/contracts';
import { localeSlice } from '../../../../store/localeSlice';
import { RecruitmentStepBar } from './RecruitmentStepBar';

const render = (current: (typeof RECRUITMENT_STAGE_KINDS)[number], locale: Locale = 'en'): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: { locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) } },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <RecruitmentStepBar current={current} />
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
