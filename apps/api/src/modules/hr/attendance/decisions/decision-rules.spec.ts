// The decision rules, pinned. Every one of these is a sentence somebody could be held to in a
// dispute — who was allowed to decide, which days were still open, and who was barred from
// signing off their own work — so each is provable without a database.
import { describe, expect, it } from 'vitest';
import {
  approveProblem,
  dayProblem,
  daysBack,
  decideProblem,
  landsPendingHr,
  revokeProblem,
} from './decision-rules';

const TODAY = new Date(Date.UTC(2026, 10, 17));
const day = (offset: number): Date => new Date(TODAY.getTime() + offset * 86_400_000);

describe('how old is this day', () => {
  it('counts whole days back, and reads a future date as negative', () => {
    expect(daysBack(TODAY, TODAY)).toBe(0);
    expect(daysBack(day(-1), TODAY)).toBe(1);
    expect(daysBack(day(-30), TODAY)).toBe(30);
    expect(daysBack(day(1), TODAY)).toBe(-1);
  });

  it('is unmoved by the DST switch, because both ends are UTC-midnight date-only values', () => {
    // Cairo leaves DST in late October: 2026-10-20 → 2026-11-17 is 28 days however the clocks went.
    expect(daysBack(new Date(Date.UTC(2026, 9, 20)), TODAY)).toBe(28);
  });
});

describe('the manager acts alone, until the day is old enough', () => {
  const back = (n: number, approvalAfterDays = 7) =>
    landsPendingHr({ workDate: day(-n), today: TODAY, approvalAfterDays });

  it('lets a manager decide today and the week behind it on their own authority', () => {
    expect(back(0)).toBe(false);
    expect(back(3)).toBe(false);
  });

  it('puts the BOUNDARY day with the manager and the day after it with HR', () => {
    // Seven days back is still theirs; the eighth is not. Stated explicitly because "7 days" is
    // ambiguous in English and a manager will be told which side of it they are on.
    expect(back(7)).toBe(false);
    expect(back(8)).toBe(true);
  });

  it("follows the branch's own threshold, including zero", () => {
    expect(back(1, 30)).toBe(false);
    expect(back(30, 30)).toBe(false);
    expect(back(31, 30)).toBe(true);
    // Zero is a legitimate posture: every decision goes to HR.
    expect(back(0, 0)).toBe(false);
    expect(back(1, 0)).toBe(true);
  });
});

describe('which days may be decided at all', () => {
  it('allows today — sending somebody home at noon is the ordinary case', () => {
    expect(dayProblem({ workDate: TODAY, today: TODAY, frozen: false })).toBeNull();
    expect(dayProblem({ workDate: day(-200), today: TODAY, frozen: false })).toBeNull();
  });

  it('refuses a day that has not happened', () => {
    // Marking somebody present tomorrow would mint attendance for a day nobody has lived;
    // marking them absent would convict them of missing it.
    expect(dayProblem({ workDate: day(1), today: TODAY, frozen: false })).toMatch(/not happened/);
  });

  it('refuses a frozen day outright, and says what to do instead', () => {
    // Recording a decision that silently does nothing would let a manager believe they had fixed
    // something. Payroll has closed and paid that month; the correction goes forward.
    const problem = dayProblem({ workDate: day(-40), today: TODAY, frozen: true });
    expect(problem).toContain('الشهر مغلق من المرتبات');
    expect(problem).toContain('شهر لاحق');
  });

  it('refuses the future BEFORE it looks at the freeze — a day that has not happened is not frozen', () => {
    expect(dayProblem({ workDate: day(1), today: TODAY, frozen: true })).toMatch(/not happened/);
  });
});

describe('nobody decides their own attendance', () => {
  it('needs the grant', () => {
    expect(decideProblem({ canDecide: false, isSubject: false })).toMatch(/attendance\.decide/);
  });

  it('bars the subject however strong their grant', () => {
    // Enforced here rather than by withholding the grant, exactly as C7 does for leave: the grant
    // is about SCOPE — which employees somebody covers — and a manager naturally covers themselves.
    expect(decideProblem({ canDecide: true, isSubject: true })).toMatch(/your own attendance/);
  });

  it("lets a granted manager decide somebody else's day", () => {
    expect(decideProblem({ canDecide: true, isSubject: false })).toBeNull();
  });
});

describe('the approval step is a second pair of eyes, or it is nothing', () => {
  const base = {
    status: 'pendingHr' as const,
    isSubject: false,
    isAuthor: false,
    canApprove: true,
  };

  it('approves only what is actually waiting', () => {
    expect(approveProblem({ ...base, status: 'applied' })).toMatch(/not waiting/);
    expect(approveProblem({ ...base, status: 'rejected' })).toMatch(/not waiting/);
    expect(approveProblem({ ...base, status: 'revoked' })).toMatch(/not waiting/);
    expect(approveProblem(base)).toBeNull();
  });

  it('needs its own grant, which is not the deciding grant', () => {
    expect(approveProblem({ ...base, canApprove: false })).toMatch(/attendance\.decideApprove/);
  });

  it('bars the manager who made the decision from clearing it', () => {
    // THE WHOLE POINT of the old-day path is that somebody else looks. Letting its author approve
    // it would empty the step of meaning while leaving the paperwork intact.
    expect(approveProblem({ ...base, isAuthor: true })).toMatch(/your own decision/);
  });

  it('bars the subject too', () => {
    expect(approveProblem({ ...base, isSubject: true })).toMatch(/your own attendance/);
  });
});

describe('revoking', () => {
  const base = {
    status: 'applied' as const,
    type: 'markAbsent' as const,
    isSubject: false,
    canDecide: true,
  };

  it('undoes a decision that is in force or still waiting', () => {
    expect(revokeProblem(base)).toBeNull();
    expect(revokeProblem({ ...base, status: 'pendingHr' })).toBeNull();
  });

  it('will not undo what is already undone or refused', () => {
    expect(revokeProblem({ ...base, status: 'revoked' })).toMatch(/in force or awaiting/);
    expect(revokeProblem({ ...base, status: 'rejected' })).toMatch(/in force or awaiting/);
  });

  it('will not revoke a revocation — that record stands', () => {
    // A revocation is the audit trail of an undoing. Undoing the undoing would be a third state
    // nobody can read; recording a fresh decision is how the day changes again.
    expect(revokeProblem({ ...base, type: 'revoke' })).toMatch(/is itself a record/);
  });

  it('needs the deciding grant, and still bars the subject', () => {
    expect(revokeProblem({ ...base, canDecide: false })).toMatch(/attendance\.decide/);
    expect(revokeProblem({ ...base, isSubject: true })).toMatch(/your own attendance/);
  });
});
