/**
 * [NiceMatrix] Profile API wrappers for the Account Center UI.
 *
 * All endpoints live under Logto's user-scope `/api/my-account` router and
 * require a valid end-user access token with the `profile` scope (and
 * `address` scope for the address field, and `custom_data` scope for custom
 * data updates).
 */

import type { UserProfile, UserProfileResponse } from '@logto/schemas';

import { createAuthenticatedKy } from './base-ky';

type UpdateProfileResponse = Partial<UserProfileResponse>;

/**
 * Patch OIDC profile sub-fields (familyName/givenName/nickname/birthdate/gender/address/...).
 * Maps to `PATCH /api/my-account/profile`.
 */
export const updateProfile = async (
  accessToken: string,
  payload: Partial<UserProfile>
): Promise<UserProfile> => {
  return createAuthenticatedKy(accessToken)
    .patch('/api/my-account/profile', { json: payload })
    .json<UserProfile>();
};

/**
 * Patch the top-level `name` field on the Logto user record.
 * Used when the user supplies a single "display name" rather than given/family name parts.
 */
export const updateName = async (
  accessToken: string,
  name: string | null
): Promise<UpdateProfileResponse> => {
  return createAuthenticatedKy(accessToken)
    .patch('/api/my-account', { json: { name } })
    .json<UpdateProfileResponse>();
};

/**
 * Upload a new avatar via multipart upload.
 * Maps to NiceMatrix override `POST /api/my-account/avatar`.
 */
export const uploadAvatar = async (
  accessToken: string,
  file: File
): Promise<UpdateProfileResponse> => {
  const formData = new FormData();
  formData.append('file', file);

  return createAuthenticatedKy(accessToken)
    .post('/api/my-account/avatar', { body: formData })
    .json<UpdateProfileResponse>();
};

/**
 * Clear the user's avatar.
 * Maps to NiceMatrix override `DELETE /api/my-account/avatar`.
 */
export const deleteAvatar = async (accessToken: string): Promise<UpdateProfileResponse> => {
  return createAuthenticatedKy(accessToken)
    .delete('/api/my-account/avatar')
    .json<UpdateProfileResponse>();
};
