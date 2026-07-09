// Locale + text direction — Arabic RTL is a first-class layout mode.
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { type Locale } from '@ecms/contracts';

interface LocaleState {
  locale: Locale;
  dir: 'rtl' | 'ltr';
}

const initialState: LocaleState = { locale: 'ar', dir: 'rtl' };

export const localeSlice = createSlice({
  name: 'locale',
  initialState,
  reducers: {
    setLocale(state, action: PayloadAction<Locale>) {
      state.locale = action.payload;
      state.dir = action.payload === 'ar' ? 'rtl' : 'ltr';
    },
  },
});

export const { setLocale } = localeSlice.actions;
