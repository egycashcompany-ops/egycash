// The captain's shell — the shared phone frame (`shared/ui/PhoneShell.tsx`) with the Operations
// defaults: the back arrow goes to the console, and says so.
//
// The frame itself — the sticky header, `min-h-dvh`, the `max-w-2xl` column, the build line at the
// foot — moved to `PhoneShell` when IT's «فحص أجهزة السيارة» became the second phone screen
// (docs/12-planning/it-vehicle-checks-design.md §6.3). It is deliberately NOT `AppShell`; see
// `PhoneShell` for why.
import { type ReactNode } from 'react';
import { useT } from '../../../platform/localization/useT';
import { PhoneShell } from '../../../shared/ui/PhoneShell';

export const CaptainShell = ({
  title,
  subtitle,
  backTo = '/operations',
  children,
}: {
  title: string;
  subtitle?: string;
  /** Where the back arrow goes — the route's own parent: the day for a stop, the console for the day. */
  backTo?: string;
  children: ReactNode;
}): JSX.Element => {
  const t = useT();
  return (
    <PhoneShell
      title={title}
      {...(subtitle === undefined ? {} : { subtitle })}
      backTo={backTo}
      backLabel={t('operations.mobile.backToConsole')}
    >
      {children}
    </PhoneShell>
  );
};
