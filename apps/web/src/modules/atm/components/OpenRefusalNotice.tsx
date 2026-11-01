// The red lines under an open form: the codes the master does not know (the legacy's
// `mach_arr_not_found`, now per request) and — on the maintenance form — the codes the owner's
// rule left unopened because the machine already has an open maintenance that day, or the code was
// pasted twice in the batch (port doc OD-1). Both are named, never silently dropped; the other
// lines of the batch opened. The replenishment form has no second line: every line of a known
// code opens (OD-1b, 2026-11-01).
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { joinCodes } from '../lib/operation-view';

export const OpenRefusalNotice = ({
  unknownCodes,
  alreadyOpenCodes = [],
}: {
  unknownCodes: readonly string[];
  /** The maintenance form's refused lines (OD-1). */
  alreadyOpenCodes?: readonly string[];
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  return (
    <>
      {unknownCodes.length > 0 && (
        <p className="w-full text-sm text-red-600 dark:text-red-400">
          {t('atm.common.unknownCodes', { codes: joinCodes(unknownCodes, locale) })}
        </p>
      )}
      {alreadyOpenCodes.length > 0 && (
        <p className="w-full text-sm text-red-600 dark:text-red-400" data-refusal="already-open">
          {t('atm.maintenance.alreadyOpenCodes', { codes: joinCodes(alreadyOpenCodes, locale) })}
        </p>
      )}
    </>
  );
};
