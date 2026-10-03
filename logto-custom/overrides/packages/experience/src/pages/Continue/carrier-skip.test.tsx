/**
 * [NiceMatrix] Continue override — "Skip" on the profile-completion pages of a
 * carrier sign-up (review 2026-10-02 B7). Offered only when the App declared
 * carrier, the flow is a registration and the server says skippable.
 */
import { InteractionEvent } from '@logto/schemas';
import { fireEvent, waitFor } from '@testing-library/react';
import { HTTPError } from 'ky';
import { Route, Routes } from 'react-router-dom';

import renderWithPageContext from '@/__mocks__/RenderWithPageContext';
import SettingsProvider from '@/__mocks__/RenderWithPageContext/SettingsProvider';
import { fetchCarrierSkippable, skipCarrierProfile } from '@/apis/carrier-profile-skip';

import Continue from '.';

const mockedNavigate = jest.fn();

jest.mock('i18next', () => ({
  language: 'en',
  t: (key: string) => key,
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockedNavigate,
}));

jest.mock('@/apis/carrier-profile-skip', () => ({
  fetchCarrierSkippable: jest.fn(),
  skipCarrierProfile: jest.fn(),
}));

const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const renderContinue = (interactionEvent: InteractionEvent) =>
  renderWithPageContext(
    <SettingsProvider>
      <Routes>
        <Route path="/continue/:method" element={<Continue />} />
      </Routes>
    </SettingsProvider>,
    {
      initialEntries: [{ pathname: '/continue/username', state: { interactionEvent } }],
    }
  );

describe('Continue — carrier sign-up skip', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
  });

  const declareCarrier = () => {
    sessionStorage.setItem('nmx_carrier_mode', 'native');
    sessionStorage.setItem('nmx_carrier_challenge', challenge);
  };

  it('offers Skip for a skippable carrier sign-up and completes the registration', async () => {
    declareCarrier();
    jest.mocked(fetchCarrierSkippable).mockResolvedValue({ skippable: true });
    jest.mocked(skipCarrierProfile).mockResolvedValue({ redirectTo: '/done' });

    const { findByText } = renderContinue(InteractionEvent.Register);
    fireEvent.click(await findByText('action.nav_skip'));

    await waitFor(() => {
      expect(skipCarrierProfile).toHaveBeenCalledTimes(1);
    });
  });

  it('number taken meanwhile → retry toast and back to sign-in', async () => {
    declareCarrier();
    jest.mocked(fetchCarrierSkippable).mockResolvedValue({ skippable: true });
    jest.mocked(skipCarrierProfile).mockRejectedValue(
      new HTTPError(
        {
          status: 422,
          json: async () => ({ code: 'user.phone_already_in_use', message: 'taken' }),
        } as unknown as Response,
        {} as Request,
        {} as never
      )
    );

    const { findByText } = renderContinue(InteractionEvent.Register);
    fireEvent.click(await findByText('action.nav_skip'));

    await waitFor(() => {
      expect(mockedNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ pathname: '/sign-in' }),
        expect.objectContaining({ replace: true })
      );
    });
  });

  it('no Skip when the server says the sign-up is not skippable', async () => {
    declareCarrier();
    jest.mocked(fetchCarrierSkippable).mockResolvedValue({ skippable: false });

    const { queryByText, findByText } = renderContinue(InteractionEvent.Register);
    await findByText('action.continue');
    await waitFor(() => {
      expect(fetchCarrierSkippable).toHaveBeenCalledTimes(1);
    });
    expect(queryByText('action.nav_skip')).toBeNull();
  });

  it('no Skip when the check fails', async () => {
    declareCarrier();
    jest.mocked(fetchCarrierSkippable).mockRejectedValue(new Error('network'));

    const { queryByText } = renderContinue(InteractionEvent.Register);
    await waitFor(() => {
      expect(fetchCarrierSkippable).toHaveBeenCalledTimes(1);
    });
    expect(queryByText('action.nav_skip')).toBeNull();
  });

  it('upstream page (no request, no Skip) without a carrier declaration', async () => {
    const { findByText, queryByText } = renderContinue(InteractionEvent.Register);
    await findByText('action.continue');
    expect(fetchCarrierSkippable).not.toHaveBeenCalled();
    expect(queryByText('action.nav_skip')).toBeNull();
  });

  it('upstream page (no request, no Skip) when completing the profile at sign-in', async () => {
    declareCarrier();

    const { findByText, queryByText } = renderContinue(InteractionEvent.SignIn);
    await findByText('action.continue');
    expect(fetchCarrierSkippable).not.toHaveBeenCalled();
    expect(queryByText('action.nav_skip')).toBeNull();
  });
});
