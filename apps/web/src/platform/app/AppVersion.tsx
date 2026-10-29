// «Version 2.1.0 · 390dce6» — the build a person is looking at, in a quiet line wherever a screen
// has room for it. Renders nothing when the build stamped no version, rather than a bare label.
import { useT } from '../localization/useT';
import { cn } from '../../shared/lib/cn';
import { versionText } from './version';

export const AppVersion = ({
  className,
  role,
}: {
  className?: string;
  /** `none` inside a `role="menu"`, where only menu items belong. */
  role?: 'none';
}): JSX.Element | null => {
  const t = useT();
  const text = versionText();
  if (text === '') return null;
  return (
    <p role={role} className={cn('text-[11px] text-slate-500 dark:text-slate-400', className)}>
      {t('platform.shell.version')}{' '}
      {/* A Latin number and hash inside Arabic prose: isolated, or the RTL flow reorders them. */}
      <bdi dir="ltr" className="font-mono tracking-tight">
        {text}
      </bdi>
    </p>
  );
};
