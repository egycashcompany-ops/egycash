// «إضافة كارت» / editing one — the card's facts, which company it belongs to, and its photo.
//
// Built from the owner's own design code, class for class: «اعملها زى كدا متغيرش من دماغك». The
// add form and the edit form are two designs, not one — their panels, boxes and buttons differ in
// width, colour and padding — so each class below is picked by `look`, taken from the design file
// of that form. It is its own modal rather than the shared `Dialog` because those colours, the
// Cairo type and the footer inside the body are this form's alone. It behaves like every form
// dialog: Escape and the × close it, a click outside does not.
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import '@fontsource/cairo/400.css';
import '@fontsource/cairo/500.css';
import '@fontsource/cairo/600.css';
import '@fontsource/cairo/700.css';
import '@fontsource/cairo/800.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import { type FleetFuelCardCompany, type FleetFuelCardDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { Input } from '../../../shared/ui/form';
import { FieldFeedbackProvider } from '../../../shared/ui/input-feedback';
import {
  FieldMissingProvider,
  MissingFieldsBanner,
  useRequiredFields,
} from '../../../shared/ui/required-fields';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { useCreateFuelCard, useUpdateFuelCard, useUploadFuelCardImage } from '../api/fleet-queries';
import { VehicleCodeCombobox } from './VehicleCodeCombobox';
import { FUEL_CARD_COMPANIES, FUEL_CARD_LOGO } from './FuelCardTiles';
import { revealFuelCardPassword } from '../api/fleet-api';
import { CheckIcon, EyeIcon, EyeOffIcon } from '../../../shared/ui/icons';
import { FuelCardPhotoPanel } from './FuelCardImage';
import { LICENSE_IMAGE_ACCEPT } from './VehicleLicenseImage';
import { groupCardNumber, ungroupCardNumber } from '../lib/fuel-card-number';

/** The design's type: Cairo for words, JetBrains Mono for codes and numbers. */
export const SANS = "[font-family:'Cairo',sans-serif]";
export const MONO = "[font-family:'JetBrains_Mono','Cairo',monospace]";

/** «يدعم صيغ PNG, JPG بحد أقصى 5MB» — the design's limit, held here so the words are true. */
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** The two designs' classes. `add` is «إضافة كارت», `edit` is «تعديل الكارت». */
export const LOOK = {
  add: {
    panel:
      'max-w-2xl bg-[#121c3f]/95 border-[#2b3b6b] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.85)] backdrop-blur-xl',
    header: 'py-4 border-[#2b3b6b]/80 bg-[#0f1838]/40',
    icon: 'h-9 w-9 bg-[#6c63ff]/20 border-[#6c63ff]/40 text-[#a5a0ff]',
    subtitle: 'font-medium',
    close: 'p-2 rounded-xl border border-transparent hover:border-slate-700 hover:bg-slate-800/80',
    body: 'p-6 sm:p-7',
    box: 'bg-[#0a1233] border-[#2b3b6b] py-3 shadow-inner',
    placeholder: 'placeholder:text-slate-400',
    pad: 'p-2.5',
    tile: 'border-[#2b3b6b] bg-[#0a1233]/80 hover:bg-slate-800/60',
    tileOn:
      'border-[#6c63ff] [background:linear-gradient(145deg,rgba(108,99,255,0.28),rgba(15,23,60,0.7))] shadow-[0_0_0_1px_#6c63ff,0_0_22px_-4px_rgba(108,99,255,0.6)]',
    footer: 'pt-4 border-[#2b3b6b]/60',
    save: 'px-8 bg-gradient-to-r from-[#4f3dff] to-[#6a5cff] hover:from-[#5a4aff] hover:to-[#7a6dff] shadow-[0_6px_24px_rgba(91,76,255,0.55)]',
    cancel: 'px-7 border-[#2b3b6b]',
  },
  edit: {
    panel: 'max-w-3xl bg-[#111b40] border-[#2b3b6b] shadow-2xl shadow-black/70',
    header: 'py-5 border-slate-800/80 bg-[#15204a]/50',
    icon: 'h-10 w-10 bg-[#6c63ff]/20 border-[#6c63ff]/40 text-[#a5a0ff]',
    subtitle: 'mt-0.5',
    close: 'h-9 w-9 justify-center rounded-lg hover:bg-slate-800',
    body: 'p-6',
    box: 'bg-[#0a1233] border-[#2b3b6b] py-2.5 shadow-inner',
    placeholder: 'placeholder:text-slate-400',
    pad: 'px-3.5 py-2.5',
    tile: 'border border-[#2b3b6b] bg-[#0a1233]/80 hover:border-slate-600',
    tileOn: 'border-2 border-[#6c63ff] bg-[#1d1f5e]/60 shadow-[0_0_22px_-4px_rgba(108,99,255,0.6)]',
    footer: 'pt-5 border-slate-800/80',
    save: 'px-6 tracking-wide bg-[#4f3dff] hover:bg-[#5a4aff] shadow-[0_6px_24px_rgba(91,76,255,0.55)]',
    cancel: 'px-5 border-slate-700',
  },
} as const;

/** A box of the design: the field colours, focus ring and the red glow of a refused value. */
export const boxTone = (look: (typeof LOOK)['add' | 'edit']): string =>
  cn(
    '!rounded-xl !px-4 !text-[15px] border font-medium text-white',
    look.box,
    look.placeholder,
    'transition-all focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500',
    'focus-visible:ring-offset-0',
    // A box that will not save: the design's rose frame and glow.
    'aria-[invalid=true]:!border-rose-500/70 aria-[invalid=true]:!text-rose-300',
    'aria-[invalid=true]:focus:!border-rose-500/70 aria-[invalid=true]:focus:!ring-rose-500',
    'aria-[invalid=true]:shadow-[0_0_0_1px_#ef4444,0_0_14px_-2px_rgba(239,68,68,0.3)]',
  );

/** The car box of the design: `Combobox` styles its own input, so the look is laid on from outside. */
export const carBoxClass = (editing: boolean): string =>
  cn(
    '[&_input]:!rounded-xl [&_input]:!ps-4 [&_input]:!pe-20 [&_input]:shadow-inner',
    '[&_input]:!text-white [&_input]:!font-medium [&_input]:placeholder:!text-slate-400',
    '[&_input:focus]:!border-indigo-500 [&_input:focus]:ring-1 [&_input:focus]:ring-indigo-500 [&_input]:focus-visible:!ring-offset-0',
    editing
      ? "[&_input]:!border-[#2b3b6b] [&_input]:!bg-[#0a1233] [&_input]:!py-3 [&_input]:!text-base [&_input]:font-semibold [&_input]:[font-family:'JetBrains_Mono','Cairo',monospace] [&_input]:placeholder:[font-family:'Cairo',sans-serif] [&_input]:placeholder:!text-sm [&_input]:placeholder:font-normal"
      : '[&_input]:!border-[#2b3b6b] [&_input]:!bg-[#0a1233] [&_input]:!py-3 [&_input]:!text-[15px]',
    // The clear × and the chevron, with the design's rule between them.
    '[&_.end-2]:!end-3 [&_.end-2]:!gap-1.5 [&_.end-2_svg]:!h-4 [&_.end-2_svg]:!w-4',
    '[&_.end-2_button]:!p-1 [&_.end-2_button:hover]:!text-rose-400',
    '[&_.end-2_button]:relative [&_.end-2_button]:after:absolute [&_.end-2_button]:after:-end-1 [&_.end-2_button]:after:top-1/2 [&_.end-2_button]:after:h-4 [&_.end-2_button]:after:w-px [&_.end-2_button]:after:-translate-y-1/2 [&_.end-2_button]:after:bg-slate-700 [&_.end-2_button]:me-1',
    '[&_[role=listbox]]:!rounded-xl [&_[role=listbox]]:!border-[#2b3b6b] [&_[role=listbox]]:!bg-[#131d35]',
  );

/** The design's calendar button, lightened for the dark box — each design its own filter. */
const DATE_ICON = {
  add: '[&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-70 [&::-webkit-calendar-picker-indicator]:[filter:invert(0.8)_brightness(1.2)] hover:[&::-webkit-calendar-picker-indicator]:opacity-100',
  edit: '[&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:[filter:invert(0.8)_sepia(0.2)_saturate(2)_hue-rotate(185deg)]',
} as const;

/** The «!» circle, filled, inside a refused box. */
const BangIcon = (): JSX.Element => (
  <svg className="h-5 w-5 text-rose-400" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
    <path
      clipRule="evenodd"
      fillRule="evenodd"
      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
    />
  </svg>
);

/** The design's stroke icons, drawn as the design draws them. */
export const Stroke = ({ d, className }: { d: string[]; className: string }): JSX.Element => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    {d.map((path) => (
      <path key={path} d={path} strokeLinecap="round" strokeLinejoin="round" />
    ))}
  </svg>
);
export const CARD_PATH = [
  'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
];
export const CLOSE_PATH = ['M6 18L18 6M6 6l12 12'];
const IMAGE_PATH = [
  'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
];
const CLOUD_PATH = [
  'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12',
];
const PLUS_PATH = ['M12 4v16m8-8H4'];

/** Chill Out's own mark — the owner's red logo, the wordmark wide on its red ground. */
export const CHILLOUT_LOGO = '/fleet-fuel-cards/chillout-red-wide.png';

/**
 * The company marks: Wataniya's logo as the screens have always shown it, in the design's white
 * circle; Chill Out's wordmark, which is wide, in a red pill of the same height so it reads.
 */
export const DesignLogo = ({
  company,
  editing,
}: {
  company: FleetFuelCardCompany;
  editing: boolean;
}): JSX.Element =>
  company === 'wataniya' ? (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white p-0.5 shadow-sm',
        editing ? 'h-9 w-9' : 'h-8 w-8',
      )}
    >
      <img src={FUEL_CARD_LOGO.wataniya} alt="" className="h-full w-full object-contain" />
    </div>
  ) : (
    <img
      src={CHILLOUT_LOGO}
      alt=""
      className={cn(
        'shrink-0 rounded-full object-contain shadow-sm',
        // The add form's tiles are narrower — the pill keeps its shape and shrinks to fit.
        editing ? 'h-9 w-auto' : 'h-[22px] w-auto',
      )}
    />
  );

/**
 * One labelled box of the design: the label with its rose star, the box, and under it the error,
 * «حقل مطلوب» or the grey hint. Carries what `Field` carries to the box inside — whether Save
 * found it empty, and the message of a refused keystroke — so the rules work unchanged.
 */
export const DesignField = ({
  label,
  required = false,
  missing = false,
  error,
  hint,
  endAdornment,
  children,
}: {
  label: string;
  required?: boolean;
  missing?: boolean;
  error?: string | undefined;
  hint?: string | undefined;
  /** What sits inside the box at its far end (the password's eye). Takes the place of the «!». */
  endAdornment?: ReactNode;
  children: ReactNode;
}): JSX.Element => {
  const t = useT();
  const [refused, setRefused] = useState<string | null>(null);
  const message =
    refused ?? error ?? (missing ? t('common.validation.required') : undefined) ?? null;
  return (
    <div className="space-y-2" {...(missing ? { 'data-field-missing': 'true' } : {})}>
      <label className="block text-[15px] font-bold text-white">
        {label} {required && <span className="font-bold text-rose-500">*</span>}
      </label>
      <FieldMissingProvider missing={missing}>
        <FieldFeedbackProvider value={setRefused}>
          <div className="relative">
            {children}
            {endAdornment !== undefined ? (
              <div className="absolute inset-y-0 end-0 flex items-center pe-3.5">
                {endAdornment}
              </div>
            ) : (
              message !== null && (
                <div className="pointer-events-none absolute inset-y-0 end-0 flex items-center pe-3">
                  <BangIcon />
                </div>
              )
            )}
          </div>
        </FieldFeedbackProvider>
      </FieldMissingProvider>
      {message !== null ? (
        <p
          role="alert"
          {...(refused !== null ? { 'data-input-refused': 'true' } : {})}
          {...(refused === null && error === undefined
            ? { 'data-field-missing-note': 'true' }
            : {})}
          className="flex items-center gap-1.5 pt-0.5 text-[13px] font-semibold text-[#ff6b81]"
        >
          <span className="inline-block h-3.5 w-3.5 rounded-full border border-rose-500/40 bg-rose-500/20 text-center font-bold leading-3 text-rose-400">
            !
          </span>
          <span>{message}</span>
        </p>
      ) : (
        hint !== undefined && <p className="text-[13px] font-medium text-slate-300">{hint}</p>
      )}
    </div>
  );
};

/**
 * «صورة الكارت (اختياري)» on a new card: the dashed drop box. The card does not exist until Save,
 * so the file is held here and uploaded onto the card the moment it is created.
 */
const NewCardPhoto = ({
  file,
  onFile,
}: {
  file: File | null;
  onFile: (file: File | null) => void;
}): JSX.Element => {
  const t = useT();
  const [inputKey, setInputKey] = useState(0);
  const take = (picked: File | undefined): void => {
    if (picked === undefined) return;
    if (picked.size > PHOTO_MAX_BYTES) {
      toast.error(t('fleet.fuelCards.image.tooBig'));
      setInputKey((k) => k + 1);
      return;
    }
    onFile(picked);
  };
  return (
    <div className="space-y-2" data-fuel-new-photo="true">
      <label className="flex items-center gap-1.5 text-[15px] font-bold text-white">
        <Stroke d={IMAGE_PATH} className="h-4 w-4 text-indigo-400" />
        <span>{t('fleet.fuelCards.image.title')}</span>
        <span className="me-1 text-[13px] font-medium text-slate-300">
          {t('fleet.fuelCards.image.optional')}
        </span>
      </label>
      <div
        className="group relative cursor-pointer rounded-xl border-2 border-dashed border-[#2b3b6b] bg-[#0a1233]/60 p-4 text-center transition-all hover:border-indigo-500/50 hover:bg-[#0a1233]"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          take(e.dataTransfer.files[0]);
        }}
      >
        <input
          key={inputKey}
          type="file"
          accept={LICENSE_IMAGE_ACCEPT}
          aria-label={t('fleet.fuelCards.image.upload')}
          title={t('fleet.fuelCards.image.upload')}
          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
          onChange={(e) => take(e.target.files?.[0])}
        />
        <div className="pointer-events-none flex flex-col items-center justify-between gap-3 sm:flex-row">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-400 transition-transform group-hover:scale-105">
              <svg
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d={CLOUD_PATH[0]} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-white transition-colors group-hover:text-[#a5a0ff]">
                {file === null ? t('fleet.fuelCards.image.dropTitle') : file.name}
              </p>
              <p className="mt-0.5 text-[13px] font-medium text-slate-300">
                {t('fleet.fuelCards.image.dropHint')}
              </p>
            </div>
          </div>
          <span className="flex items-center gap-1.5 rounded-lg border border-[#2b3b6b] bg-slate-800/80 px-3.5 py-1.5 text-xs font-semibold text-slate-300 shadow-sm transition-all group-hover:border-indigo-500/40 group-hover:bg-indigo-600/20 group-hover:text-indigo-300">
            <Stroke d={PLUS_PATH} className="h-3.5 w-3.5" />
            {t('fleet.fuelCards.image.pick')}
          </span>
        </div>
      </div>
    </div>
  );
};

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
}): JSX.Element | null => {
  const t = useT();
  const can = useCan();
  const [vehicleId, setVehicleId] = useState('');
  const [company, setCompany] = useState<FleetFuelCardCompany>('wataniya');
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [password, setPassword] = useState('');
  const [passwordShown, setPasswordShown] = useState(false);
  // Whether the box shows its text — the eye opens it, its twin closes it again.
  const [passwordVisible, setPasswordVisible] = useState(false);
  // A new card's photo, held until the card exists.
  const [photo, setPhoto] = useState<File | null>(null);

  useEffect(() => {
    if (!open) return;
    setVehicleId(card === null ? initialVehicleId : (card.vehicleId ?? ''));
    setCompany(card?.company ?? initialCompany ?? 'wataniya');
    setName(card?.name ?? '');
    setNumber(card?.number ?? '');
    setExpiresAt(card?.expiresAt?.slice(0, 10) ?? '');
    setPassword('');
    setPasswordShown(false);
    setPasswordVisible(false);
    setPhoto(null);
  }, [open, card, initialVehicleId, initialCompany]);

  // Escape closes, as every dialog does; a click outside does not — this is a form.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  const create = useCreateFuelCard();
  const update = useUpdateFuelCard();
  const upload = useUploadFuelCardImage();
  const pending = create.isPending || update.isPending || upload.isPending;
  // «الباسورد اجبارى»: a new card is not saved without one; an edited card that has one keeps it.
  // A stored one that was shown and then emptied is a removal, which a card may not have.
  const keepsPassword = card?.hasPassword === true && !passwordShown;
  const passwordOk = password !== '' || keepsPassword;
  // Save stays pressable: pressing it with any of these empty — or a number under four digits —
  // names them and turns their boxes red (`useRequiredFields`). «كود السياره مش اجبارى»: a card
  // on no car is saved too, known on the fuel screens by its name.
  const required = useRequiredFields(
    [
      { key: 'name', label: t('fleet.fuelCards.fields.name'), ok: name.trim() !== '' },
      { key: 'number', label: t('fleet.fuelCards.fields.number'), ok: number.trim().length >= 4 },
      { key: 'password', label: t('fleet.fuelCards.fields.password'), ok: passwordOk },
      // «تاريخ انتهاء الكارت اجبارى».
      { key: 'expiresAt', label: t('fleet.fuelCards.fields.expiresAt'), ok: expiresAt !== '' },
    ],
    open,
  );

  /** The stored password, fetched under its own grant only when the clerk asks to see it. */
  const showPassword = async (): Promise<void> => {
    if (card === null) return;
    const { password: stored } = await revealFuelCardPassword(card.id);
    setPassword(stored ?? '');
    setPasswordShown(true);
    setPasswordVisible(true);
  };

  const submit = async (): Promise<void> => {
    if (pending) return;
    const body = {
      vehicleId: vehicleId === '' ? null : vehicleId,
      // A card on no car keeps the label it is known by, or takes its name.
      label: vehicleId === '' ? (card?.label ?? name.trim()) : null,
      company,
      name: name.trim(),
      number: number.trim(),
      // Required — the guard does not let an empty one through.
      expiresAt: new Date(expiresAt),
    };
    if (card === null) {
      const created = await create.mutateAsync({ ...body, password });
      // The photo goes on the card it was picked for, now that the card exists.
      if (photo !== null) await upload.mutateAsync({ id: created.id, file: photo });
      toast.success(t('fleet.fuelCards.created'));
    } else {
      await update.mutateAsync({
        id: card.id,
        body: {
          ...body,
          // Untouched unless a new one was typed — it can be changed, never removed.
          ...(password === '' ? {} : { password }),
          version: card.version,
        },
      });
      toast.success(t('fleet.fuelCards.updated'));
    }
    onClose();
  };

  if (!open) return null;

  const editing = card !== null;
  const look = LOOK[editing ? 'edit' : 'add'];
  const box = boxTone(look);

  const eyeButton =
    'text-slate-300 transition-colors hover:text-[#a5a0ff] focus:outline-none focus-visible:ring-0';
  const passwordEye =
    card?.hasPassword === true && !passwordShown && password === '' ? (
      can('fleetFuelCard.reveal') ? (
        <button
          type="button"
          data-fuel-reveal={card.id}
          aria-label={t('fleet.fuelCards.reveal')}
          title={t('fleet.fuelCards.reveal')}
          onClick={() => void showPassword()}
          className={eyeButton}
        >
          <EyeIcon className="h-5 w-5" />
        </button>
      ) : undefined
    ) : (
      <button
        type="button"
        data-fuel-password-toggle={passwordVisible ? 'hide' : 'show'}
        aria-label={passwordVisible ? t('fleet.fuelCards.hide') : t('fleet.fuelCards.reveal')}
        title={passwordVisible ? t('fleet.fuelCards.hide') : t('fleet.fuelCards.reveal')}
        onClick={() => setPasswordVisible((v) => !v)}
        className={eyeButton}
      >
        {passwordVisible ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
      </button>
    );

  const title = editing ? t('fleet.fuelCards.edit') : t('fleet.fuelCards.add');

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto p-3 sm:p-4">
      <div
        className={cn(
          'fixed inset-0 animate-fade-in backdrop-blur-md',
          editing ? 'bg-black/80' : 'bg-[#03060c]/80',
        )}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-fuel-card-form={editing ? 'edit' : 'add'}
        className={cn(
          SANS,
          'relative my-auto w-full animate-pop-in overflow-hidden rounded-2xl border text-slate-100 antialiased',
          look.panel,
        )}
      >
        <header className={cn('flex items-center justify-between border-b px-6', look.header)}>
          <div className="flex items-center gap-3">
            <div className={cn('flex items-center justify-center rounded-xl border', look.icon)}>
              <Stroke d={CARD_PATH} className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-wide text-white">{title}</h2>
              <p className={cn('text-[13px] font-medium text-slate-300', look.subtitle)}>
                {editing ? t('fleet.fuelCards.editSubtitle') : t('fleet.fuelCards.addSubtitle')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className={cn(
              'flex items-center text-slate-400 transition-all hover:text-white focus:outline-none',
              look.close,
            )}
          >
            <Stroke d={CLOSE_PATH} className="h-5 w-5" />
          </button>
        </header>

        <div className={cn('max-h-[calc(100vh-9rem)] space-y-6 overflow-y-auto', look.body)}>
          <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
          <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
            <DesignField
              label={t('fleet.odometer.columns.vehicle')}
              hint={t('fleet.fuelCards.carHint')}
            >
              <div className={carBoxClass(editing)}>
                <VehicleCodeCombobox
                  value={vehicleId}
                  onChange={setVehicleId}
                  ariaLabel={t('fleet.odometer.columns.vehicle')}
                  placeholder={t('fleet.accidents.vehiclePlaceholder')}
                  testId="fuel-card-vehicle"
                />
              </div>
            </DesignField>
            <DesignField label={t('fleet.fuelCards.fields.company')} required>
              <div className="grid grid-cols-2 gap-3">
                {FUEL_CARD_COMPANIES.map((option) => {
                  const chosen = company === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      data-fuel-company-pick={option}
                      aria-pressed={chosen}
                      onClick={() => setCompany(option)}
                      className={cn(
                        'relative flex cursor-pointer select-none items-center justify-between gap-1 rounded-xl transition-all',
                        editing ? '' : 'border',
                        look.pad,
                        chosen ? look.tileOn : look.tile,
                      )}
                    >
                      <span
                        className={cn(
                          'whitespace-nowrap text-[15px]',
                          editing ? '' : 'px-1',
                          chosen
                            ? 'font-bold text-white'
                            : editing
                              ? 'font-bold text-slate-200'
                              : 'font-bold text-slate-200',
                        )}
                      >
                        {t(`fleet.fuelCards.company.${option}`)}
                      </span>
                      <span data-fuel-company={option}>
                        <DesignLogo company={option} editing={editing} />
                      </span>
                      {/* The chosen company carries a tick in its corner (the edit design). */}
                      {editing && chosen && (
                        <span className="absolute -top-1.5 -end-1.5 rounded-full bg-indigo-500 p-0.5 text-white shadow">
                          <CheckIcon className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </DesignField>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <DesignField
              label={t('fleet.fuelCards.fields.name')}
              required
              missing={required.isMissing('name')}
            >
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                placeholder={
                  editing
                    ? t('fleet.fuelCards.namePlaceholderEdit')
                    : t('fleet.fuelCards.namePlaceholder')
                }
                tone={cn(
                  box,
                  editing && `${MONO} tracking-wide placeholder:[font-family:'Cairo',sans-serif]`,
                )}
              />
            </DesignField>
            <DesignField
              label={t('fleet.fuelCards.fields.number')}
              required
              missing={required.isMissing('number')}
              // Typed, but too short to be a card: say so rather than «required».
              error={
                required.isMissing('number') && number.trim() !== ''
                  ? t('fleet.fuelCards.errors.numberShort')
                  : undefined
              }
            >
              {/* `autoComplete="off"`: the browser filled a saved e-mail in here and turned it red. */}
              <Input
                // Shown in fours, «كل 4 جمب بعض»; held and saved as the bare digits.
                value={groupCardNumber(number)}
                onChange={(e) => setNumber(ungroupCardNumber(e.target.value))}
                rule="digits"
                autoComplete="off"
                placeholder="0000 0000 0000 7004"
                // The digits read from the right, clear of the «!» at the far end.
                tone={cn(box, MONO, '!pl-10 text-right tracking-wider')}
              />
            </DesignField>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <DesignField
              label={t('fleet.fuelCards.fields.expiresAt')}
              required
              missing={required.isMissing('expiresAt')}
            >
              <Input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                tone={cn(box, MONO, DATE_ICON[editing ? 'edit' : 'add'], 'cursor-pointer')}
              />
            </DesignField>
            <DesignField
              label={t('fleet.fuelCards.fields.password')}
              // An edited card that has one keeps it — only a new card must be given one.
              required={!keepsPassword}
              missing={required.isMissing('password')}
              hint={t('fleet.fuelCards.passwordHint')}
              endAdornment={passwordEye}
            >
              <Input
                type={passwordVisible ? 'text' : 'password'}
                // A saved site password is not this card's PIN — the browser must not fill it in.
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={keepsPassword ? '••••' : ''}
                // The kept password's dots read as the value they stand for.
                tone={cn(
                  box,
                  MONO,
                  '!pe-11 tracking-widest',
                  keepsPassword && 'placeholder:!text-slate-100',
                )}
              />
            </DesignField>
          </div>

          {photoCard !== null ? (
            <div className="pt-1" data-purpose="field-card-image">
              <label className="mb-2 block text-[15px] font-bold text-white">
                {t('fleet.fuelCards.image.title')}
              </label>
              <FuelCardPhotoPanel card={photoCard} onOpen={(c) => onOpenPhoto?.(c)} />
            </div>
          ) : (
            !editing && <NewCardPhoto file={photo} onFile={setPhoto} />
          )}

          <div className={cn('mt-6 flex items-center justify-start gap-3 border-t', look.footer)}>
            <button
              type="button"
              data-fuel-card-save="true"
              aria-busy={pending}
              onClick={required.guard(submit)}
              className={cn(
                'flex items-center gap-2 rounded-xl py-2.5 text-[15px] font-bold text-white transition-all active:scale-[0.98]',
                look.save,
              )}
            >
              {pending ? (
                <Spinner className="h-4 w-4" />
              ) : (
                editing && <Stroke d={['M5 13l4 4L19 7']} className="h-4 w-4" />
              )}
              <span>{t('common.save')}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className={cn(
                'rounded-xl border bg-[#1a2550] py-2.5 text-[15px] font-bold text-slate-100 transition-all hover:bg-slate-700/80 hover:text-white active:scale-[0.98]',
                look.cancel,
              )}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
