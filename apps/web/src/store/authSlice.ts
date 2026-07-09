// Redux owns SESSION state only (ADR-013): the signed-in identity + permission set.
// Server data lives in TanStack Query; the access token lives in memory (ADR-006).
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { type MeDto } from '@ecms/contracts';

interface AuthState {
  me: MeDto | null;
  status: 'unknown' | 'signedOut' | 'signedIn';
}

const initialState: AuthState = { me: null, status: 'unknown' };

export const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    signedIn(state, action: PayloadAction<MeDto>) {
      state.me = action.payload;
      state.status = 'signedIn';
    },
    signedOut(state) {
      state.me = null;
      state.status = 'signedOut';
    },
  },
});

export const { signedIn, signedOut } = authSlice.actions;
