// Replacing a National-ID card photo that was not captured well, and refreshing every screen that
// shows the card afterwards.
//
// The new photo goes up through HR's existing «replace card» endpoint, which files it as the
// card's NEXT VERSION — so the old photo stays in the history and can be restored. On a phone or
// tablet `capture` opens the camera directly; on a computer it is an ordinary file picker.
import { useRef, useState, type ReactNode } from 'react';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { type NationalIdCardSide } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { detailKey } from '../../../../../shared/lib/query-keys';
import { staffReplaceCard } from '../../applicant-documents/api/applicant-document-api';

/** Every query that shows this applicant's card reads the latest version — refresh them all. */
export const refreshCardQueries = async (qc: QueryClient, applicantId: string): Promise<void> => {
  await qc.invalidateQueries({ queryKey: detailKey('hr', 'applicants', applicantId) });
  await qc.invalidateQueries({ queryKey: ['hr', 'idCardHistory', applicantId] });
};

/** A hidden image input; `trigger` renders whatever opens it (a button, an icon). */
export const ReplaceCardInput = ({
  applicantId,
  side,
  trigger,
  onDone,
}: {
  applicantId: string;
  side: NationalIdCardSide;
  trigger: (pick: () => void, busy: boolean) => ReactNode;
  onDone?: () => void;
}): JSX.Element => {
  const t = useT();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    setBusy(true);
    try {
      await staffReplaceCard(applicantId, side, file);
      await refreshCardQueries(qc, applicantId);
      toast.success(t('applicants.idCard.replace.done'));
      onDone?.();
    } catch {
      toast.error(t('applicants.idCard.edit.failed'));
    } finally {
      setBusy(false);
      if (input.current !== null) input.current.value = '';
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(e) => void upload(e.target.files?.[0])}
      />
      {trigger(() => input.current?.click(), busy)}
    </>
  );
};
