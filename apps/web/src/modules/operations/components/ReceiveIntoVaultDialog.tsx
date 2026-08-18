// The receive form — packaging counts, seal barcodes, receipt number, and TWO treasurers.
//
// The two-treasurer requirement is the one thing here that is stricter than legacy, and it is a
// registered decision (Q2 NORMALIZE), not a tightening invented at the UI. Legacy's schema
// described dual control and its code wrote `treasurer_receive: ""` on every path, so only one
// person was ever recorded. The server now requires two DIFFERENT people; this form asks for them
// and says why, rather than letting the operator discover it as a 422.
import { useEffect, useState, type FormEvent } from 'react';
import { type OperationsShipmentDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useOperationsCrewDirectory, useReceiveIntoVault } from '../api/operations-queries';
import { Select } from '../../../shared/ui/form';

/** Seals are scanned or pasted — one per line, or comma separated. Blanks are dropped. */
export const parseSeals = (raw: string): string[] =>
  raw
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');

export const ReceiveIntoVaultDialog = ({
  shipment,
  onClose,
}: {
  shipment: OperationsShipmentDto | null;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const receive = useReceiveIntoVault();
  // The treasurers are picked from the operations roster — the same people the board knows.
  const directory = useOperationsCrewDirectory(null, shipment !== null);

  const [receiptNumber, setReceiptNumber] = useState('');
  const [bagCount, setBagCount] = useState('0');
  const [cartonCount, setCartonCount] = useState('0');
  const [boxCount, setBoxCount] = useState('0');
  const [bagSeals, setBagSeals] = useState('');
  const [boxSeals, setBoxSeals] = useState('');
  const [primary, setPrimary] = useState('');
  const [secondary, setSecondary] = useState('');

  useEffect(() => {
    if (shipment === null) return;
    setReceiptNumber('');
    setBagCount('0');
    setCartonCount('0');
    setBoxCount('0');
    setBagSeals('');
    setBoxSeals('');
    setPrimary('');
    setSecondary('');
  }, [shipment]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (shipment === null) return;
    if (primary === secondary) {
      toast.error(t('operations.secured.receive.sameTreasurer'));
      return;
    }
    try {
      await receive.mutateAsync({
        id: shipment.id,
        body: {
          receiptNumber: receiptNumber.trim(),
          bagCount: Number(bagCount) || 0,
          cartonCount: Number(cartonCount) || 0,
          boxCount: Number(boxCount) || 0,
          bagSeals: parseSeals(bagSeals),
          boxSeals: parseSeals(boxSeals),
          receivedByPrimaryId: primary,
          receivedBySecondaryId: secondary,
          version: shipment.version,
        },
      });
      toast.success(t('operations.secured.receive.done'));
      onClose();
    } catch {
      toast.error(t('operations.secured.receive.failed'));
    }
  };

  const members = directory.data?.members ?? [];

  return (
    <Dialog
      open={shipment !== null}
      onClose={onClose}
      size="lg"
      title={t('operations.secured.receive.action')}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('operations.secured.receive.receiptNumber')} required>
          <Input
            value={receiptNumber}
            onChange={(e) => setReceiptNumber(e.target.value)}
            required
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('operations.secured.receive.bags')}>
            <Input type="number" min={0} value={bagCount} onChange={(e) => setBagCount(e.target.value)} />
          </Field>
          <Field label={t('operations.secured.receive.cartons')}>
            <Input
              type="number"
              min={0}
              value={cartonCount}
              onChange={(e) => setCartonCount(e.target.value)}
            />
          </Field>
          <Field label={t('operations.secured.receive.boxes')}>
            <Input type="number" min={0} value={boxCount} onChange={(e) => setBoxCount(e.target.value)} />
          </Field>
        </div>

        <Field
          label={t('operations.secured.receive.bagSeals')}
          hint={t('operations.secured.receive.sealsHint')}
        >
          <Input value={bagSeals} onChange={(e) => setBagSeals(e.target.value)} />
        </Field>
        <Field label={t('operations.secured.receive.boxSeals')}>
          <Input value={boxSeals} onChange={(e) => setBoxSeals(e.target.value)} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('operations.secured.receive.primary')}
            required
            hint={t('operations.secured.receive.dualControl')}
          >
            <Select value={primary} onChange={(e) => setPrimary(e.target.value)} required>
              <option value="">{t('common.select')}</option>
              {members.map((m) => (
                <option key={m.employeeId} value={m.employeeId}>
                  {m.fullNameAr}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('operations.secured.receive.secondary')} required>
            <Select value={secondary} onChange={(e) => setSecondary(e.target.value)} required>
              <option value="">{t('common.select')}</option>
              {members.map((m) => (
                <option key={m.employeeId} value={m.employeeId}>
                  {m.fullNameAr}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={receive.isPending}>
            {t('operations.secured.receive.action')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
