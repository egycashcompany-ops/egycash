// The narrowing, exercised where it is cheap.
//
// The cases worth reading are the ones about what a candidate is NOT told: a refused candidate
// gets one word and no progress bar, and every internal stage kind has to land on one of six words
// or this file stops compiling.
import { describe, expect, it } from 'vitest';
import { RECRUITMENT_STAGE_KINDS, type RecruitmentStageKind } from '@ecms/contracts';
import { isTerminalStep, portalStepOf, stepsToDraw } from './portal-step';

describe('D-APP-8 — six words, and no seventh', () => {
  it('maps every internal stage kind to something a candidate may read', () => {
    for (const kind of RECRUITMENT_STAGE_KINDS) {
      expect(portalStepOf('new', kind), kind).toBeTypeOf('string');
    }
  });

  it('calls the evaluation stage «under assessment» and never names the check', () => {
    expect(portalStepOf('new', 'evaluation')).toBe('assessment');
  });

  it('reads a returned candidate as `applied` — an open screening row is undecided', () => {
    expect(portalStepOf('new', 'screening')).toBe('applied');
    expect(portalStepOf('new', 'applicants')).toBe('applied');
  });

  it('floors a candidate with nothing open at `screeningPassed`, because that is why they have an account', () => {
    expect(portalStepOf('new', null)).toBe('screeningPassed');
  });
});

describe('a terminal status wins over any stage row', () => {
  it('says hired', () => {
    expect(portalStepOf('hired', 'interview' as RecruitmentStageKind)).toBe('hired');
  });

  it('says rejected', () => {
    expect(portalStepOf('rejected', 'jobOffer' as RecruitmentStageKind)).toBe('rejected');
  });

  it('gives a withdrawal the same single word — the portal has one way to say «this is over»', () => {
    expect(portalStepOf('withdrawn', null)).toBe('rejected');
  });

  it('knows which two are the end', () => {
    expect(isTerminalStep('hired')).toBe(true);
    expect(isTerminalStep('rejected')).toBe(true);
    expect(isTerminalStep('assessment')).toBe(false);
  });
});

describe('what gets drawn', () => {
  it('draws the six in order for somebody still in the pipeline', () => {
    expect(stepsToDraw('assessment')).toEqual([
      'applied',
      'screeningPassed',
      'interview',
      'assessment',
      'jobOffer',
      'hired',
    ]);
  });

  it('draws ONE word for a refused candidate — not how far they got before being turned down', () => {
    expect(stepsToDraw('rejected')).toEqual(['rejected']);
  });
});
