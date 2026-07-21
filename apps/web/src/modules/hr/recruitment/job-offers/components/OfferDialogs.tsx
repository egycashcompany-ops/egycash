// The offer lifecycle action dialogs — send, accept, reject, withdraw. All version-checked; errors
// surface via the global handler (STALE_DOCUMENT etc.), matching the rest of the module.
import { useState } from 'react';
import { useT } from '../../../../../platform/localization/useT';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Button } from '../../../../../shared/ui/Button';
import { Field, Textarea } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import {
  useAcceptJobOffer,
  useRejectJobOffer,
  useSendJobOffer,
  useWithdrawJobOffer,
} from '../api/job-offer-queries';

interface ActionProps {
  onClose: () => void;
  offerId: string;
  version: number;
}

export const SendOfferDialog = ({ onClose, offerId, version }: ActionProps): JSX.Element => {
  const t = useT();
  const send = useSendJobOffer(offerId);
  const submit = async (): Promise<void> => {
    try {
      await send.mutateAsync({ version });
      toast.success(t('offers.send.done'));
      onClose();
    } catch {
      // surfaced globally
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('offers.send.title')}
      description={t('offers.send.body')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={send.isPending} onClick={() => void submit()}>{t('offers.actions.send')}</Button>
        </>
      }
    >
      <p className="text-sm text-slate-600 dark:text-slate-300">{t('offers.send.confirm')}</p>
    </Dialog>
  );
};

export const AcceptOfferDialog = ({ onClose, offerId, version }: ActionProps): JSX.Element => {
  const t = useT();
  const accept = useAcceptJobOffer(offerId);
  const [note, setNote] = useState('');
  const submit = async (): Promise<void> => {
    try {
      await accept.mutateAsync({ version, ...(note.trim() === '' ? {} : { note: note.trim() }) });
      toast.success(t('offers.accept.done'));
      onClose();
    } catch {
      // surfaced globally
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('offers.accept.title')}
      description={t('offers.accept.body')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={accept.isPending} onClick={() => void submit()}>{t('offers.actions.accept')}</Button>
        </>
      }
    >
      <Field label={t('offers.accept.note')} hint={t('offers.accept.noteHint')}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} />
      </Field>
    </Dialog>
  );
};

export const RejectOfferDialog = ({ onClose, offerId, version }: ActionProps): JSX.Element => {
  const t = useT();
  const reject = useRejectJobOffer(offerId);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const submit = async (): Promise<void> => {
    if (reason.trim() === '') return;
    try {
      await reject.mutateAsync({
        reason: reason.trim(),
        version,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });
      toast.success(t('offers.reject.done'));
      onClose();
    } catch {
      // surfaced globally
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('offers.reject.title')}
      description={t('offers.reject.body')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="danger" loading={reject.isPending} disabled={reason.trim() === ''} onClick={() => void submit()}>
            {t('offers.actions.reject')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('offers.reject.reason')} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={2000} />
        </Field>
        <Field label={t('offers.reject.note')} hint={t('offers.accept.noteHint')}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} />
        </Field>
      </div>
    </Dialog>
  );
};

export const WithdrawOfferDialog = ({ onClose, offerId, version }: ActionProps): JSX.Element => {
  const t = useT();
  const withdraw = useWithdrawJobOffer(offerId);
  const [reason, setReason] = useState('');
  const submit = async (): Promise<void> => {
    if (reason.trim() === '') return;
    try {
      await withdraw.mutateAsync({ reason: reason.trim(), version });
      toast.success(t('offers.withdraw.done'));
      onClose();
    } catch {
      // surfaced globally
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('offers.withdraw.title')}
      description={t('offers.withdraw.body')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="danger" loading={withdraw.isPending} disabled={reason.trim() === ''} onClick={() => void submit()}>
            {t('offers.actions.withdraw')}
          </Button>
        </>
      }
    >
      <Field label={t('offers.withdraw.reason')} required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={2000} />
      </Field>
    </Dialog>
  );
};
