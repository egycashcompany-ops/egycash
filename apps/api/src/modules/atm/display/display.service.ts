// How the ATM pages read — `atm.display` (2026-11-03, «خلى حجم الكلام فى الصفحات وإذا كان Bold أو
// لأ + درجة لون خطوط الجداول .. أقدر أتحكم فيها من /atm/settings»). One value for the whole
// company: every ATM page reads it, /atm/settings writes it.
import {
  ATM_DEFAULT_DISPLAY,
  AtmDisplaySettingSchema,
  AtmSettingKeys,
  type AtmDisplaySetting,
} from '@ecms/contracts';
import { settingsService, type SettingSubject } from '../../../platform/settings';
import { type AuthContext } from '../../../shared/types';
import { asSettingsEditor, assertAtmSettingsManager } from '../shared/settings-authority';

/** The organization itself — the one level this setting is held at. */
const ORG_SUBJECT: SettingSubject = { userId: null, branchId: null };

class AtmDisplayService {
  /** What every ATM page draws with — the stored value, or the pages as they always read. */
  async get(): Promise<AtmDisplaySetting> {
    const stored = await settingsService.resolve<AtmDisplaySetting>(
      AtmSettingKeys.Display,
      ORG_SUBJECT,
    );
    // A value stored before a field existed reads as the default for it rather than failing the
    // pages: they draw as they always did until the card is saved again.
    const parsed = AtmDisplaySettingSchema.safeParse(stored);
    return parsed.success ? parsed.data : { ...ATM_DEFAULT_DISPLAY, ...pick(stored) };
  }

  /** The card's save: company-wide, `atmSettings.manage` at organization scope. */
  async save(input: AtmDisplaySetting, ctx: AuthContext): Promise<AtmDisplaySetting> {
    assertAtmSettingsManager(ctx);
    await settingsService.set(asSettingsEditor(ctx), {
      key: AtmSettingKeys.Display,
      scope: 'organization',
      value: input,
    });
    return this.get();
  }
}

/** The fields of a stored value that still validate one by one. */
const pick = (stored: unknown): Partial<AtmDisplaySetting> => {
  if (typeof stored !== 'object' || stored === null) return {};
  const shape = AtmDisplaySettingSchema.shape;
  const record = stored as Record<string, unknown>;
  const out: Partial<AtmDisplaySetting> = {};
  const textSize = shape.textSize.safeParse(record.textSize);
  if (textSize.success) out.textSize = textSize.data;
  const bold = shape.bold.safeParse(record.bold);
  if (bold.success) out.bold = bold.data;
  const tableLines = shape.tableLines.safeParse(record.tableLines);
  if (tableLines.success) out.tableLines = tableLines.data;
  return out;
};

export const atmDisplayService = new AtmDisplayService();
