// The chip beside the selected vertex (docs/12-planning/atm-map-zones.md §8.8 `VertexChip`,
// `Edit.dc.html:220-224`): «حذف النقطة» and a note — the zones that share the point, or how to move
// it. A zone keeps three points at least, so the button is off at three with the reason as its title.
import { useT } from '../../../../platform/localization/useT';

export const VertexChip = ({
  canDelete,
  sharedWith,
  onDelete,
}: {
  canDelete: boolean;
  /** The other zones this point belongs to (DM-6), by name. */
  sharedWith: readonly string[];
  onDelete: () => void;
}): JSX.Element => {
  const t = useT();
  const note = !canDelete
    ? t('atm.map.vertex.minThree')
    : sharedWith.length > 0
      ? t('atm.map.vertex.shared', { names: sharedWith.map((name) => `«${name}»`).join(' و') })
      : t('atm.map.edit.dragHint');
  return (
    <div
      data-vertex-chip="true"
      className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-1.5 py-1 shadow-[0_6px_18px_-6px_rgba(15,23,42,0.35)]"
    >
      <button
        type="button"
        onClick={onDelete}
        disabled={!canDelete}
        title={canDelete ? undefined : t('atm.map.vertex.minThree')}
        className="h-7 rounded-md bg-red-50 px-2.5 text-xs text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t('atm.map.vertex.delete')}
      </button>
      <span className="text-[11px] text-slate-500">{note}</span>
    </div>
  );
};
