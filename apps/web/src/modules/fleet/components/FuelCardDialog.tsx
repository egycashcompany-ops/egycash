// «إضافة كارت» / editing one — the card's facts and which company it belongs to.
import { useEffect, useState } from 'react';
import { type FleetFuelCardCompany, type FleetFuelCardDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { useCreateFuelCard, useUpdateFuelCard } from '../api/fleet-queries';
import { VehicleCodeCombobox } from './VehicleCodeCombobox';
import { FUEL_CARD_COMPANIES, FuelCompanyLogo } from './FuelCardTiles';
import { revealFuelCardPassword } from '../api/fleet-api';
import { EyeIcon } from '../../../shared/ui/icons';

export const FuelCardDialog = ({
  open,
  onClose,
  card,
  initialVehicleId = '',
  initialCompany,
}: {
  open: boolean;
  onClose: () => void;
  /** null = add. */
  card: FleetFuelCardDto | null;
  initialVehicleId?: string;
  initialCompany?: FleetFuelCardCompany;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [vehicleId, setVehicleId] = useState('');
  const [company, setCompany] = useState<FleetFuelCardCompany>('wataniya');
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [password, setPassword] = useState('');
  const [passwordShown, setPasswordShown] = useState(false);

  useEffect(() => {
    if (!open) return;
    setVehicleId(card?.vehicleId ?? initialVehicleId);
    setCompany(card?.company ?? initialCompany ?? 'wataniya');
    setName(card?.name ?? '');
    setNumber(card?.number ?? '');
    setExpiresAt(card?.expiresAt.slice(0, 10) ?? '');
    setPassword('');
    setPasswordShown(false);
  }, [open, card, initialVehicleId, initialCompany]);

  const create = useCreateFuelCard();
  const update = useUpdateFuelCard();
  const pending = create.isPending || update.isPending;
  const complete =
    vehicleId !== '' && name.trim() !== '' && number.trim().length >= 4 && expiresAt !== '';

  /** The stored password, fetched under its own grant only when the clerk asks to see it. */
  const showPassword = async (): Promise<void> => {
    if (card === null) return;
    const { password: stored } = await revealFuelCardPassword(card.id);
    setPassword(stored ?? '');
    setPasswordShown(true);
  };

  const submit = async (): Promise<void> => {
    const body = {
      vehicleId,
      company,
      name: name.trim(),
      number: number.trim(),
      expiresAt: new Date(expiresAt),
    };
    if (card === null) {
      await create.mutateAsync({ ...body, password: password === '' ? null : password });
      toast.success(t('fleet.fuelCards.created'));
    } else {
      await update.mutateAsync({
        id: card.id,
        body: {
          ...body,
          // Untouched unless the clerk opened it or typed a new one.
          ...(passwordShown || password !== ''
            ? { password: password === '' ? null : password }
            : {}),
          version: card.version,
        },
      });
      toast.success(t('fleet.fuelCards.updated'));
    }
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={card === null ? t('fleet.fuelCards.add') : t('fleet.fuelCards.edit')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={pending} disabled={!complete} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('fleet.odometer.columns.vehicle')}
            required
            hint={t('fleet.accidents.vehicleHint')}
          >
            <VehicleCodeCombobox
              value={vehicleId}
              onChange={setVehicleId}
              wholeRegistry
              ariaLabel={t('fleet.odometer.columns.vehicle')}
              placeholder={t('fleet.accidents.vehiclePlaceholder')}
              testId="fuel-card-vehicle"
            />
          </Field>
          <Field label={t('fleet.fuelCards.fields.company')} required>
            <div className="flex gap-3">
              {FUEL_CARD_COMPANIES.map((option) => (
                <button
                  key={option}
                  type="button"
                  data-fuel-company-pick={option}
                  aria-pressed={company === option}
                  onClick={() => setCompany(option)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm',
                    company === option
                      ? 'border-brand-500 bg-brand-50 font-semibold dark:bg-brand-950/40'
                      : 'border-slate-300 dark:border-slate-700',
                  )}
                >
                  <FuelCompanyLogo company={option} size="sm" />
                  {t(`fleet.fuelCards.company.${option}`)}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('fleet.fuelCards.fields.name')} required>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('fleet.fuelCards.fields.number')} required>
            <Input value={number} onChange={(e) => setNumber(e.target.value)} dir="ltr" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('fleet.fuelCards.fields.expiresAt')} required>
            <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </Field>
          <Field
            label={t('fleet.fuelCards.fields.password')}
            hint={t('fleet.fuelCards.passwordHint')}
          >
            <div className="flex items-center gap-2">
              <Input
                type={passwordShown ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={card?.hasPassword === true && !passwordShown ? '••••' : ''}
                dir="ltr"
              />
              {card?.hasPassword === true && !passwordShown && can('fleetFuelCard.reveal') && (
                <button
                  type="button"
                  data-fuel-reveal={card.id}
                  aria-label={t('fleet.fuelCards.reveal')}
                  title={t('fleet.fuelCards.reveal')}
                  onClick={() => void showPassword()}
                  className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  <EyeIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          </Field>
        </div>
      </div>
    </Dialog>
  );
};
