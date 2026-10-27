// The duplicate warning for one field (S-7, DS-15, §9.6): what the form found at once, and what the
// server found after a save — where else the same value is recorded, without revealing a line
// outside the reader's reach. Warnings only: nothing here blocks a save or «تم التجهيز».
import { type AtmSealDuplicateDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { formatPaperDate } from '../../lib/settlement-dates';
import { type LocalDuplicate } from '../../lib/preparation-form';

type Translate = (key: string, params?: Record<string, string | number>) => string;

const LOCAL_KEY: Readonly<Record<LocalDuplicate['code'], string>> = {
  SEAL_REPEATED: 'atm.prep.duplicate.seal',
  QR_REPEATED: 'atm.prep.duplicate.qr',
  OTHER_FIELD: 'atm.prep.duplicate.otherField',
};

/**
 * The sentences for one field. A local repeat is said as the form sees it now; the server's
 * same-line matches are what the SAVED values say, so they are dropped when the form already says
 * it (the two would repeat each other after a save). Every other match is one «تنبيه» sentence
 * naming each line — «مسلسل 12 · 1001 · 27/10/2026», or «سطر خارج نطاق صلاحيتك» — and, when it was
 * recorded there as the other kind, «(مسجل هناك كـ QR شوال)» / «(مسجل هناك كسيلز كاسيت)».
 */
export const duplicateTexts = (
  local: LocalDuplicate | undefined,
  server: AtmSealDuplicateDto | undefined,
  t: Translate,
): string[] => {
  const out: string[] = [];
  if (local !== undefined) out.push(t(LOCAL_KEY[local.code]));
  if (server === undefined) return out;
  if (local === undefined) {
    for (const match of server.matches) {
      if (!('sameLine' in match)) continue;
      out.push(
        t(
          match.otherField.field === server.field
            ? server.field === 'seal'
              ? LOCAL_KEY.SEAL_REPEATED
              : LOCAL_KEY.QR_REPEATED
            : LOCAL_KEY.OTHER_FIELD,
        ),
      );
      break;
    }
  }
  const where = server.matches.flatMap((match) => {
    if ('sameLine' in match) return [];
    if ('outsideReach' in match) return [t('atm.prep.duplicate.outsideReach')];
    const place = t('atm.prep.duplicate.where', {
      serial: match.serial === null ? '—' : match.serial,
      code: match.machineCode ?? match.spareCode ?? '—',
      date: formatPaperDate(match.replenishDate),
    });
    if (match.matchedField === server.field) return [place];
    const as =
      match.matchedField === 'bag' ? 'atm.prep.duplicate.asQr' : 'atm.prep.duplicate.asSeal';
    return [`${place} ${t(as)}`];
  });
  if (where.length > 0) out.push(t('atm.prep.duplicate.server', { where: where.join('، ') }));
  return out;
};

/** The texts, each on its own line; the caller places them in its `aria-live` region. */
export const DuplicateNote = ({
  local,
  server,
}: {
  local: LocalDuplicate | undefined;
  server: AtmSealDuplicateDto | undefined;
}): JSX.Element | null => {
  const t = useT();
  const texts = duplicateTexts(local, server, t);
  if (texts.length === 0) return null;
  return (
    <span data-duplicate-note="true" className="block space-y-0.5">
      {texts.map((text) => (
        <span key={text} className="block">
          ⚠ {text}
        </span>
      ))}
    </span>
  );
};
