// «إضافة كارت» / editing one — the card's facts and which company it belongs to.
import { useEffect, useState } from 'react';
import { type FleetFuelCardCompany, type FleetFuelCardDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input } from '../../../shared/ui/form';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { useCreateFuelCard, useUpdateFuelCard } from '../api/fleet-queries';
import { VehicleCodeCombobox } from './VehicleCodeCombobox';
import { FUEL_CARD_COMPANIES, FuelCompanyLogo } from './FuelCardTiles';
import { revealFuelCardPassword } from '../api/fleet-api';
import { EyeIcon } from '../../../shared/ui/icons';
import { FuelCardImageControl } from './FuelCardImage';

export const FuelCardDialog = ({
  open,
  onClose,
  card,
  initialVehicleId = '',
  initialCompany,
  photoCard = null,
  onOpenPhoto,
}: {
  open: boolean;
  onClose: () => void;
  /** null = add. */
  card: FleetFuelCardDto | null;
  initialVehicleId?: string;
  initialCompany?: FleetFuelCardCompany;
  /**
   * The card being edited as the list holds it NOW — its photo changes under the open form (an
   * upload from here), while `card` stays the snapshot the boxes were filled from.
   */
  photoCard?: FleetFuelCardDto | null;
  onOpenPhoto?: (card: FleetFuelCardDto) => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [vehicleId, setVehicleId] = useState('');
  const [label, setLabel] = useState('');
  const [company, setCompany] = useState<FleetFuelCardCompany>('wataniya');
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [password, setPassword] = useState('');
  const [passwordShown, setPasswordShown] = useState(false);

  useEffect(() => {
    if (!open) return;
    setVehicleId(card === null ? initialVehicleId : (card.vehicleId ?? ''));
    setLabel(card?.label ?? '');
    setCompany(card?.company ?? initialCompany ?? 'wataniya');
    setName(card?.name ?? '');
    setNumber(card?.number ?? '');
    setExpiresAt(card?.expiresAt?.slice(0, 10) ?? '');
    setPassword('');
    setPasswordShown(false);
  }, [open, card, initialVehicleId, initialCompany]);

  const create = useCreateFuelCard();
  const update = useUpdateFuelCard();
  const pending = create.isPending || update.isPending;
  // A card on no car («سفر 1», «اسبير») is edited under its label; it may be moved onto a car, and
  // then the car names it instead.
  const noCar = card !== null && card.vehicleId === null;
  // Save stays pressable: pressing it with any of these empty — or a number under four digits —
  // names them and turns their boxes red (`useRequiredFields`). The expiry may wait: the owner's
  // sheets came without it («تاريخ الانتهاء هبعته … فى فايل تانى»).
  const required = useRequiredFields(
    [
      noCar
        ? {
            key: 'label',
            label: t('fleet.fuelCards.fields.label'),
            ok: vehicleId !== '' || label.trim() !== '',
          }
        : { key: 'vehicle', label: t('fleet.odometer.columns.vehicle'), ok: vehicleId !== '' },
      { key: 'name', label: t('fleet.fuelCards.fields.name'), ok: name.trim() !== '' },
      { key: 'number', label: t('fleet.fuelCards.fields.number'), ok: number.trim().length >= 4 },
    ],
    open,
  );

  /** The stored password, fetched under its own grant only when the clerk asks to see it. */
  const showPassword = async (): Promise<void> => {
    if (card === null) return;
    const { password: stored } = await revealFuelCardPassword(card.id);
    setPassword(stored ?? '');
    setPasswordShown(true);
  };

  const submit = async (): Promise<void> => {
    const body = {
      vehicleId: vehicleId === '' ? null : vehicleId,
      label: vehicleId === '' ? label.trim() : null,
      company,
      name: name.trim(),
      number: number.trim(),
      expiresAt: expiresAt === '' ? null : new Date(expiresAt),
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
      dismissOnOutsideClick={false}
      size="lg"
      title={card === null ? t('fleet.fuelCards.add') : t('fleet.fuelCards.edit')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={pending} onClick={required.guard(submit)}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('fleet.odometer.columns.vehicle')}
            required={!noCar}
            missing={required.isMissing('vehicle')}
            hint={t('fleet.accidents.vehicleHint')}
          >
            <VehicleCodeCombobox
              value={vehicleId}
              onChange={setVehicleId}
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
        {noCar && vehicleId === '' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('fleet.fuelCards.fields.label')}
              required
              missing={required.isMissing('label')}
            >
              <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
            </Field>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('fleet.fuelCards.fields.name')}
            required
            missing={required.isMissing('name')}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field
            label={t('fleet.fuelCards.fields.number')}
            required
            missing={required.isMissing('number')}
            // Typed, but too short to be a card: say so rather than «required».
            {...(required.isMissing('number') && number.trim() !== ''
              ? { error: t('fleet.fuelCards.errors.numberShort') }
              : {})}
          >
            <Input value={number} onChange={(e) => setNumber(e.target.value)} rule="digits" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('fleet.fuelCards.fields.expiresAt')}>
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
        {photoCard !== null && (
          <Field label={t('fleet.fuelCards.image.title')}>
            <div className="flex min-h-[2.5rem] items-center">
              <FuelCardImageControl card={photoCard} onOpen={(c) => onOpenPhoto?.(c)} />
            </div>
          </Field>
        )}
      </div>
    </Dialog>
  );
};
