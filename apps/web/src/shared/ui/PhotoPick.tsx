// «لو فاتح من الموبايل … وهرفع الصوره تسمح ان يبقى فى اختار من الجهاز وان اصور»: on a phone or a
// tablet, adding a photo offers both — the camera, or a picture already on the device. A computer
// keeps its file dialog as it was.
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../platform/localization/useT';
import { cn } from '../lib/cn';

/** A finger, not a mouse: the screens where a camera is one tap away. */
export const isTouchScreen = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches;

const CameraIcon = (): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    className="h-4 w-4 shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <path
      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="13" r="3" />
  </svg>
);

const GalleryIcon = (): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    className="h-4 w-4 shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="M21 16l-5-5-9 9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** The two hidden inputs behind every choice: the device's files, and its camera. */
const useHiddenInputs = (
  accept: string,
  onFile: (file: File) => void,
): {
  device: React.RefObject<HTMLInputElement>;
  camera: React.RefObject<HTMLInputElement>;
  inputs: JSX.Element;
} => {
  const device = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const take = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    // Emptied, so the same picture may be picked again after a failed upload.
    e.target.value = '';
    if (file !== undefined) onFile(file);
  };
  return {
    device,
    camera,
    inputs: (
      <>
        <input ref={device} type="file" accept={accept} className="hidden" onChange={take} />
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          data-photo-camera="true"
          onChange={take}
        />
      </>
    ),
  };
};

/**
 * An upload icon or button. A click on a computer opens the file dialog as before; a tap on a
 * phone opens a small menu — «تصوير بالكاميرا» or «اختيار من الجهاز».
 */
export const PhotoPickButton = ({
  accept,
  onFile,
  disabled = false,
  label,
  className,
  children,
  ...rest
}: {
  accept: string;
  onFile: (file: File) => void;
  disabled?: boolean;
  /** The button's name, read aloud and shown on hover. */
  label: string;
  className?: string;
  children: ReactNode;
} & Record<`data-${string}`, string | undefined>): JSX.Element => {
  const t = useT();
  // Where the menu opens — under the button, on top of the page, so a table's scrolling frame
  // cannot clip it.
  const [open, setOpen] = useState<{ top: number; left: number } | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLSpanElement>(null);
  const { device, camera, inputs } = useHiddenInputs(accept, (file) => {
    setOpen(null);
    onFile(file);
  });
  useEffect(() => {
    if (open === null) return undefined;
    const away = (e: MouseEvent | TouchEvent): void => {
      const target = e.target as Node;
      if (wrap.current?.contains(target) === true || menu.current?.contains(target) === true)
        return;
      setOpen(null);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('touchstart', away);
    };
  }, [open]);
  return (
    <span ref={wrap} className="relative inline-flex">
      <button
        type="button"
        {...rest}
        disabled={disabled}
        aria-label={label}
        title={label}
        aria-expanded={open !== null}
        className={cn('cursor-pointer', className)}
        onClick={(e) => {
          if (!isTouchScreen()) {
            device.current?.click();
            return;
          }
          if (open !== null) {
            setOpen(null);
            return;
          }
          const rect = e.currentTarget.getBoundingClientRect();
          const width = 192;
          setOpen({
            top: rect.bottom + 4,
            left: Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8),
          });
        }}
      >
        {children}
      </button>
      {inputs}
      {open !== null &&
        createPortal(
          <span
            ref={menu}
            role="menu"
            data-photo-menu="true"
            style={{ top: open.top, left: open.left }}
            className="fixed z-[120] flex w-48 flex-col rounded-lg border border-slate-200 bg-white p-1 text-start shadow-lg dark:border-slate-600 dark:bg-slate-800"
          >
            <button
              type="button"
              role="menuitem"
              data-photo-source="camera"
              onClick={() => camera.current?.click()}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              <CameraIcon />
              {t('common.photo.camera')}
            </button>
            <button
              type="button"
              role="menuitem"
              data-photo-source="device"
              onClick={() => device.current?.click()}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              <GalleryIcon />
              {t('common.photo.device')}
            </button>
          </span>,
          document.body,
        )}
    </span>
  );
};

/**
 * Two buttons side by side for a form's photo field on a phone — «تصوير» and «من الجهاز». Renders
 * nothing on a computer, where the field's own file box is the way in.
 */
export const PhotoSourceButtons = ({
  accept,
  onFile,
  disabled = false,
  className,
}: {
  accept: string;
  onFile: (file: File) => void;
  disabled?: boolean;
  className?: string;
}): JSX.Element | null => {
  const t = useT();
  const { device, camera, inputs } = useHiddenInputs(accept, onFile);
  if (!isTouchScreen()) return null;
  const tone =
    'flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-bold transition disabled:opacity-50';
  return (
    <div className={cn('flex gap-2', className)} data-photo-sources="true">
      <button
        type="button"
        data-photo-source="camera"
        disabled={disabled}
        onClick={() => camera.current?.click()}
        className={cn(
          tone,
          'border-brand-500/50 bg-brand-500/15 text-brand-700 hover:bg-brand-500/25 dark:text-brand-200',
        )}
      >
        <CameraIcon />
        {t('common.photo.camera')}
      </button>
      <button
        type="button"
        data-photo-source="device"
        disabled={disabled}
        onClick={() => device.current?.click()}
        className={cn(
          tone,
          'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700',
        )}
      >
        <GalleryIcon />
        {t('common.photo.device')}
      </button>
      {inputs}
    </div>
  );
};
