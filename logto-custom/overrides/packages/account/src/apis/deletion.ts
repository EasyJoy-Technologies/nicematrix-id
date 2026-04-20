/**
 * [NiceMatrix] Account deletion API wrappers for the Account Center UI.
 *
 * All endpoints live under Logto's user-scope `/api/my-account` router and
 * require a valid end-user access token with the `profile` scope.
 */

import { createAuthenticatedKy } from './base-ky';

export type DeletionRequest = {
  id: string;
  status: 'awaiting_confirmation' | 'pending' | 'cancelled' | 'executed' | 'failed';
  reason: string | null;
  requested_at: string;
  confirmed_at: string | null;
  scheduled_at: string | null;
  cancelled_at: string | null;
};

export type CreateDeletionRequestResponse = {
  id: string;
  status: 'awaiting_confirmation';
  confirmation_token: string;
  confirmation_token_expires_at: string;
};

export const getDeletionRequest = async (
  accessToken: string
): Promise<DeletionRequest | null> => {
  // The server wraps the optional row in `{ request: ... }` so that
  // "no open request" is still a 200 JSON body rather than a 204 empty
  // response (which would throw SyntaxError in `ky.json()`).
  const body = await createAuthenticatedKy(accessToken)
    .get('/api/my-account/deletion-request')
    .json<{ request: DeletionRequest | null }>();
  return body.request;
};

export const createDeletionRequest = async (
  accessToken: string,
  verificationRecordId: string,
  reason?: string
): Promise<CreateDeletionRequestResponse> => {
  return createAuthenticatedKy(accessToken)
    .post('/api/my-account/deletion-request', {
      headers: { 'logto-verification-id': verificationRecordId },
      json: { reason },
    })
    .json<CreateDeletionRequestResponse>();
};

export const confirmDeletionRequest = async (
  accessToken: string,
  token: string
): Promise<{ id: string; status: 'pending'; scheduled_at: string }> => {
  return createAuthenticatedKy(accessToken)
    .post('/api/my-account/deletion-request/confirm', {
      json: { confirmation_token: token },
    })
    .json<{ id: string; status: 'pending'; scheduled_at: string }>();
};

export const cancelDeletionRequest = async (accessToken: string): Promise<void> => {
  await createAuthenticatedKy(accessToken).delete('/api/my-account/deletion-request');
};
