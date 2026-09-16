// A licence scan you can actually READ — the surface, its controls and the gestures.
//
// «الرخصه بعيده ولما عملت زوم بيكبر المتصفح ومش بيكبر الصوره». The preview used to be a plain
// `<img>` in a dialog: the browser's own zoom was the only tool, and that enlarges the whole page
// — sidebar, header, dialog frame — while the picture inside keeps its share of a box that has not
// grown. So the picture gets a zoom of its own. Three ways in, because the reader who needs it is
// not always on a mouse: the buttons, the wheel, and a double-click.
//
// The arithmetic is NOT here. `lib/image-zoom` holds every rule about where the image sits — what
// the pointer keeps under it, how far a drag may go, where a double-click lands — and is driven by
// its own spec. This file is the part that cannot be: elements, listeners, and the measurements it
// hands the rules.
//
// WHY THE WHEEL LISTENER IS ATTACHED BY HAND. React's `onWheel` is registered at the root as a
// PASSIVE listener, and a passive listener may not call `preventDefault` — so the page would scroll
// (or the browser would zoom, on ctrl+wheel) underneath a picture that was zooming at the same
// time. The only way to take the gesture is a non-passive listener on the element itself.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { formatNumber } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { MinusIcon, PlusIcon, ResetIcon } from '../../../shared/ui/icons';
import {
  containSize,
  FIT,
  isZoomed,
  panBy,
  toggleZoom,
  zoomAt,
  zoomByStep,
  zoomPercent,
  ZOOM_STEP,
  type ZoomState,
  type ZoomSurface,
} from '../lib/image-zoom';

const control =
  'inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100';

/**
 * The scan, on a surface that magnifies.
 *
 * `src` is an object URL minted from authorized bytes (the licence is a guarded file — see the
 * hooks in `VehicleLicenseImage` / `DriverLicenseImage`), so this component neither fetches nor
 * revokes: it is handed a URL that is already somebody's responsibility.
 */
export const ZoomableImage = ({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  /** Extra classes for the SURFACE — its height, mainly. */
  className?: string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [zoom, setZoom] = useState<ZoomState>(FIT);
  const [dragging, setDragging] = useState(false);
  /** Where the pointer was at the last move, in client coordinates. Not state: it never renders. */
  const last = useRef<{ x: number; y: number } | null>(null);

  // A NEW PICTURE OPENS AT FIT. Without this, replacing a scan (or opening the next driver's)
  // would inherit the last one's magnification and drop the reader into a corner of an image they
  // have not seen whole yet.
  useEffect(() => {
    setZoom(FIT);
  }, [src]);

  /**
   * What the rules need to know about the screen, measured at the moment of the gesture.
   *
   * Read live rather than stored in state: a dialog can be opened, the window resized and the
   * image swapped without this component re-rendering, and a stale box would clamp the pan to a
   * frame that is no longer there. `null` while the surface has not laid out — no DOM under the
   * test renderer, and nothing sensible to compute from a zero-sized box.
   */
  const surface = useCallback((): ZoomSurface | null => {
    const box = surfaceRef.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0 || box.height === 0) return null;
    const image = imageRef.current;
    const natural = {
      width: image?.naturalWidth ?? 0,
      height: image?.naturalHeight ?? 0,
    };
    return {
      box: { width: box.width, height: box.height },
      content: containSize(natural, { width: box.width, height: box.height }),
    };
  }, []);

  const step = (direction: 1 | -1): void => {
    const surf = surface();
    if (surf !== null) setZoom((state) => zoomByStep(state, direction, surf));
  };

  useEffect(() => {
    const element = surfaceRef.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent): void => {
      const surf = surface();
      if (surf === null) return;
      // Ours now: no page scroll behind the dialog, and no browser zoom on ctrl+wheel — the two
      // things that made the old preview feel like it was ignoring the reader.
      event.preventDefault();
      const box = element.getBoundingClientRect();
      const point = { x: event.clientX - box.left, y: event.clientY - box.top };
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setZoom((state) => zoomAt(state, factor, point, surf));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [surface]);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!isZoomed(zoom)) return;
    last.current = { x: event.clientX, y: event.clientY };
    setDragging(true);
    // Capture, so a fast drag that leaves the surface keeps moving the picture instead of
    // stopping dead at the edge and leaving the reader holding nothing.
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const drag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const from = last.current;
    const surf = surface();
    if (from === null || surf === null) return;
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    last.current = { x: event.clientX, y: event.clientY };
    setZoom((state) => panBy(state, dx, dy, surf));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    last.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const doubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const surf = surface();
    if (surf === null) return;
    const box = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - box.left, y: event.clientY - box.top };
    setZoom((state) => toggleZoom(state, point, surf));
  };

  /**
   * The keyboard, on the surface itself: `+` / `-` / `0`, and the arrows to pan once zoomed.
   *
   * The buttons below are reachable by tab and do the same work; this is for the reader who has
   * already put the pointer on the picture, and it is what makes the surface's `tabIndex` mean
   * something rather than being a focus trap with nothing to do.
   */
  const key = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const surf = surface();
    if (surf === null) return;
    const pan = (dx: number, dy: number): void => {
      event.preventDefault();
      setZoom((state) => panBy(state, dx, dy, surf));
    };
    switch (event.key) {
      case '+':
      case '=':
        event.preventDefault();
        step(1);
        break;
      case '-':
        event.preventDefault();
        step(-1);
        break;
      case '0':
        event.preventDefault();
        setZoom(FIT);
        break;
      case 'ArrowLeft':
        pan(40, 0);
        break;
      case 'ArrowRight':
        pan(-40, 0);
        break;
      case 'ArrowUp':
        pan(0, 40);
        break;
      case 'ArrowDown':
        pan(0, -40);
        break;
      default:
        break;
    }
  };

  const zoomed = isZoomed(zoom);

  return (
    <div className="flex flex-col gap-2" data-zoomable-image="">
      <div
        ref={surfaceRef}
        data-zoom-surface=""
        data-zoomed={zoomed ? 'true' : undefined}
        tabIndex={0}
        role="group"
        aria-label={alt}
        onPointerDown={startDrag}
        onPointerMove={dragging ? drag : undefined}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={doubleClick}
        onKeyDown={key}
        className={cn(
          // `overflow-hidden` is the frame: the magnified image is clipped to it rather than
          // stretching the dialog, which is what keeps the controls where the reader left them.
          'relative flex touch-none select-none items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:border-slate-800 dark:bg-slate-950',
          zoomed ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in',
          // The dialog's body is `max-h-[70vh] overflow-y-auto`, so a surface OF that height fills
          // it and pushes the controls below the fold — measured: the buttons were there and
          // could not be seen. This leaves room for the control row (2rem) and the body's own
          // padding (2rem) plus the gap, so the picture and the way to enlarge it are on screen
          // together, which is the whole point of putting them there.
          className ?? 'h-[calc(70vh-4.5rem)]',
        )}
      >
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          draggable={false}
          // `max-h/max-w-full` + `object-contain` is what makes scale 1 mean «the whole scan»,
          // which is the assumption every rule in `image-zoom` is written against.
          className="max-h-full max-w-full object-contain"
          style={{
            transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
            // No transition: a drag updates this on every pointer move, and an eased transform
            // would make the picture lag the hand by exactly the duration of the ease.
            transformOrigin: 'center center',
            willChange: 'transform',
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-zoom-out=""
          className={control}
          onClick={() => step(-1)}
          disabled={!zoomed}
          aria-label={t('fleet.licenseImage.zoomOut')}
          title={t('fleet.licenseImage.zoomOut')}
        >
          <MinusIcon className="h-4 w-4" />
        </button>
        {/* The readout is a LABEL, not a control: it says where the reader is, and the reset
            beside it is what takes them back. Localized digits, like every other number here. */}
        <span
          data-zoom-level=""
          className="min-w-[3.5rem] text-center text-xs font-medium tabular-nums text-slate-600 dark:text-slate-300"
        >
          {t('fleet.licenseImage.zoomLevel', { value: formatNumber(zoomPercent(zoom), locale) })}
        </span>
        <button
          type="button"
          data-zoom-in=""
          className={control}
          onClick={() => step(1)}
          aria-label={t('fleet.licenseImage.zoomIn')}
          title={t('fleet.licenseImage.zoomIn')}
        >
          <PlusIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          data-zoom-reset=""
          className={control}
          onClick={() => setZoom(FIT)}
          disabled={!zoomed}
          aria-label={t('fleet.licenseImage.zoomReset')}
          title={t('fleet.licenseImage.zoomReset')}
        >
          <ResetIcon className="h-4 w-4" />
        </button>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {t('fleet.licenseImage.zoomHint')}
        </span>
      </div>
    </div>
  );
};
