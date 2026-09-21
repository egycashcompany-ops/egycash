// The chain panel, rendered for real against the real locale catalogs.
//
// The web suite runs with `environment: 'node'` and carries no jsdom, so nothing here clicks. What
// a render can prove is what this component exists for: that the reader is TOLD things, and told
// them before he acts. A rung nobody stood on must reach the DOM rather than vanish; a decision
// that cancels somebody else's step must be announced while the reader still has the choice; and
// buttons must not be offered to somebody the server would refuse.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import {
  type ApprovalOutcome,
  type ApprovalTrailDto,
  type ApprovalTrailEntryDto,
  type Locale,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { ApprovalChainPanel } from './ApprovalChainPanel';

const entry = (
  level: ApprovalTrailEntryDto['level'],
  outcome: ApprovalOutcome,
  over: Partial<ApprovalTrailEntryDto> = {},
): ApprovalTrailEntryDto => ({
  permissionKey: 'leave.approve',
  level,
  label: null,
  outcome,
  decidedBy: null,
  decidedAt: null,
  comment: null,
  overriddenWith: null,
  ...over,
});

const trail = (over: Partial<ApprovalTrailDto> = {}): ApprovalTrailDto => ({
  requestType: 'hr.leave',
  workflowId: 'wf1',
  steps: [entry('unit', 'pending'), entry('department', 'pending'), entry('organization', 'pending')],
  currentStep: 0,
  viewerMayDecide: false,
  viewerStep: null,
  viewerCovers: [],
  viewerMayOverride: false,
  ...over,
});

const render = (node: JSX.Element, locale: Locale = 'ar'): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
    },
  });
  return renderToStaticMarkup(<Provider store={store}>{node}</Provider>);
};

describe('a request with no configured chain', () => {
  it('draws nothing at all — an empty chain and no chain are different facts', () => {
    expect(render(<ApprovalChainPanel trail={null} />)).toBe('');
  });

  it('says so plainly when the chain resolved to no steps', () => {
    const markup = render(<ApprovalChainPanel trail={trail({ steps: [], currentStep: null })} />);
    expect(markup).toContain('لا يوجد مسار موافقة');
  });
});

describe('what the reader is shown about the chain', () => {
  it('draws every rung, in order, and marks the one it is waiting on', () => {
    const markup = render(<ApprovalChainPanel trail={trail()} />);
    expect(markup).toContain('مدير الإدارة في الفرع');
    expect(markup).toContain('المدير العام للإدارة');
    expect(markup).toContain('على مستوى الشركة');
    expect(markup).toContain('الطلب متوقف هنا الآن');
  });

  // The three «nobody decided this» outcomes are the reason the trail exists in this shape: a
  // reader asking «ليه راح للموارد البشرية على طول؟» is asking about a rung that is not there, and
  // a panel that omitted it would answer nothing.
  it('draws a rung nobody stood on, and says WHICH of the three reasons applies', () => {
    const markup = render(
      <ApprovalChainPanel
        trail={trail({
          steps: [
            entry('unit', 'skipped'),
            entry('department', 'covered'),
            entry('organization', 'approved', { decidedBy: { id: 'u1', name: 'صلاح' } }),
          ],
          currentStep: null,
        })}
      />,
    );
    expect(markup).toContain('لا أحد يشغل هذه الخطوة');
    expect(markup).toContain('أُلغيت بقرار أعلى منها');
    expect(markup).toContain('صلاح');
  });

  it('distinguishes a rung a rejection never reached from one nobody holds', () => {
    const markup = render(
      <ApprovalChainPanel
        trail={trail({
          steps: [entry('unit', 'rejected'), entry('department', 'unreached')],
          currentStep: null,
        })}
      />,
    );
    expect(markup).toContain('لم يبلغها الطلب');
    expect(markup).not.toContain('لا أحد يشغل هذه الخطوة');
  });

  it('prefers the chain’s own caption over the level, when one was written', () => {
    const markup = render(
      <ApprovalChainPanel
        trail={trail({
          steps: [entry('unit', 'pending', { label: { ar: 'مدير حركة المهندسين', en: 'x' } })],
          currentStep: 0,
        })}
      />,
    );
    expect(markup).toContain('مدير حركة المهندسين');
  });

  it('never invents a job title for a rung that carries no caption', () => {
    // The chain stores a key and a level and nothing else. Naming a person or a post here would
    // put a name on an authority the engine deliberately refuses to name.
    const markup = render(<ApprovalChainPanel trail={trail()} />);
    expect(markup).toContain('leave.approve');
    expect(markup).toContain('organization');
  });
});

describe('what the reader is told before he acts', () => {
  it('warns that approving early cancels the steps below — before the buttons, not after', () => {
    const markup = render(
      <ApprovalChainPanel
        trail={trail({ viewerMayDecide: true, viewerStep: 1, viewerCovers: [0] })}
        actions={<button type="button" id="decide-here" />}
      />,
    );
    expect(markup).toContain('تُلغي 1 خطوة تحتها');
    expect(markup.indexOf('تُلغي')).toBeLessThan(markup.indexOf('decide-here'));
    expect(markup).toContain('هذه الخطوة خطوتك');
  });

  it('says nothing about cancelling when it is simply his turn', () => {
    const markup = render(
      <ApprovalChainPanel trail={trail({ viewerMayDecide: true, viewerStep: 0 })} />,
    );
    expect(markup).not.toContain('تُلغي');
  });

  it('tells somebody stepping into a chain he is not on that it will be recorded', () => {
    const markup = render(
      <ApprovalChainPanel
        trail={trail({ viewerMayOverride: true })}
        actions={<button type="button" id="decide-here" />}
      />,
    );
    expect(markup).toContain('صلاحية التجاوز');
    expect(markup).toContain('decide-here');
  });

  it('offers no buttons at all to a reader the chain gives no say', () => {
    const markup = render(
      <ApprovalChainPanel trail={trail()} actions={<button type="button" id="decide-here" />} />,
    );
    expect(markup).not.toContain('decide-here');
  });

  it('shows the override permission on the rung it was used on', () => {
    const markup = render(
      <ApprovalChainPanel
        trail={trail({
          steps: [entry('unit', 'approved', { overriddenWith: 'approval.override' })],
          currentStep: null,
        })}
      />,
    );
    expect(markup).toContain('approval.override');
  });
});

describe('the panel asks for no missing translation key', () => {
  for (const locale of ['ar', 'en'] as Locale[]) {
    it(`resolves every label — ${locale}`, () => {
      const markup = render(
        <ApprovalChainPanel
          trail={trail({
            steps: [
              entry('unit', 'skipped'),
              entry('branch', 'covered'),
              entry('department', 'rejected'),
              entry('organization', 'unreached'),
            ],
            currentStep: null,
            viewerMayOverride: true,
          })}
        />,
        locale,
      );
      // `translate()` falls back to the key, so an unresolved label appears verbatim.
      expect(markup).not.toContain('approvals.');
    });
  }
});
