// The face at the head of a profile, and who may change it.
//
// «عايزك تضيف فى بروفايل كل شخص صورة شخصية ليه .. ويقدر الـ HR يضيفهاله». Everyone who can open
// the profile sees the photo (or the initial); the camera that changes it is HR's — the holders of
// `employee.editPersonal`, the permission that already edits the rest of the person's own data.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type EmployeeDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../../../store/localeSlice';
import { authSlice } from '../../../../store/authSlice';
import { translate } from '../../../../platform/localization/i18n';
import { EmployeePhoto } from './components/EmployeePhoto';
import { myPhotoKey } from '../../../../platform/home/home-api';
import {
  EMPLOYEE_PHOTO_ACCEPT,
  EMPLOYEE_PHOTO_MAX_MB,
  employeePhotoKey,
} from './api/employee-photo';

const HERE = dirname(fileURLToPath(import.meta.url));

const employee = (photoFileId: string | null): EmployeeDto =>
  ({
    id: 'e1',
    personal: { fullNameAr: 'أحمد محمود عبد الرحمن', photoFileId },
  }) as unknown as EmployeeDto;

const render = (photoFileId: string | null, permissions: Record<string, string>): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: { id: 'u1', permissions } as unknown as MeDto, status: 'signedIn' as const },
    },
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <EmployeePhoto employee={employee(photoFileId)} />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const camera = translate('ar', 'employees.photo.title');

describe('the employee photo on the profile', () => {
  it('shows the initial while there is no photo', () => {
    expect(render(null, { 'employee.view': 'organization' })).toMatch(
      /<span aria-hidden="true">أ<\/span>/,
    );
  });

  it('gives HR — employee.editPersonal — the camera that changes it', () => {
    const html = render(null, {
      'employee.view': 'organization',
      'employee.editPersonal': 'organization',
    });
    expect(html).toContain(`aria-label="${camera}"`);
  });

  it('gives a reader without employee.editPersonal no way to change it', () => {
    expect(render('f1', { 'employee.view': 'organization' })).not.toContain(
      `aria-label="${camera}"`,
    );
  });

  it('keys the picture on its file, so a new photo never shows the old one from the cache', () => {
    expect(employeePhotoKey('e1', 'f1')).not.toEqual(employeePhotoKey('e1', 'f2'));
  });

  // Every employee query lives under ['hr', 'employees'], and a realtime change or an edit
  // refreshes that whole prefix. A picture under it would be downloaded again each time — and the
  // old file asked for after it is gone. Keyed by its file, apart, it never needs a refresh.
  it('keeps the picture apart from the employee’s data', () => {
    expect(employeePhotoKey('e1', 'f1').slice(0, 2)).not.toEqual(['hr', 'employees']);
    expect(myPhotoKey('f1').slice(0, 2)).not.toEqual(['hr', 'employees']);
    expect(myPhotoKey('f1')).not.toEqual(myPhotoKey('f2'));
  });

  it('accepts what the server accepts: JPG, PNG or WebP, up to 5 MB', () => {
    expect(EMPLOYEE_PHOTO_ACCEPT.split(',')).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(EMPLOYEE_PHOTO_MAX_MB).toBe(5);
  });

  it('heads the profile page', () => {
    const page = readFileSync(join(HERE, 'pages', 'EmployeeProfilePage.tsx'), 'utf8');
    expect(page).toMatch(/leading=\{<EmployeePhoto employee=\{e\} \/>\}/);
  });
});
