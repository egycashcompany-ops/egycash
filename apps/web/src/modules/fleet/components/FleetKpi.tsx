// StatCard wrapper for fleet KPI tiles (dashboard + vehicle profile). exactOptionalPropertyTypes:
// StatCard's `value`/`caption` are optional, so a pending metric (undefined ⇒ StatCard's honest
// placeholder dash) is passed by omission, not as undefined.
import { type ComponentType, type SVGProps } from 'react';
import { StatCard } from '../../../shared/ui/StatCard';

export const FleetKpi = ({
  label,
  icon,
  value,
  caption,
}: {
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  value: string | undefined;
  caption: string | undefined;
}): JSX.Element => (
  <StatCard
    label={label}
    icon={icon}
    {...(value === undefined ? {} : { value })}
    {...(caption === undefined ? {} : { caption })}
  />
);
