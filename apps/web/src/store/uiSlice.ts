// Global CLIENT UI state (ADR-013): theme preference and layout chrome. Never server data.
// Theme is persisted to localStorage (best-effort) so the choice survives reloads; the token
// still never touches storage (ADR-006).
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type ThemeMode = 'light' | 'dark' | 'system';

interface UiState {
  theme: ThemeMode;
  /** Mobile sidebar drawer open/closed. Desktop uses a persistent sidebar. */
  sidebarOpen: boolean;
}

const readTheme = (): ThemeMode => {
  const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem('ecms.theme');
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
};

const initialState: UiState = { theme: readTheme(), sidebarOpen: false };

export const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setTheme(state, action: PayloadAction<ThemeMode>) {
      state.theme = action.payload;
    },
    toggleSidebar(state) {
      state.sidebarOpen = !state.sidebarOpen;
    },
    setSidebarOpen(state, action: PayloadAction<boolean>) {
      state.sidebarOpen = action.payload;
    },
  },
});

export const { setTheme, toggleSidebar, setSidebarOpen } = uiSlice.actions;
