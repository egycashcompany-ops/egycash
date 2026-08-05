// One source's application link: publish it, replace it, copy it, scan it, withdraw it.
//
// Every platform opens the SAME form. The link is the only difference — its token names the
// source, so a candidate arriving from Wuzzuf is filed under Wuzzuf without being asked and
// without a second form existing anywhere.
//
// This is the only file in the app that publishes or revokes a link. It exports two pieces because
// a table wants them in two places — the state of the link in the column you read, the buttons
// with every other row action — but they are one unit: `useGenerateFormLink` and
// `useRevokeFormLink` are called here and nowhere else, and a guard spec fails if that changes.
import { useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { type RecruitmentFormLinkDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useCan } from '../../../../../platform/rbac/Can';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { StatusBadge } from '../../../../../shared/ui/Badge';
import { ActionMenu, type MenuAction } from '../../../../../shared/ui/ActionMenu';
import { DownloadIcon } from '../../../../../shared/ui/icons';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { useGenerateFormLink, useRevokeFormLink } from '../../recruitment-form/api/recruitment-form-queries';

/**
 * The address without its scheme — `ecms.example.com/apply/9f2c…`. The whole thing is rendered and
 * the CELL truncates it with an ellipsis, so a short link is shown in full and a long one still
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
 * The link column: whether this platform is published, and where to.
 *
 * A badge, not a sentence. "Published" / "no link" is what a recruiter scans a column for, and a
 * chip answers that at a glance where a line of prose has to be read.
 */
export const SourceLinkCell = ({
  link,
}: {
  link: RecruitmentFormLinkDto | undefined;
}): JSX.Element => {
  const t = useT();
  if (link === undefined || link.url === null) {
    return <StatusBadge tone="neutral" label={t('sources.link.none')} />;
  }
  const url = link.url;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <StatusBadge tone="success" label={t('sources.link.published')} />
      <code
        className="min-w-0 max-w-[16rem] flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded bg-slate-50 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        dir="ltr"
        title={url}
      >
        {readable(url)}
      </code>
      <Button
        size="sm"
        variant="ghost"
        aria-label={t('recruitmentForm.copy')}
        onClick={() => copyToClipboard(url, t('recruitmentForm.copy'), t('recruitmentForm.copied'))}
      >
        {t('recruitmentForm.copy')}
      </Button>
    </div>
  );
};

/**
 * A row's actions: one visible button, everything else behind "…".
 *
 * Which one is visible follows what the row is FOR. A platform with no link exists to get one, so
 * "publish" is the button; once it has one, the frequent act is copying it — and that already sits
 * in the link column, next to the address it copies — so the row keeps only the menu. The rest
 * (QR, replace, withdraw) are occasional and belong out of sight.
 *
 * The page's own actions arrive as `extraActions` so a row has ONE menu rather than two: editing a
 * platform and withdrawing its link are the same kind of thing to the person doing them, whatever
 * module owns the code.
 */
export const SourceLinkActions = ({
  link,
  sourceName,
  extraActions = [],
}: {
  /** `undefined` for a disabled source — the form lists links for active ones only. */
  link: RecruitmentFormLinkDto | undefined;
  /** Named on the QR dialog, so a downloaded code is never anonymous. */
  sourceName: string;
  extraActions?: MenuAction[];
}): JSX.Element => {
  const t = useT();
  const generate = useGenerateFormLink();
  const revoke = useRevokeFormLink();
  const [qrOpen, setQrOpen] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);
  const url = link?.url ?? null;
  const can = useCan();
  const canManageLinks = can('recruitmentForm.manage');

  const linkActions: MenuAction[] = [];
  if (url !== null) {
    linkActions.push({ key: 'qr', label: t('sources.qr'), onSelect: () => setQrOpen(true) });
  }
  if (canManageLinks && link !== undefined && url !== null) {
    linkActions.push({
      key: 'regenerate',
      label: t('recruitmentForm.regenerate'),
      onSelect: () => generate.mutate(link.sourceId),
    });
    linkActions.push({
      key: 'revoke',
      label: t('recruitmentForm.revoke'),
      tone: 'danger',
      onSelect: () => revoke.mutate(link.sourceId),
    });
  }

  return (
    <>
      {/* The one visible action, and only when it is the point of the row. */}
      {canManageLinks && link !== undefined && url === null && (
        <Button
          size="sm"
          variant="secondary"
          loading={generate.isPending}
          onClick={() => generate.mutate(link.sourceId)}
        >
          {t('recruitmentForm.generate')}
        </Button>
      )}
      <ActionMenu actions={[...extraActions, ...linkActions]} label={t('common.actions')} />

      {url !== null && (
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
            {/* Named above the code as well as in the title: a QR screenshotted or downloaded on
                its own carries no other clue about which platform it belongs to. */}
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
      )}
    </>
  );
};
