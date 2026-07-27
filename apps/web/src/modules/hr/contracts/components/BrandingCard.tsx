// A24 — the company branding profile: configured here, applied by the SERVER at every
// render, and frozen into each generated snapshot (existing documents never change).
import { useEffect, useState } from 'react';
import { useT } from '../../../../platform/localization/useT';
import { Button, Card, CardBody, CardHeader, Field, Input, LoadingState, toast } from '../../../../shared/ui';
import {
  useContractBranding,
  useUpdateContractBranding,
  useUploadContractBrandingLogo,
} from '../api/contract-queries';

export const BrandingCard = (): JSX.Element => {
  const t = useT();
  const { data, isLoading } = useContractBranding();
  const update = useUpdateContractBranding();
  const uploadLogo = useUploadContractBrandingLogo();

  const [headerAr, setHeaderAr] = useState('');
  const [headerEn, setHeaderEn] = useState('');
  const [footerAr, setFooterAr] = useState('');
  const [footerEn, setFooterEn] = useState('');
  const [watermarkAr, setWatermarkAr] = useState('');
  const [watermarkEn, setWatermarkEn] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#111111');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (data === undefined || loaded) return;
    setHeaderAr(data.headerText.ar);
    setHeaderEn(data.headerText.en);
    setFooterAr(data.footerText.ar);
    setFooterEn(data.footerText.en);
    setWatermarkAr(data.watermark.ar);
    setWatermarkEn(data.watermark.en);
    setPrimaryColor(data.primaryColor);
    setLoaded(true);
  }, [data, loaded]);

  const save = async (): Promise<void> => {
    if (data === undefined) return;
    try {
      await update.mutateAsync({
        headerText: { ar: headerAr, en: headerEn },
        footerText: { ar: footerAr, en: footerEn },
        watermark: { ar: watermarkAr, en: watermarkEn },
        primaryColor,
        version: data.version,
      });
      setLoaded(false); // rehydrate with the fresh version
      toast.success(t('contracts.branding.saved'));
    } catch {
      // surfaced globally
    }
  };

  const onLogo = async (file: File | null): Promise<void> => {
    if (file === null) return;
    try {
      await uploadLogo.mutateAsync(file);
      setLoaded(false);
      toast.success(t('contracts.branding.logoSaved'));
    } catch {
      // surfaced globally
    }
  };

  const clearLogo = async (): Promise<void> => {
    if (data === undefined) return;
    try {
      await update.mutateAsync({ logoFileId: null, version: data.version });
      setLoaded(false);
      toast.success(t('contracts.branding.logoCleared'));
    } catch {
      // surfaced globally
    }
  };

  return (
    <Card>
      <CardHeader title={t('contracts.branding.title')} description={t('contracts.branding.subtitle')} />
      <CardBody>
        {isLoading || data === undefined ? (
          <LoadingState />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('contracts.branding.headerAr')}>
                <Input dir="rtl" value={headerAr} onChange={(e) => setHeaderAr(e.target.value)} />
              </Field>
              <Field label={t('contracts.branding.headerEn')}>
                <Input dir="ltr" value={headerEn} onChange={(e) => setHeaderEn(e.target.value)} />
              </Field>
              <Field label={t('contracts.branding.footerAr')}>
                <Input dir="rtl" value={footerAr} onChange={(e) => setFooterAr(e.target.value)} />
              </Field>
              <Field label={t('contracts.branding.footerEn')}>
                <Input dir="ltr" value={footerEn} onChange={(e) => setFooterEn(e.target.value)} />
              </Field>
              <Field label={t('contracts.branding.watermarkAr')}>
                <Input dir="rtl" value={watermarkAr} onChange={(e) => setWatermarkAr(e.target.value)} />
              </Field>
              <Field label={t('contracts.branding.watermarkEn')}>
                <Input dir="ltr" value={watermarkEn} onChange={(e) => setWatermarkEn(e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <Field label={t('contracts.branding.color')}>
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="h-10 w-16 cursor-pointer rounded border border-slate-300 dark:border-slate-600"
                  aria-label={t('contracts.branding.color')}
                />
              </Field>
              <Field
                label={t('contracts.branding.logo')}
                hint={data.logoFileId === null ? t('contracts.branding.logoNone') : t('contracts.branding.logoSet')}
              >
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={(e) => void onLogo(e.target.files?.[0] ?? null)}
                  />
                  {data.logoFileId !== null && (
                    <Button size="sm" variant="ghost" loading={update.isPending} onClick={() => void clearLogo()}>
                      {t('common.remove')}
                    </Button>
                  )}
                </div>
              </Field>
            </div>
            <div className="flex justify-end">
              <Button loading={update.isPending || uploadLogo.isPending} onClick={() => void save()}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
};
