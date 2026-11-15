// A live camera view for «take photo»: the rear camera, one button to capture, then a look at the
// shot before using it. Only offered where the browser allows camera access (a secure page with
// `getUserMedia`); elsewhere the photo box falls back to the phone's own camera app.
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../../../../platform/localization/useT';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Spinner } from '../../../../../shared/ui/Spinner';
import { CameraIcon } from '../../../../../shared/ui/icons';

/** True when this page may open the camera itself. */
export const canUseLiveCamera = (): boolean =>
  typeof window !== 'undefined' &&
  window.isSecureContext &&
  typeof navigator !== 'undefined' &&
  typeof navigator.mediaDevices?.getUserMedia === 'function';

export const CameraCapture = ({
  title,
  onCapture,
  onClose,
  onFallback,
}: {
  title: string;
  onCapture: (file: File) => void;
  onClose: () => void;
  /** The camera could not be opened: use the device's own camera app or photo picker instead. */
  onFallback: () => void;
}): JSX.Element => {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [shot, setShot] = useState<{ file: File; url: string } | null>(null);

  // Open the camera on mount; always release it on close — a camera left on keeps the light lit.
  useEffect(() => {
    let live = true;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (!live) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = s;
        if (video.current !== null) {
          video.current.srcObject = s;
          void video.current.play().catch(() => undefined);
        }
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
    };
  }, []);

  useEffect(
    () => () => {
      if (shot !== null) URL.revokeObjectURL(shot.url);
    },
    [shot],
  );

  const capture = (): void => {
    const v = video.current;
    if (v === null || v.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d')?.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob === null) return;
        const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
        setShot({ file, url: URL.createObjectURL(blob) });
      },
      'image/jpeg',
      0.92,
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        shot === null ? (
          <>
            <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
            {failed ? (
              <Button
                onClick={() => {
                  onClose();
                  onFallback();
                }}
              >
                {t('apply.photo.useDevice')}
              </Button>
            ) : (
              <Button leftIcon={<CameraIcon className="h-4 w-4" />} disabled={!ready} onClick={capture}>
                {t('apply.photo.capture')}
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setShot(null)}>{t('apply.photo.retake')}</Button>
            <Button
              onClick={() => {
                onCapture(shot.file);
                onClose();
              }}
            >
              {t('apply.photo.use')}
            </Button>
          </>
        )
      }
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-slate-900">
        {failed ? (
          <p className="grid h-full place-items-center px-6 text-center text-sm text-slate-200">{t('apply.photo.cameraBlocked')}</p>
        ) : (
          <>
            <video
              ref={video}
              playsInline
              muted
              onLoadedMetadata={() => setReady(true)}
              className={shot === null ? 'h-full w-full object-contain' : 'hidden'}
            />
            {shot !== null && <img src={shot.url} alt={title} className="h-full w-full object-contain" />}
            {!ready && shot === null && (
              <span className="absolute inset-0 grid place-items-center text-white">
                <Spinner className="h-6 w-6" />
              </span>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
};
