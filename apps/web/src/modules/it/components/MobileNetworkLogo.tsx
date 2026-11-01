// The three networks' marks — «عايزك تستخدم الـ 3 لوجوهات فى الفلتر وفى الجدول جنب كل خط تابع
// لشركته»: in the network filter, and in the register beside every line on that network.
//
// The files ship with the client (`public/it-mobile-lines/`), referenced by URL and never imported,
// the fuel cards' idiom. Under `BASE_URL`, because the deployment serves the app from a sub-path
// (`VITE_BASE_PATH=/ecms/`): a bare `/it-mobile-lines/…` would ask the site's root for them.
//
// The three are not the same shape — Vodafone's and Etisalat's are wide, Orange's is square — so
// each is drawn inside a FIXED box and contained, never stretched: three logos of three sizes in
// one column would read as three importances.
import { type ItMobileNetwork } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';

/** Each network's mark, as the client serves it. */
export const MOBILE_NETWORK_LOGO: Readonly<Record<ItMobileNetwork, string>> = {
  vodafone: `${import.meta.env.BASE_URL}it-mobile-lines/vodafone.png`,
  etisalat: `${import.meta.env.BASE_URL}it-mobile-lines/etisalat.png`,
  orange: `${import.meta.env.BASE_URL}it-mobile-lines/orange.png`,
};

const BOX = {
  /** A table row's badge, beside the network's name. */
  sm: 'h-7 w-10 rounded-md p-0.5',
  /** The filter card's mark. */
  lg: 'h-12 w-16 rounded-xl p-1',
} as const;

/**
 * The network's mark in its fixed white box. `decorative` when the network's name is written
 * beside it — a screen reader would otherwise read the name twice.
 */
export const MobileNetworkLogo = ({
  network,
  size = 'sm',
  decorative = false,
}: {
  network: ItMobileNetwork;
  size?: keyof typeof BOX;
  decorative?: boolean;
}): JSX.Element => {
  const t = useT();
  const name = t(`it.mobileLines.network.${network}`);
  return (
    <span
      data-network={network}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden border border-slate-200 bg-white shadow-sm dark:border-slate-700',
        BOX[size],
      )}
    >
      <img
        src={MOBILE_NETWORK_LOGO[network]}
        alt={decorative ? '' : name}
        title={name}
        className="h-full w-full object-contain"
      />
    </span>
  );
};

/** The register's network cell: the mark, then the network's name — the fuel cards' badge idiom. */
export const MobileNetworkBadge = ({ network }: { network: ItMobileNetwork }): JSX.Element => {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <MobileNetworkLogo network={network} decorative />
      <span>{t(`it.mobileLines.network.${network}`)}</span>
    </span>
  );
};
