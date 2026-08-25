// The requisition screens, checked by source (P-HR-REQ stage 7).
//
// Three things a runtime test would not catch, and each is a decision rather than a detail:
//
//   1. THE DECISION BUTTONS ARE NOT HIDDEN BEHIND `approve`. Step one belongs to the department's
//      manager BY RELATIONSHIP, and only the server knows who that is — gating the buttons on the
//      key would hide the action from the one person whose step it is.
//   2. THE SCREEN COUNTS NOTHING. `filledCount` is the server's, printed as it arrives.
//   3. EVERY KEY IT PRINTS EXISTS IN BOTH LANGUAGES. A missing Arabic string is a visible defect
//      for every user of this system, not a translation backlog item.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JOB_REQUISITION_PRIORITIES, JOB_REQUISITION_STATUSES } from '@ecms/contracts';
import { translate } from '../../../../platform/localization/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const LIST = code(read('./pages/JobRequisitionsListPage.tsx'));
const DETAIL = code(read('./pages/JobRequisitionDetailPage.tsx'));
const FORM = code(read('./components/RequisitionForm.tsx'));
const ROUTES = code(read('../routes.tsx'));

describe('routing', () => {
  it('mounts the two screens behind jobRequisition.view', () => {
    expect(ROUTES).toContain('path="job-requisitions"');
    expect(ROUTES).toContain('permission="jobRequisition.view"');
    expect(ROUTES).toContain('<JobRequisitionsListPage />');
    expect(ROUTES).toContain('<JobRequisitionDetailPage />');
  });
});

describe('what each action asks for', () => {
  it('gates creating, editing and ending on their own keys', () => {
    expect(LIST).toContain('permission="jobRequisition.create"');
    expect(DETAIL).toContain('permission="jobRequisition.edit"');
    expect(DETAIL).toContain('permission="jobRequisition.approve"');
  });

  it('does NOT hide the decision buttons behind the approve key', () => {
    // The approve/reject block sits outside any `<Can>`: the server decides, and a manager without
    // the key must still see their own step.
    const decisionBlock = DETAIL.slice(DETAIL.indexOf("dto.status === 'pendingManager'"));
    const untilCloseReason = decisionBlock.slice(0, decisionBlock.indexOf('closeReason'));
    expect(untilCloseReason).toContain("t('hr.requisitions.approve')");
    expect(untilCloseReason).not.toContain('<Can');
  });

  it('shows an action only where the status allows it', () => {
    expect(DETAIL).toContain("dto.status === 'draft'");
    expect(DETAIL).toContain('isLive(dto.status)');
    expect(DETAIL).toContain('isTerminal(dto.status)');
  });
});

describe('the screen counts nothing', () => {
  it('prints filledCount as it arrives', () => {
    expect(LIST).toContain('row.filledCount');
    expect(DETAIL).toContain('dto.filledCount');
    for (const source of [LIST, DETAIL]) {
      expect(source).not.toContain('filledCount +');
      expect(source).not.toContain('.length + ');
    }
  });

  it('warns about re-approval without deciding it', () => {
    // The form mirrors the rule to WARN; the save is never blocked by the mirror.
    expect(FORM).toContain('wouldNeedReapproval');
    expect(FORM).toContain('reapprovalWarning');
  });
});

describe('localization', () => {
  // `translate()` falls back to the KEY, so a missing string ships silently as
  // `hr.requisitions.status.filled` on screen — which is what these two cases exist to catch.
  const used = new Set<string>();
  for (const source of [LIST, DETAIL, FORM]) {
    for (const match of source.matchAll(/'(hr\.requisitions\.[a-zA-Z.]+)'/g)) {
      used.add(match[1] as string);
    }
  }

  for (const locale of ['en', 'ar'] as const) {
    it(`resolves every literal key — ${locale}`, () => {
      expect([...used].filter((key) => translate(locale, key) === key)).toEqual([]);
    });

    it(`translates every status and priority the contract declares — ${locale}`, () => {
      // Rendered through template keys, so the literal scan above cannot see them.
      const keys = [
        ...JOB_REQUISITION_STATUSES.map((value) => `hr.requisitions.status.${value}`),
        ...JOB_REQUISITION_PRIORITIES.map((value) => `hr.requisitions.priority.${value}`),
      ];
      expect(keys.filter((key) => translate(locale, key) === key)).toEqual([]);
    });
  }
});
