// Lifecycle action dialogs shared by the list and detail pages (frozen design §4).
// Amend = a new VERSION of the same contract; Renew = a NEW linked contract (D9) —
// both spawn a draft and navigate to it. Terminate records reason + date (D3).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ContractDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Button, Field, Input, Textarea, toast } from '../../../../shared/ui';
import { useAmendContract, useRenewContract, useTerminateContract } from '../api/contract-queries';

const today = (): string => new Date().toISOString().slice(0, 10);

export const AmendRenewDialog = ({
  contract,
  mode,
  open,
  onClose,
}: {
  contract: ContractDto;
  mode: 'amend' | 'renew';
  open: boolean;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const navigate = useNavigate();
  const amend = useAmendContract();
  const renew = useRenewContract();
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState('');
  const busy = amend.isPending || renew.isPending;

  const submit = async (): Promise<void> => {
    const body = { startDate, endDate: endDate === '' ? null : endDate, overrides: {}, version: contract.version };
    try {
      const next =
        mode === 'amend'
          ? await amend.mutateAsync({ id: contract.id, body })
          : await renew.mutateAsync({ id: contract.id, body });
      toast.success(t(`contracts.actions.${mode}Done`));
      onClose();
      navigate(`/contracts/${next.id}`);
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(`contracts.actions.${mode}Title`, { code: contract.code })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => void submit()} loading={busy}>{t(`contracts.actions.${mode}`)}</Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-slate-500">{t(`contracts.actions.${mode}Hint`)}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('contracts.fields.startDate')} required>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label={t('contracts.fields.endDate')}>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};

export const TerminateDialog = ({
  contract,
  open,
  onClose,
}: {
  contract: ContractDto;
  open: boolean;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const terminate = useTerminateContract();
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(today());

  const submit = async (): Promise<void> => {
    try {
      await terminate.mutateAsync({
        id: contract.id,
        body: { reason, date, version: contract.version },
      });
      toast.success(t('contracts.actions.terminateDone'));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('contracts.actions.terminateTitle', { code: contract.code })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="danger"
            onClick={() => void submit()}
            loading={terminate.isPending}
            disabled={reason.trim() === ''}
          >
            {t('contracts.actions.terminate')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('contracts.actions.terminateDate')} required>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t('contracts.actions.terminateReason')} required>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};
