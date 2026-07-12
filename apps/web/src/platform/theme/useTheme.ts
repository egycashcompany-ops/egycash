// Theme access for the topbar toggle: current mode + a light → dark → system cycle.
import { useAppDispatch, useAppSelector } from '../../store';
import { setTheme, type ThemeMode } from '../../store/uiSlice';

const NEXT: Record<ThemeMode, ThemeMode> = { light: 'dark', dark: 'system', system: 'light' };

export const useTheme = (): {
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  cycle: () => void;
} => {
  const theme = useAppSelector((state) => state.ui.theme);
  const dispatch = useAppDispatch();
  return {
    theme,
    setTheme: (mode: ThemeMode) => dispatch(setTheme(mode)),
    cycle: () => dispatch(setTheme(NEXT[theme])),
  };
};
