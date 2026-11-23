// «مسح نهائي» for a candidate — one button, dropped wherever the recruitment cycle shows a person.
//
// WHY IT IS SHARED RATHER THAN WRITTEN FIVE TIMES. «لما أحذفه من أى مكان فى الدورة يتشال تماماً»:
// the same act has to be reachable from the applicant, from the screening, from either interview
// round, from the evaluation and from the offer. Five copies of a permanent delete would be five
// chances for one of them to ask for less confirmation than the others, or to go on asking after
// the rule behind it changed. Every stage DTO already carries `applicantId`, `applicantCode` and
// `applicantName`, so one component serves all of them.
//
// IT ASKS FOR THE CODE, TYPED — not a checkbox, which is dismissed by the same reflex that opened
// the menu. Typing «APP-2026-000123» cannot be done by reflex, and it is also what proves the
// person at the keyboard knows WHICH candidate this is; the server checks it against the record,
// so a stale tab cannot erase a stranger.
//
// AND IT NAMES WHAT GOES, because from a screening or an interview screen the scope is not
// obvious: pressing here does not remove a screening, it removes the person and every stage they
// ever reached, their portal login, and the photographs of their ID card.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { useCan } from '../../../../platform/rbac/Can';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Button } from '../../../../shared/ui/Button';
import { Field, Input } from '../../../../shared/ui/form';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../../shared/lib/errors';
import { usePurgeApplicant } from '../applicants/api/applicant-queries';

interface Props {
  applicantId: string;
  applicantCode: string;
  applicantName: string;
  /** Where to go once the candidate no longer exists. The screen behind this is now a 404. */
  returnTo?: string;
}

export const PurgeApplicantAction = ({
  applicantId,
  applicantCode,
  applicantName,
  returnTo = '/applicants',
}: Props): JSX.Element | null => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const purge = usePurgeApplicant(applicantId);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  // Break-glass: for almost every reader this renders nothing at all.
  if (!can('applicant.purge')) return null;

  const matches = typed.trim() === applicantCode;

  const submit = async (): Promise<void> => {
    if (!matches) return;
    try {
      const report = await purge.mutateAsync({ confirmCode: typed.trim() });
      toast.success(
        t('applicants.purge.done', { name: applicantName, rows: report.rowsDeleted }),
      );
      setOpen(false);
      navigate(returnTo);
    } catch (e) {
      toast.error(errorMessage(e, locale));
    }
  };

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        {t('applicants.purge.title')}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('applicants.purge.title')}
        description={t('applicants.purge.description', {
          name: applicantName,
          code: applicantCode,
        })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={purge.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() => void submit()}
              disabled={!matches || purge.isPending}
            >
              {t('applicants.purge.submit')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm font-semibold text-danger-700">{t('applicants.purge.goes')}</p>
          <p className="text-sm text-neutral-700">{t('applicants.purge.hired')}</p>
          <Field
            label={t('applicants.purge.confirmLabel', { code: applicantCode })}
            htmlFor="purge-applicant-confirm"
            required
            error={typed.trim() !== '' && !matches ? t('applicants.purge.mismatch') : undefined}
          >
            <Input
              id="purge-applicant-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              dir="ltr"
              autoComplete="off"
            />
          </Field>
        </div>
      </Dialog>
    </>
  );
};
