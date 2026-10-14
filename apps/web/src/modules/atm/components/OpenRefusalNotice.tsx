// The red lines under an open form: the codes the master does not know (the legacy's
// `mach_arr_not_found`, now per request) and the codes the owner's rule left unopened because the
// machine already has an open operation of this kind — or the code was pasted twice in the batch
// (port doc OD-1). Both are named, never silently dropped; the other lines of the batch opened.
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { alreadyOpenCodesKey, joinCodes, type AtmOperationKind } from '../lib/operation-view';

export const OpenRefusalNotice = ({
  kind,
  unknownCodes,
  alreadyOpenCodes,
}: {
  kind: AtmOperationKind;
  unknownCodes: readonly string[];
  alreadyOpenCodes: readonly string[];
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
          {t(alreadyOpenCodesKey(kind), { codes: joinCodes(alreadyOpenCodes, locale) })}
        </p>
      )}
    </>
  );
};
