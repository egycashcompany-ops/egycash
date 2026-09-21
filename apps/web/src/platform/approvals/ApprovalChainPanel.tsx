// The approval chain, as the person looking at it needs to read it.
//
// Three questions, in the order people actually ask them: **where is it now**, **who has answered
// so far and what did they say**, and **can I do anything about it**. The rungs are drawn in order
// with the live one marked, because «الطلب واقف عند مين» is the question the screen exists to
// answer and a list that only showed what had happened would leave it unanswered.
//
// A rung nobody stood on is DRAWN, not hidden, and says which of the three reasons applies. Hiding
// them would make a three-rung chain look like a one-rung chain, and the reader asking «ليه راح
// للموارد البشرية على طول؟» would find nothing on the screen that even acknowledges his question.
//
// The buttons come from the server's own reading of the viewer's authority, never from a guess
// here: `viewerMayDecide` is computed against roles and delegations at the moment the request was
// read, and this component only renders it. Two claims it keeps apart, because they are different
// and the second is recorded: deciding EARLY is the viewer's own authority (a general manager
// answering while a branch manager's rung is still waiting), while stepping into a chain he is not
// on at all needs `approval.override` and says so before he presses anything.
import { type ApprovalTrailDto, type ApprovalOutcome } from '@ecms/contracts';
import { useT } from '../localization/useT';
import { Badge, Card, CardBody, type Tone } from '../../shared/ui';

const TONE: Record<ApprovalOutcome, Tone> = {
  approved: 'success',
  rejected: 'danger',
  pending: 'warning',
  skipped: 'neutral',
  covered: 'neutral',
  unreached: 'neutral',
};

const MARK: Record<ApprovalOutcome, string> = {
  approved: '✓',
  rejected: '✕',
  pending: '…',
  skipped: '–',
  covered: '–',
  unreached: '–',
};

export const ApprovalChainPanel = ({
  trail,
  actions,
}: {
  /** Null on a request no chain was configured for — a different fact from an empty chain. */
  trail: ApprovalTrailDto | null;
  /** The host's own approve/reject controls, rendered under the notice that explains them. */
  actions?: JSX.Element | undefined;
}): JSX.Element | null => {
  const t = useT();
  if (trail === null) return null;

  return (
    <Card>
      <CardBody>
        <h3 className="mb-3 text-sm font-semibold">{t('approvals.title')}</h3>
        {trail.steps.length === 0 ? (
          <p className="text-sm text-slate-500">{t('approvals.noChain')}</p>
        ) : (
          <ol className="space-y-3">
            {trail.steps.map((step, index) => {
              const live = trail.currentStep === index;
              const mine = trail.viewerStep === index;
              return (
                <li
                  key={index}
                  className={`flex items-start gap-2 rounded-md p-2 text-sm ${
                    live ? 'bg-amber-50 dark:bg-amber-950/30' : ''
                  }`}
                >
                  <span className="mt-0.5 w-4 shrink-0 text-center">{MARK[step.outcome]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* The caption if the chain carries one; otherwise the LEVEL, which is what
                          the rung actually means. Never a job title — the chain does not store
                          one, and inventing one here would put a name on an authority. */}
                      <span className="font-medium">
                        {step.label?.ar != null && step.label.ar !== ''
                          ? step.label.ar
                          : t(`approvals.level.${step.level}`)}
                      </span>
                      <Badge size="sm" tone={TONE[step.outcome]}>
                        {t(`approvals.outcome.${step.outcome}`)}
                      </Badge>
                      {live && (
                        <Badge size="sm" tone="warning">
                          {t('approvals.waitingHere')}
                        </Badge>
                      )}
                      {mine && (
                        <Badge size="sm" tone="brand">
                          {t('approvals.yourStep')}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] text-slate-400" dir="ltr">
                      {step.permissionKey} · {step.level}
                    </p>
                    {step.decidedBy !== null && (
                      <p className="text-xs text-slate-500">
                        {t('approvals.decidedBy', { name: step.decidedBy.name })}
                      </p>
                    )}
                    {step.comment !== null && step.comment !== '' && (
                      <p className="text-xs text-slate-500">{step.comment}</p>
                    )}
                    {step.overriddenWith !== null && (
                      <p className="font-mono text-[11px] text-amber-600" dir="ltr">
                        {step.overriddenWith}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {/* Said BEFORE the buttons, not after the click: a general manager approving early is
            cancelling somebody's step, and he should know that while he still has the choice. */}
        {trail.viewerCovers.length > 0 && (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
            {t('approvals.willCancel', { n: String(trail.viewerCovers.length) })}
          </p>
        )}
        {trail.viewerMayOverride && (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
            {t('approvals.overrideNotice')}
          </p>
        )}
        {actions !== undefined && (trail.viewerMayDecide || trail.viewerMayOverride) && (
          <div className="mt-3">{actions}</div>
        )}
      </CardBody>
    </Card>
  );
};
