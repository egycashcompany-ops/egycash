// One source's application link: publish it, replace it, copy it, scan it, and see how many
// people have applied through it.
//
// Every platform opens the SAME form. The link is the only difference — its token names the
// source, so a candidate arriving from Wuzzuf is filed under Wuzzuf without being asked and
// without a second form existing anywhere.
//
// This is the only place in the app that publishes or revokes a link. It used to live inside the
// intake-form page, where it sat beside the field editor and made that screen answer two unrelated
// questions; it moved here whole rather than being copied, so there is still exactly one way to
// put a link into the world.
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { type RecruitmentFormLinkDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Can } from '../../../../../platform/rbac/Can';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { useGenerateFormLink, useRevokeFormLink } from '../../recruitment-form/api/recruitment-form-queries';

export const SourceLink = ({ link }: { link: RecruitmentFormLinkDto }): JSX.Element => {
  const t = useT();
  const generate = useGenerateFormLink();
  const revoke = useRevokeFormLink();
  const [qrOpen, setQrOpen] = useState(false);

  const copy = (): void => {
    // No clipboard over plain HTTP or inside some webviews — show the link instead of failing
    // silently, since it is the whole point of the row.
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (clipboard === undefined || link.url === null) {
      toast.info(t('recruitmentForm.copy'), link.url ?? '');
      return;
    }
    void clipboard
      .writeText(link.url)
      .then(() => toast.success(t('recruitmentForm.copied')))
      .catch(() => toast.info(t('recruitmentForm.copy'), link.url ?? ''));
  };

  if (link.url === null) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-400">{t('recruitmentForm.noLink')}</span>
        <Can permission="recruitmentForm.manage">
          <Button
            size="sm"
            variant="secondary"
            loading={generate.isPending}
            onClick={() => generate.mutate(link.sourceId)}
          >
            {t('recruitmentForm.generate')}
          </Button>
        </Can>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code
        className="max-w-full flex-1 truncate rounded bg-slate-50 px-2 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        dir="ltr"
        title={link.url}
      >
        {link.url}
      </code>
      <Button size="sm" variant="secondary" onClick={copy}>
        {t('recruitmentForm.copy')}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setQrOpen(true)}>
        {t('sources.qr')}
      </Button>
      <Can permission="recruitmentForm.manage">
        <>
          <Button
            size="sm"
            variant="secondary"
            loading={generate.isPending}
            onClick={() => generate.mutate(link.sourceId)}
          >
            {t('recruitmentForm.regenerate')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={revoke.isPending}
            onClick={() => revoke.mutate(link.sourceId)}
          >
            {t('recruitmentForm.revoke')}
          </Button>
        </>
      </Can>

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
            <QRCodeSVG value={link.url} size={220} level="M" />
          </div>
          <code className="break-all text-center text-xs text-slate-500 dark:text-slate-400" dir="ltr">
            {link.url}
          </code>
        </div>
      </Dialog>
    </div>
  );
};
