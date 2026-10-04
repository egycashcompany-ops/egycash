// The card view both fuel screens share — «كود العربيه دا من اليمين جمبها اتنين واحد فوق وواحده
// تحت: كود العربيه فوق لوجو شركه وطنيه وتحت لوجو شركة شيل اوت وجمبهم باقى البيانات».
//
// One tile per car; inside it one line per company, Wataniya above Chill Out, each line a logo
// and the card's facts in their own frames («حط فريم حوالين كل حاجة لوحدها»). A warning about a
// field sits ABOVE that field's frame, where the eye lands first.
import { type ReactNode } from 'react';
import { type FleetFuelCardCompany, type FleetFuelCardDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';

/** The companies' marks, shipped with the client — Wataniya on top, Chill Out below. */
export const FUEL_CARD_COMPANIES: readonly FleetFuelCardCompany[] = ['wataniya', 'chillout'];
export const FUEL_CARD_LOGO: Record<FleetFuelCardCompany, string> = {
  wataniya: '/fleet-fuel-cards/wataniya.png',
  chillout: '/fleet-fuel-cards/chillout.png',
};

export const FuelCompanyLogo = ({
  company,
  size = 'md',
}: {
  company: FleetFuelCardCompany;
  size?: 'sm' | 'md';
}): JSX.Element => {
  const t = useT();
  return (
    <img
      src={FUEL_CARD_LOGO[company]}
      alt={t(`fleet.fuelCards.company.${company}`)}
      title={t(`fleet.fuelCards.company.${company}`)}
      data-fuel-company={company}
      className={cn(
        'shrink-0 rounded-xl bg-white object-contain p-1 shadow',
        size === 'sm' ? 'h-11 w-11' : 'h-16 w-16',
      )}
    />
  );
};

/** One fact in its own frame, with room above it for a warning. */
export const FramedField = ({
  label,
  children,
  above,
  className,
  ltr = false,
}: {
  label: string;
  children: ReactNode;
  /** A badge drawn ABOVE the frame — «تنتهي قريباً», «رصيد منخفض». */
  above?: ReactNode;
  className?: string;
  ltr?: boolean;
}): JSX.Element => (
  <div className={cn('flex min-w-[9rem] flex-col gap-1', className)}>
    <span className="min-h-[1.125rem] text-[11px] leading-[1.125rem]">{above}</span>
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 dark:border-slate-700 dark:bg-slate-950">
      <span className="block text-[11px] text-slate-500 dark:text-slate-400">{label}</span>
      <span
        className={cn(
          'block text-[15px] font-bold text-slate-900 dark:text-slate-100',
          ltr && 'text-right tabular-nums',
        )}
        dir={ltr ? 'ltr' : undefined}
      >
        {children}
      </span>
    </div>
  </div>
);

export const WarnBadge = ({
  tone,
  children,
}: {
  tone: 'yellow' | 'red';
  children: ReactNode;
}): JSX.Element => (
  <span
    className={cn(
      'inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold',
      tone === 'yellow'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200'
        : 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200',
    )}
  >
    ⚠ {children}
  </span>
);

/** The car's tile: the code on the start side, the company lines after it. */
export const VehicleCardTile = ({
  code,
  vehicleId,
  noCar = false,
  children,
}: {
  code: string;
  vehicleId: string;
  /** A card on no car («سفر 1», «اسبير») — its tile says so under the label. */
  noCar?: boolean;
  children: ReactNode;
}): JSX.Element => {
  const t = useT();
  return (
    <div
      data-fuel-vehicle={vehicleId}
      {...(noCar ? { 'data-fuel-no-car': 'true' } : {})}
      className="flex overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex w-28 shrink-0 flex-col items-center justify-center border-e border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
        <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">{code}</span>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {noCar ? t('fleet.fuelCards.noCar') : t('fleet.odometer.columns.vehicle')}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col divide-y divide-slate-100 dark:divide-slate-800">
        {children}
      </div>
    </div>
  );
};

/** One company's line inside a tile. */
export const CardLine = ({
  company,
  tone,
  children,
}: {
  company: FleetFuelCardCompany;
  /** The row's own colour: a request waiting, charged within the day. */
  tone?: 'request' | 'charged' | undefined;
  children: ReactNode;
}): JSX.Element => (
  <div
    data-fuel-line={company}
    className={cn(
      'flex flex-wrap items-end gap-3 px-3 py-2',
      tone === 'request' && 'bg-amber-50 dark:bg-amber-950/30',
      tone === 'charged' && 'bg-emerald-50 dark:bg-emerald-950/30',
    )}
  >
    <FuelCompanyLogo company={company} size="sm" />
    {children}
  </div>
);

/** The company slot a car has no card in yet. */
export const EmptyCardLine = ({
  company,
  onAdd,
}: {
  company: FleetFuelCardCompany;
  onAdd?: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <CardLine company={company}>
      <span className="self-center text-sm text-slate-400">{t('fleet.fuelCards.noCard')}</span>
      {onAdd !== undefined && (
        <button
          type="button"
          data-fuel-add={company}
          onClick={onAdd}
          className="self-center rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          + {t('fleet.fuelCards.add')}
        </button>
      )}
    </CardLine>
  );
};

/** Where a card sits: its car's id, or `label:<label>` for a card on no car. */
export const fuelCardPlace = (card: FleetFuelCardDto): string =>
  card.vehicleId ?? `label:${card.label ?? card.id}`;

/** The labels of the cards on no car, each once — offered where a car is picked. */
export const noCarPlaces = (cards: readonly FleetFuelCardDto[]): { id: string; code: string }[] => {
  const places = new Map<string, string>();
  for (const card of cards) {
    if (card.vehicleId === null) places.set(fuelCardPlace(card), card.label ?? '—');
  }
  return [...places].map(([id, code]) => ({ id, code }));
};

/**
 * The cars on the screen, each with its two slots — grouped from a flat list of cards. A card on
 * no car is a tile of its own label («سفر 1», «تويوتا اللواء»), so the label's two companies sit
 * together the way a car's do.
 */
export const groupByVehicle = (
  cards: readonly FleetFuelCardDto[],
): {
  /** The car's id, or `label:<label>` for the tile of a card on no car. */
  vehicleId: string;
  code: string;
  noCar: boolean;
  cards: Partial<Record<FleetFuelCardCompany, FleetFuelCardDto>>;
}[] => {
  const map = new Map<
    string,
    {
      vehicleId: string;
      code: string;
      noCar: boolean;
      cards: Partial<Record<FleetFuelCardCompany, FleetFuelCardDto>>;
    }
  >();
  for (const card of cards) {
    const key = fuelCardPlace(card);
    const entry = map.get(key) ?? {
      vehicleId: key,
      code: card.vehicleId === null ? (card.label ?? '—') : (card.vehicleCode ?? '—'),
      noCar: card.vehicleId === null,
      cards: {},
    };
    entry.cards[card.company] = card;
    map.set(key, entry);
  }
  return [...map.values()];
};
