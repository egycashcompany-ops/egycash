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
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { type RecruitmentFormLinkDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Can } from '../../../../../platform/rbac/Can';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { StatusBadge } from '../../../../../shared/ui/Badge';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { useGenerateFormLink, useRevokeFormLink } from '../../recruitment-form/api/recruitment-form-queries';

/** The tail of the URL — the token — is what tells one platform's link from another's. */
const shorten = (url: string): string => {
  const token = url.split('/apply/')[1] ?? '';
  return token === '' ? url : `…/apply/${token.slice(0, 8)}…`;
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
    <div className="flex items-center gap-2">
      <StatusBadge tone="success" label={t('sources.link.published')} />
      <code
        className="max-w-[12rem] truncate rounded bg-slate-50 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        dir="ltr"
        title={url}
      >
        {shorten(url)}
      </code>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => copyToClipboard(url, t('recruitmentForm.copy'), t('recruitmentForm.copied'))}
      >
        {t('recruitmentForm.copy')}
      </Button>
    </div>
  );
};

/** The link half of a row's actions: publish or replace, show the QR, withdraw. */
export const SourceLinkActions = ({
  link,
}: {
  /** `undefined` for a disabled source — the form lists links for active ones only. */
  link: RecruitmentFormLinkDto | undefined;
}): JSX.Element => {
  const t = useT();
  const generate = useGenerateFormLink();
  const revoke = useRevokeFormLink();
  const [qrOpen, setQrOpen] = useState(false);
  const url = link?.url ?? null;

  return (
    <>
      {url !== null && (
        <Button size="sm" variant="ghost" onClick={() => setQrOpen(true)}>
          {t('sources.qr')}
        </Button>
      )}
      <Can permission="recruitmentForm.manage">
        <>
          <Button
            size="sm"
            variant="ghost"
            disabled={link === undefined}
            loading={generate.isPending}
            onClick={() => link !== undefined && generate.mutate(link.sourceId)}
          >
            {t(url === null ? 'recruitmentForm.generate' : 'recruitmentForm.regenerate')}
          </Button>
          {url !== null && link !== undefined && (
            <Button
              size="sm"
              variant="ghost"
              loading={revoke.isPending}
              onClick={() => revoke.mutate(link.sourceId)}
            >
              {t('recruitmentForm.revoke')}
            </Button>
          )}
        </>
      </Can>

      {url !== null && (
        <Dialog
          open={qrOpen}
          onClose={() => setQrOpen(false)}
          title={t('sources.qr.title')}
          description={t('sources.qr.body')}
          footer={
            <Button variant="secondary" onClick={() => setQrOpen(false)}>
              {t('common.close')}
            </Button>
          }
        >
          <div className="flex flex-col items-center gap-4">
            {/* White quiet zone regardless of theme: a dark-mode QR on a dark card does not scan. */}
            <div className="rounded-lg bg-white p-4">
              <QRCodeSVG value={url} size={220} level="M" />
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
