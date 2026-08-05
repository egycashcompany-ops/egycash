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
import { RowActions } from '../../../../../shared/ui/RowActions';
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
 * The address as a person reads it: `careers.example.com/apply/…`.
 *
 * The last segment is a 32-character token — the one part of the URL that carries no meaning to a
 * human and, at this width, the part that would push everything else out. Dropping it to an
 * ellipsis leaves the half that identifies the link (which site, which path) and is honest about
 * there being more. The full address stays in the `title`, in the QR dialog, and in what Copy puts
 * on the clipboard.
 */
const readable = (url: string): string => {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter((s) => s !== '');
    if (segments.length === 0) return parsed.host;
    return [parsed.host, ...segments.slice(0, -1), '…'].join('/');
  } catch {
    // Not a URL we can parse — show it as it came rather than nothing at all.
    return url.replace(/^https?:\/\//, '');
  }
};

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
 * The link column: whether this platform is published, and where to.
 *
 * Unpublished is a hollow ring and a muted word — the quietest thing on the row, because an absent
 * link is the resting state of most platforms and not a warning. Published is a filled dot and the
 * ADDRESS itself: with the URL on screen there is nothing for the word "published" to add, and the
 * dot carries the state for anyone scanning the column rather than reading it.
 *
 * Copy stays visible — it is what this column is FOR. Open and QR are occasional, so they appear
 * with the row (see `RowActions`) instead of repeating down the page.
 */
export const SourceLinkCell = ({
  link,
  sourceName,
  publishedAt,
}: {
  link: RecruitmentFormLinkDto | undefined;
  /** Named on the QR dialog, so a downloaded code is never anonymous. */
  sourceName: string;
  /**
   * When the link was last published, already formatted for the reader's locale.
   *
   * It lives HERE, under the address, rather than in a column of its own: it is a fact about the
   * link, only published rows have one, and a column that is a dash on every unpublished row is
   * width spent on nothing.
   */
  publishedAt?: string;
}): JSX.Element => {
  const t = useT();
  const [qrOpen, setQrOpen] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);

  if (link === undefined || link.url === null) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-400 dark:text-slate-500">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-current" />
        {t('sources.link.none')}
      </span>
    );
  }
  const url = link.url;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
        title={t('sources.link.published')}
        aria-label={t('sources.link.published')}
      />
      <span className="min-w-0 flex-1">
        {/* Styled as a LINK, because it is one: link colour at rest, underline on hover, an ellipsis
            when it runs out of room and the full address in the tooltip. New tab and `noopener` —
            leaving the console to look at a form is not what they meant, and the opened page must
            not get a handle on this one. */}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          dir="ltr"
          title={url}
          className="block truncate font-mono text-xs text-brand-600 underline-offset-2 hover:underline dark:text-brand-400"
        >
          {readable(url)}
        </a>
        {publishedAt !== undefined && (
          <span className="block truncate text-[11px] leading-tight text-slate-400 dark:text-slate-500">
            {t('sources.publishedAt')}: {publishedAt}
          </span>
        )}
      </span>
      <Button
        size="icon"
        variant="ghost"
        className="shrink-0"
        title={t('recruitmentForm.copy')}
        aria-label={t('recruitmentForm.copy')}
        onClick={() => copyToClipboard(url, t('recruitmentForm.copy'), t('recruitmentForm.copied'))}
      >
        <ClipboardIcon className="h-4 w-4" />
      </Button>
      <RowActions className="shrink-0">
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
      </RowActions>

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
 * The two link actions that change something — with a hierarchy, not a row of equals.
 *
 * A platform with no link EXISTS to get one, so that row gets a labelled button: it is the next
 * thing to do and it says so in words. Once published there is no next thing, so replacing and
 * withdrawing the link become secondary and appear with the row.
 *
 * That is what stops the table looking like a control panel: most rows show one action or none,
 * and the rest arrive when you reach for them.
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

  if (url === null) {
    // The most important action on the screen, so it looks like an action: a small secondary
    // button with a word on it. Copy / open / QR are the icon buttons — they act on an address
    // that is already there, where this one is the step that creates it.
    return (
      <Button
        size="sm"
        variant="secondary"
        loading={generate.isPending}
        leftIcon={<LinkIcon className="h-3.5 w-3.5" />}
        onClick={() => generate.mutate(link.sourceId)}
      >
        {t('recruitmentForm.generate')}
      </Button>
    );
  }

  return (
    <RowActions>
      <Button
        size="icon"
        variant="ghost-brand"
        loading={generate.isPending}
        title={t('recruitmentForm.regenerate')}
        aria-label={t('recruitmentForm.regenerate')}
        onClick={() => generate.mutate(link.sourceId)}
      >
        <ResetIcon className="h-4 w-4" />
      </Button>
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
    </RowActions>
  );
};
