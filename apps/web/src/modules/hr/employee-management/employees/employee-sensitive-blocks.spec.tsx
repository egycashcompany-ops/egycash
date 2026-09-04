// The insurance file and the officer profile, and the ONE thing about them that is easy to get
// silently wrong on a screen.
//
// Each block arrives as a nullable payload beside a `…Visible` flag, because `null` means two
// opposite things: "nobody has filed this" and "you may not read this". A card that renders both
// the same way tells a viewer without the permission that an employee has no insurance file — which
// is a false statement about a person, produced by a screen that looks perfectly fine.
//
// So these tests are about which of THREE states each card is in, plus the one placement rule the
// data model exists to protect: an insurance wage bracket must never be presented as pay.
//
// The web suite runs with `environment: 'node'` and no jsdom, so nothing clicks — these assert
// rendered markup, and the edit path is covered by the API contract rather than by a click.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type EmployeeDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../../../store/localeSlice';
import { authSlice } from '../../../../store/authSlice';
import { translate } from '../../../../platform/localization/i18n';
import { EmployeeInsuranceCard } from './components/EmployeeInsuranceCard';
import { EmployeeOfficerCard } from './components/EmployeeOfficerCard';

const INSURANCE = {
  insuranceNumber: '17987259',
  occupation: 'اخصائي موارد بشرية',
  occupationCode: '194200',
  grossWage: 12600,
  contributionWage: 12600,
  // The bracket. Six values exist across the whole company; it is not anybody's salary.
  basicWage: 2370,
  employerShare: 2362.5,
  employeeShare: 1386,
  status: 'insured' as const,
};

const OFFICER = {
  reserveOfficer: true,
  rank: 'عميد',
  weaponLicense: { type: 'company' as const, expiry: '2020-12-13T00:00:00.000Z' },
  professionPractice: true,
  retirementDate: '2022-07-01T00:00:00.000Z',
};

const employee = (over: Partial<EmployeeDto> = {}): EmployeeDto =>
  ({
    id: 'e1',
    version: 3,
    insurance: null,
    insuranceVisible: true,
    officer: null,
    officerVisible: true,
    ...over,
  }) as unknown as EmployeeDto;

const store = (permissions: Record<string, string>) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: { id: 'u1', permissions } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

const render = (node: JSX.Element, permissions: Record<string, string> = {}): string =>
  renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        {node}
      </QueryClientProvider>
    </Provider>,
  );

const ar = (key: string): string => translate('ar', key);

describe('the social insurance card tells its three states apart', () => {
  it('shows the file when it exists and the caller may read it', () => {
    const html = render(<EmployeeInsuranceCard e={employee({ insurance: INSURANCE })} />);
    expect(html).toContain('17987259');
    expect(html).toContain('194200');
    expect(html).toContain(ar('employees.insurance.status.insured'));
  });

  it('says "not recorded" when no file was ever filed', () => {
    const html = render(<EmployeeInsuranceCard e={employee({ insurance: null })} />);
    expect(html).toContain(ar('employees.insurance.none'));
    expect(html).not.toContain(ar('employees.insurance.hidden'));
  });

  /**
   * The case this file exists for. The payload is identical to "not recorded" — both are `null` —
   * so a card keying off the payload alone would tell this viewer the employee has no insurance
   * file. It must key off the flag, and it must not leak a single figure.
   */
  it('says "not permitted" rather than "not recorded" when redacted', () => {
    const html = render(
      <EmployeeInsuranceCard e={employee({ insurance: null, insuranceVisible: false })} />,
    );
    expect(html).toContain(ar('employees.insurance.hidden'));
    expect(html).not.toContain(ar('employees.insurance.none'));
  });

  it('leaks no figure when redacted, even if a payload somehow arrived', () => {
    const html = render(
      <EmployeeInsuranceCard e={employee({ insurance: INSURANCE, insuranceVisible: false })} />,
    );
    expect(html).not.toContain('17987259');
    expect(html).not.toContain('12600');
    expect(html).not.toContain('2370');
  });

  it('offers no edit control without employee.manageInsurance', () => {
    const html = render(<EmployeeInsuranceCard e={employee({ insurance: INSURANCE })} />);
    expect(html).not.toContain(ar('common.edit'));
  });

  it('offers the edit control with it', () => {
    const html = render(<EmployeeInsuranceCard e={employee({ insurance: INSURANCE })} />, {
      'employee.manageInsurance': 'organization',
    });
    expect(html).toContain(ar('common.edit'));
  });

  /**
   * A filed `0` is a real figure — sixteen employees carry `الاجر الأساسي` of zero — and must not
   * render as the em dash that means "not filed".
   */
  it('renders a filed zero as a zero, not as an em dash', () => {
    const html = render(
      <EmployeeInsuranceCard e={employee({ insurance: { ...INSURANCE, basicWage: 0 } })} />,
    );
    expect(html).toContain('>0<');
  });

  it('names the wages as brackets on screen, not as pay', () => {
    const html = render(<EmployeeInsuranceCard e={employee({ insurance: INSURANCE })} />);
    expect(html).toContain(ar('employees.insurance.hint'));
  });
});

describe('the officer card tells its three states apart', () => {
  it('shows the profile when it exists and the caller may read it', () => {
    const html = render(<EmployeeOfficerCard e={employee({ officer: OFFICER })} />);
    expect(html).toContain('عميد');
    expect(html).toContain(ar('employees.officer.license.company'));
    expect(html).toContain(ar('employees.officer.reserveOfficer'));
  });

  it('says "not recorded" for the ~90% of the workforce with no profile', () => {
    const html = render(<EmployeeOfficerCard e={employee({ officer: null })} />);
    expect(html).toContain(ar('employees.officer.none'));
    expect(html).not.toContain(ar('employees.officer.hidden'));
  });

  it('says "not permitted" rather than "not recorded" when redacted', () => {
    const html = render(
      <EmployeeOfficerCard e={employee({ officer: null, officerVisible: false })} />,
    );
    expect(html).toContain(ar('employees.officer.hidden'));
    expect(html).not.toContain(ar('employees.officer.none'));
  });

  it('leaks no rank or licence when redacted', () => {
    const html = render(
      <EmployeeOfficerCard e={employee({ officer: OFFICER, officerVisible: false })} />,
    );
    expect(html).not.toContain('عميد');
  });

  /** An expired weapon licence is a person who must not be rostered armed — it is badged. */
  it('badges an expired weapon licence', () => {
    const html = render(<EmployeeOfficerCard e={employee({ officer: OFFICER })} />);
    expect(html).toContain(ar('employees.officer.licenseExpired'));
  });

  it('does not badge a licence that is still valid', () => {
    const html = render(
      <EmployeeOfficerCard
        e={employee({
          officer: {
            ...OFFICER,
            weaponLicense: { type: 'company' as const, expiry: '2099-12-13T00:00:00.000Z' },
          },
        })}
      />,
    );
    expect(html).not.toContain(ar('employees.officer.licenseExpired'));
  });

  it('does not badge an expiry when there is no licence at all', () => {
    const html = render(
      <EmployeeOfficerCard e={employee({ officer: { ...OFFICER, weaponLicense: null } })} />,
    );
    expect(html).not.toContain(ar('employees.officer.licenseExpired'));
  });

  it('offers no edit control without employee.manageOfficer', () => {
    const html = render(<EmployeeOfficerCard e={employee({ officer: OFFICER })} />);
    expect(html).not.toContain(ar('common.edit'));
  });
});

describe('the two blocks are gated independently', () => {
  it('reading the insurance file never opens the officer profile', () => {
    const e = employee({
      insurance: INSURANCE,
      insuranceVisible: true,
      officer: OFFICER,
      officerVisible: false,
    });
    expect(render(<EmployeeInsuranceCard e={e} />)).toContain('17987259');
    expect(render(<EmployeeOfficerCard e={e} />)).toContain(ar('employees.officer.hidden'));
  });
});
