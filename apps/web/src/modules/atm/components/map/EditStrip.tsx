// The edit-mode toolbar (docs/12-planning/atm-map-zones.md §8.8 `EditStrip`, `Edit.dc.html:66-79`):
// «وضع تعديل القطاعات — فرع X», the unsaved count, undo / redo, «إلغاء التغييرات», «حفظ التغييرات
// (n)» and «خروج من التعديل». It replaces the filter bar while editing; the count is the mockup's
// formula (DM-23), so Sort A–Z on twelve zones is one change.
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { formatNumber } from '../../../../shared/lib/format';
import { Button } from '../../../../shared/ui/Button';
import { StrokeIcon } from '../../../../shared/ui/StrokeIcon';
import { MAP_ICON } from './map-icons';

export const EditStrip = ({
  branchName,
  dirty,
  canUndo,
  canRedo,
  saving,
  locale,
  onUndo,
  onRedo,
  onDiscard,
  onSave,
  onExit,
}: {
  branchName: string;
  dirty: number;
  canUndo: boolean;
  canRedo: boolean;
  saving: boolean;
  locale: Locale;
  onUndo: () => void;
  onRedo: () => void;
  onDiscard: () => void;
  onSave: () => void;
  onExit: () => void;
}): JSX.Element => {
  const t = useT();
  const count = formatNumber(dirty, locale);
  return (
    <div
      role="toolbar"
      aria-label={t('atm.map.edit.banner', { branch: branchName })}
      data-edit-strip="true"
      className="mb-3.5 flex min-h-12 flex-wrap items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 dark:border-amber-800 dark:bg-amber-950"
    >
      <StrokeIcon
        d={MAP_ICON.pencil}
        className="h-[18px] w-[18px] text-amber-700 dark:text-amber-300"
      />
      <strong className="text-sm text-amber-900 dark:text-amber-100">
        {t('atm.map.edit.banner', { branch: branchName })}
      </strong>
      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[13px] text-amber-800 dark:bg-amber-900 dark:text-amber-200">
        {t('atm.map.edit.unsaved', { count })}
      </span>
      <div className="ms-auto flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onUndo} disabled={!canUndo}>
          <span aria-hidden="true">↶</span>
          {t('atm.map.edit.undo')}
        </Button>
        <Button size="sm" variant="secondary" onClick={onRedo} disabled={!canRedo}>
          <span aria-hidden="true">↷</span>
          {t('atm.map.edit.redo')}
        </Button>
        <Button size="sm" variant="secondary" onClick={onDiscard} disabled={dirty === 0}>
          {t('atm.map.edit.discard')}
        </Button>
        <Button size="sm" onClick={onSave} disabled={dirty === 0} loading={saving}>
          {t('atm.map.edit.save', { count })}
        </Button>
        <button
          type="button"
          onClick={onExit}
          className="px-1.5 text-[13px] text-slate-600 underline underline-offset-2 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
        >
          {t('atm.map.edit.exit')}
        </button>
      </div>
    </div>
  );
};
