import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';
import { authSlice } from './authSlice';
import { localeSlice } from './localeSlice';
import { uiSlice } from './uiSlice';

export const store = configureStore({
  reducer: {
    auth: authSlice.reducer,
    locale: localeSlice.reducer,
    ui: uiSlice.reducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

// Best-effort persistence of client preferences (theme + locale). The access token is never
// persisted (ADR-006); only these two UI choices are.
const persist = (key: string, value: string): void => {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    // storage may be unavailable (private mode) — preference is best-effort
    return;
  }
};

let lastTheme = store.getState().ui.theme;
let lastLocale = store.getState().locale.locale;
store.subscribe(() => {
  const state = store.getState();
  if (state.ui.theme !== lastTheme) {
    lastTheme = state.ui.theme;
    persist('ecms.theme', lastTheme);
  }
  if (state.locale.locale !== lastLocale) {
    lastLocale = state.locale.locale;
    persist('ecms.locale', lastLocale);
  }
});
