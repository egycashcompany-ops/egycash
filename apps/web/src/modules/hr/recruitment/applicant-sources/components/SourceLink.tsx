// One source's application link: publish it, replace it, copy it, scan it, withdraw it.
//
// Every platform opens the SAME form. The link is the only difference — its token names the
// source, so a candidate arriving from Wuzzuf is filed under Wuzzuf without being asked and
// without a second form existing anywhere.
//
// This is the only file in the app that publishes or revokes a link. It exports two pieces because
// a table wants them in two places, and the split follows what each one DOES to the link:
//
//   • `SourceLinkCell` — the link column. The address plus the things you do WITH an address:
//     copy it, open it, show it as a code. Nothing here changes any state.
//   • `SourceLinkActions` — the row's action cell. The two that do: publish/republish, withdraw.
//
// `useGenerateFormLink` and `useRevokeFormLink` are called here and nowhere else, and a guard spec
// fails if that changes.
import { useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { type RecruitmentFormLinkDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useCan } from '../../../../../platform/rbac/Can';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Badge } from '../../../../../shared/ui/Badge';
import {
  ClipboardIcon,
  DownloadIcon,
  ExternalLinkIcon,
  LinkIcon,
  QrIcon,
  ResetIcon,
  TrashIcon,
} from '../../../../../shared/ui/icons';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { useGenerateFormLink, useRevokeFormLink } from '../../recruitment-form/api/recruitment-form-queries';

/**
 * The address without its scheme — `ecms.example.com/apply/9f2c…`. The whole thing is rendered and
 * the chip truncates it with an ellipsis, so a short link is shown in full and a long one still
 * reads as a URL rather than as a fragment of a token. The full address is in the `title` and in
 * the QR dialog.
 */
const readable = (url: string): string => url.replace(/^https?:\/\//, '');

/** Big enough to scan off a screen, and the size the PNG is exported at. */
const QR_SIZE = 260;

/**
 * The QR as a file, so it can go into a poster or a WhatsApp message.
 *
 * The code on screen is an SVG, and there is no browser API that saves one as a raster. The route
 * is: serialize the SVG → load it as an image → paint it on a canvas → export. The white fill is
 * painted first because the SVG's background is transparent, and a transparent PNG dropped on a
 * dark slide stops scanning.
 */
const downloadPng = async (host: HTMLElement | null): Promise<void> => {
  const svg = host?.querySelector('svg');
  if (svg === null || svg === undefined) return;
  const scale = 2; // a crisp print, not a screen-resolution thumbnail
  const source = new XMLSerializer().serializeToString(svg);
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  await new Promise((resolve) => {
    image.onload = resolve;
    image.onerror = resolve;
  });
  const canvas = document.createElement('canvas');
  canvas.width = QR_SIZE * scale;
  canvas.height = QR_SIZE * scale;
  const context = canvas.getContext('2d');
  if (context === null) return;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const anchor = document.createElement('a');
  anchor.href = canvas.toDataURL('image/png');
  anchor.download = 'apply-qr.png';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
};

const copyToClipboard = (url: string, label: string, copied: string): void => {
  // No clipboard over plain HTTP or inside some webviews — show the link instead of failing
  // silently, since it is the whole point of the row.
  const clipboard = navigator.clipboard as Clipboard | undefined;
  if (clipboard === undefined) {
    toast.info(label, url);
    return;
  }
  void clipboard
    .writeText(url)
    .then(() => toast.success(copied))
    .catch(() => toast.info(label, url));
};

/**
 * The link column: the address, and the three things done with an address.
 *
 * Unpublished is a grey chip, not a sentence — "no link" is a STATE of the row, and a column of
 * chips is read at a glance where a column of prose has to be read word by word. Published shows
 * the address itself, because an admin checking their own work wants to see where it points.
 *
 * Copy / open / QR sit next to the link rather than in the row's action cell: they act on the
 * address, they never change anything, and putting them here keeps the actions cell to the four
 * controls that do.
 */
export const SourceLinkCell = ({
  link,
  sourceName,
}: {
  link: RecruitmentFormLinkDto | undefined;
  /** Named on the QR dialog, so a downloaded code is never anonymous. */
  sourceName: string;
}): JSX.Element => {
  const t = useT();
  const [qrOpen, setQrOpen] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);

  if (link === undefined || link.url === null) {
    // The quietest thing on the row: an absent link is the resting state of most platforms, not a
    // warning. Small, grey, and it stops competing with the states that matter.
    return (
      <Badge size="sm" tone="neutral">
        {t('sources.link.none')}
      </Badge>
    );
  }
  const url = link.url;

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      {/* Styled as a LINK, because it is one: link colour at rest, underline on hover, an ellipsis
          when it runs out of room and the full address in the tooltip. New tab and `noopener` —
          leaving the console to look at a form is not what they meant, and the opened page must not
          get a handle on this one. */}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        dir="ltr"
        title={url}
        className="min-w-0 max-w-[18rem] truncate font-mono text-xs text-brand-600 underline-offset-2 hover:underline dark:text-brand-400"
      >
        {readable(url)}
      </a>
      <Button
        size="icon"
        variant="ghost"
        title={t('recruitmentForm.copy')}
        aria-label={t('recruitmentForm.copy')}
        onClick={() => copyToClipboard(url, t('recruitmentForm.copy'), t('recruitmentForm.copied'))}
      >
        <ClipboardIcon className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        title={t('sources.link.open')}
        aria-label={t('sources.link.open')}
        onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
      >
        <ExternalLinkIcon className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        title={t('sources.qr')}
        aria-label={t('sources.qr')}
        onClick={() => setQrOpen(true)}
      >
        <QrIcon className="h-4 w-4" />
      </Button>

      <Dialog
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title={`${t('sources.qr.title')} — ${sourceName}`}
        description={t('sources.qr.body')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setQrOpen(false)}>
              {t('common.close')}
            </Button>
            <Button
              variant="secondary"
              leftIcon={<ExternalLinkIcon className="h-4 w-4" />}
              onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
            >
              {t('sources.link.open')}
            </Button>
            <Button
              variant="secondary"
              leftIcon={<ClipboardIcon className="h-4 w-4" />}
              onClick={() => copyToClipboard(url, t('recruitmentForm.copy'), t('recruitmentForm.copied'))}
            >
              {t('recruitmentForm.copy')}
            </Button>
            <Button leftIcon={<DownloadIcon className="h-4 w-4" />} onClick={() => void downloadPng(qrRef.current)}>
              {t('sources.qr.download')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col items-center gap-4">
          {/* Named above the code as well as in the title: a QR screenshotted or downloaded on its
              own carries no other clue about which platform it belongs to. */}
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{sourceName}</p>
          {/* White quiet zone regardless of theme: a dark-mode QR on a dark card does not scan. */}
          <div ref={qrRef} className="rounded-lg bg-white p-4">
            <QRCodeSVG value={url} size={QR_SIZE} level="M" />
          </div>
          <code className="break-all text-center text-xs text-slate-500 dark:text-slate-400" dir="ltr">
            {url}
          </code>
        </div>
      </Dialog>
    </div>
  );
};

/**
 * The two link actions that change something, as inline icon buttons.
 *
 * Publish is brand-coloured and withdraw is red because in a row of small square buttons the
 * COLOUR is what separates them — an icon at 16px is read after the colour, not before it. Both
 * carry a `title`, so the icon is never the only label.
 *
 * The order is fixed by construction: publish, then withdraw. There is no menu to shuffle.
 */
export const SourceLinkActions = ({
  link,
}: {
  /** `undefined` for a disabled source — the form lists links for active ones only. */
  link: RecruitmentFormLinkDto | undefined;
}): JSX.Element => {
  const t = useT();
  const generate = useGenerateFormLink();
  const revoke = useRevokeFormLink();
  const url = link?.url ?? null;
  const canManageLinks = useCan()('recruitmentForm.manage');

  if (!canManageLinks || link === undefined) return <></>;
  const publishLabel = t(url === null ? 'recruitmentForm.generate' : 'recruitmentForm.regenerate');

  return (
    <>
      <Button
        size="icon"
        variant="ghost-brand"
        loading={generate.isPending}
        title={publishLabel}
        aria-label={publishLabel}
        onClick={() => generate.mutate(link.sourceId)}
      >
        {url === null ? <LinkIcon className="h-4 w-4" /> : <ResetIcon className="h-4 w-4" />}
      </Button>
      {url !== null && (
        <Button
          size="icon"
          variant="ghost-danger"
          loading={revoke.isPending}
          title={t('recruitmentForm.revoke')}
          aria-label={t('recruitmentForm.revoke')}
          onClick={() => revoke.mutate(link.sourceId)}
        >
          <TrashIcon className="h-4 w-4" />
        </Button>
      )}
    </>
  );
};
