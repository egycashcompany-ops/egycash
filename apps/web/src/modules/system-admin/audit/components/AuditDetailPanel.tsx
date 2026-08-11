// One audit row, in full — the field-level diff plus the investigative facts.
//
// Exported as a PANEL separate from the dialog that frames it, because `Dialog` portals to
// `document.body` and this workspace's test environment has no DOM. The same shape P9-A's
// setup-link panel and P10's template form take, for the same reason.
//
// **`ip` and `userAgent` live here and nowhere else** (D6). They are investigative data: worth
// having when a row is being questioned, and not worth putting in front of everyone scrolling a
// table of their colleagues' work.
//
// The values shown are already masked by the server (G-1) — the screen never decides what may be
// shown, it only decides where.
import { type AuditLogDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { formatDateTime } from '../../../../shared/lib/format';
import { auditActionLabelKey } from '../lib/audit-labels';

/** A change value as text. `null` is a real value here — "there was nothing before". */
const asText = (value: unknown): string =>
  value === null || value === undefined
    ? '—'
    : typeof value === 'string'
      ? value
      : JSON.stringify(value);

const Fact = ({ label, value, ltr }: { label: string; value: string; ltr?: boolean }): JSX.Element => (
  <div>
    <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
    <dd className="text-sm text-slate-800 dark:text-slate-100" {...(ltr === true ? { dir: 'ltr' } : {})}>
      {value}
    </dd>
  </div>
);

export const AuditDetailPanel = ({ row }: { row: AuditLogDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);

  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-2">
        <Fact label={t('systemAdmin.audit.fields.at')} value={formatDateTime(row.at, locale)} />
        <Fact
          label={t('systemAdmin.audit.fields.action')}
          value={t(auditActionLabelKey(row.action))}
        />
        <Fact
          label={t('systemAdmin.audit.fields.actor')}
          value={
            row.actorSnapshot === null
              ? t('systemAdmin.audit.actorUnknown')
              : row.actorSnapshot.displayName[locale]
          }
        />
        {/* An identifier, never prose. */}
        <Fact
          label={t('systemAdmin.audit.fields.entity')}
          value={`${row.entityRef.moduleId} · ${row.entityRef.entityType} · ${row.entityRef.entityId}`}
          ltr
        />
        {/* D6 — investigative facts, in the panel only. */}
        <Fact label={t('systemAdmin.audit.fields.ip')} value={row.actor.ip ?? '—'} ltr />
        <Fact
          label={t('systemAdmin.audit.fields.userAgent')}
          value={row.actor.userAgent ?? '—'}
          ltr
        />
        <Fact label={t('systemAdmin.audit.fields.requestId')} value={row.requestId ?? '—'} ltr />
      </dl>

      <div>
        <p className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-100">
          {t('systemAdmin.audit.changes')}
        </p>
        {row.changes.length === 0 ? (
          // An audited act with no diff is normal — a login, a download, a denied permission.
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('systemAdmin.audit.noChanges')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start text-xs text-slate-500 dark:text-slate-400">
                  <th className="p-2 text-start">{t('systemAdmin.audit.fields.field')}</th>
                  <th className="p-2 text-start">{t('systemAdmin.audit.fields.old')}</th>
                  <th className="p-2 text-start">{t('systemAdmin.audit.fields.new')}</th>
                </tr>
              </thead>
              <tbody>
                {row.changes.map((change, index) => (
                  <tr
                    key={`${change.field}-${String(index)}`}
                    className="border-t border-slate-100 dark:border-slate-800"
                  >
                    <td className="p-2 font-mono text-xs" dir="ltr">
                      {change.field}
                    </td>
                    <td className="p-2 text-slate-500 dark:text-slate-400">{asText(change.old)}</td>
                    <td className="p-2">{asText(change.new)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
