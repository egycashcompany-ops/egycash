// RW13 — send a candidate back to an earlier stage.
//
// The act looks destructive and is not: nothing is deleted or edited. Forward records are marked
// superseded (read-only forever) and the target re-opens on a fresh attempt. Because that is easy
// to misread, the dialog never lets the user commit blind — picking a target fetches the server's
// own consequence preview, and the confirm button stays disabled until that preview has arrived.
//
// The stage list comes from the aggregated counters endpoint, which already omits every stage the
// caller may not see (RW15), so the picker can never offer a stage the return would be refused for.
import { useState } from 'react';
import {
  type ApplicantDto,
  type Locale,
  type StageCountDto,
  type StageRef,
} from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Field, Input, Select } from '../../../../../shared/ui/form';
import { Badge } from '../../../../../shared/ui/Badge';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../../shared/lib/format';
import { useRecruitmentStageCounts } from '../../counters/stage-counts-queries';
import { useReturnToStage, useReturnToStagePreview } from '../api/applicant-queries';

/** Only stages a candidate can be sent BACK to — the two terminal rails are not stages. */
const RETURNABLE_KINDS = new Set(['screening', 'interview', 'evaluation', 'jobOffer']);

const stageLabel = (stage: StageCountDto, locale: Locale, t: (key: string) => string): string =>
  stage.name === null ? t(`recruitment.nav.${stage.kind}`) : localized(stage.name, locale);

export const ReturnToStageDialog = ({
  applicant,
  open,
  onClose,
}: {
  applicant: ApplicantDto;
  open: boolean;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [key, setKey] = useState('');
  const [reason, setReason] = useState('');

  const { data: counts } = useRecruitmentStageCounts();
  const stages = (counts?.stages ?? []).filter((s) => RETURNABLE_KINDS.has(s.kind));
  const picked = stages.find((s) => s.key === key);
  const target: StageRef | null =
    picked === undefined ? null : { kind: picked.kind, refId: picked.refId };

  const preview = useReturnToStagePreview(applicant.id, open ? target : null);
  const returnToStage = useReturnToStage(applicant.id);

  const close = (): void => {
    setKey('');
    setReason('');
    onClose();
  };

  const submit = async (): Promise<void> => {
    if (target === null || reason.trim() === '') return;
    try {
      await returnToStage.mutateAsync({
        target,
        reason: reason.trim(),
        version: applicant.version,
      });
      toast.success(t('applicants.returnToStage.done'));
      close();
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('applicants.returnToStage.title')}
      description={t('applicants.returnToStage.body')}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={returnToStage.isPending}
            // Never commit before the server has said what this will do.
            disabled={target === null || reason.trim() === '' || preview.data === undefined}
            onClick={() => void submit()}
          >
            {t('applicants.returnToStage.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('applicants.returnToStage.target')} required>
          <Select value={key} onChange={(e) => setKey(e.target.value)}>
            <option value="">{t('common.select')}</option>
            {stages.map((s) => (
              <option key={s.key} value={s.key}>
                {stageLabel(s, locale, t)}
              </option>
            ))}
          </Select>
        </Field>

        {target !== null && (
          <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
            {preview.isLoading && <LoadingState />}
            {preview.isError && (
              <p className="text-rose-600 dark:text-rose-400">
                {t('applicants.returnToStage.previewFailed')}
              </p>
            )}
            {preview.data !== undefined && (
              <div className="space-y-2">
                <p className="font-medium">
                  {t('applicants.returnToStage.newAttempt').replace(
                    '{n}',
                    String(preview.data.newAttempt),
                  )}
                </p>

                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    {t('applicants.returnToStage.supersedes')}
                  </p>
                  {preview.data.supersedes.length === 0 ? (
                    <p className="text-slate-500">{t('applicants.returnToStage.nothing')}</p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {preview.data.supersedes.map((r) => (
                        <li key={`${r.entityType}:${r.entityId}`} className="flex items-center gap-2">
                          <span>{r.label}</span>
                          <Badge tone="neutral">{r.status}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {preview.data.cancels.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      {t('applicants.returnToStage.cancels')}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {preview.data.cancels.map((r) => (
                        <li key={`${r.entityType}:${r.entityId}`}>{r.label}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* The one sentence that keeps this act from being misread as a deletion. */}
                <p className="text-xs text-slate-500">{t('applicants.returnToStage.preserved')}</p>
              </div>
            )}
          </div>
        )}

        <Field label={t('bulk.reason.title')} hint={t('applicants.returnToStage.reasonHint')} required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};
