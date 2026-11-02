// The red line under an open form: the codes the master does not know (the legacy's
// `mach_arr_not_found`, now per request) — named, never silently dropped; the other lines of the
// batch opened. Every line of a known code opens on both forms: a code pasted twice opens twice,
// and a machine already open opens again (replenishments since OD-1b, 2026-11-01; maintenance
// since OD-1c, 2026-11-02).
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { joinCodes } from '../lib/operation-view';

export const OpenRefusalNotice = ({
  unknownCodes,
}: {
  unknownCodes: readonly string[];
}): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  if (unknownCodes.length === 0) return null;
  return (
    <p className="w-full text-sm text-red-600 dark:text-red-400">
      {t('atm.common.unknownCodes', { codes: joinCodes(unknownCodes, locale) })}
    </p>
  );
};
