/**
 * [NiceMatrix override]
 * User-scope avatar upload endpoint for the Account Center.
 *
 * Upstream Logto ships `POST /api/user-assets` (management API, requires M2M token).
 * End users signed into `/account` only carry an end-user access token, which
 * cannot access the management API. This module exposes the same upload flow
 * under the user-scope `/api/my-account/avatar` route so the Account Center UI
 * can upload avatar images directly with the signed-in user's token.
 *
 * Flow:
 *   POST /api/my-account/avatar   multipart → R2 → set user.avatar → return url
 *   DELETE /api/my-account/avatar → clear user.avatar
 *
 * Access control:
 *   - requires OIDC access token with `profile` scope
 *   - requires account-center field control `avatar === Edit`
 *   - storage provider must be configured (same as management user-assets route)
 */

import { readFile } from 'node:fs/promises';

import { UserScope } from '@logto/core-kit';
import {
  AccountCenterControlValue,
  allowUploadMimeTypes,
  maxUploadFileSize,
  uploadFileGuard,
  userProfileResponseGuard,
} from '@logto/schemas';
import { generateStandardId } from '@logto/shared';
import { format } from 'date-fns';
import { object } from 'zod';

import RequestError from '#src/errors/RequestError/index.js';
import koaGuard from '#src/middleware/koa-guard.js';
import SystemContext from '#src/tenants/SystemContext.js';
import assertThat from '#src/utils/assert-that.js';
import { getConsoleLogFromContext } from '#src/utils/console.js';
import { buildUploadFile } from '#src/utils/storage/index.js';
import { getTenantId } from '#src/utils/tenant.js';

import type { UserRouter, RouterInitArgs } from '../types.js';

import { accountApiPrefix } from './constants.js';
import { getAccountCenterFilteredProfile, getScopedProfile } from './utils/get-scoped-profile.js';

export default function avatarRoutes<T extends UserRouter>(...args: RouterInitArgs<T>) {
  const [router, { queries, libraries }] = args;
  const {
    users: { updateUserById },
  } = queries;

  router.post(
    `${accountApiPrefix}/avatar`,
    koaGuard({
      files: object({
        file: uploadFileGuard.array().min(1),
      }),
      response: userProfileResponseGuard.partial(),
      status: [200, 400, 401, 422, 500],
    }),
    async (ctx, next) => {
      const { id: userId, scopes } = ctx.auth;
      const { fields } = ctx.accountCenter;

      assertThat(
        fields.avatar === AccountCenterControlValue.Edit,
        'account_center.field_not_editable'
      );
      assertThat(scopes.has(UserScope.Profile), 'auth.unauthorized');

      const { file: bodyFiles } = ctx.guard.files;
      const file = bodyFiles[0];
      assertThat(file, 'guard.invalid_input');
      assertThat(file.size <= maxUploadFileSize, 'guard.file_size_exceeded');
      assertThat(
        allowUploadMimeTypes.map(String).includes(file.mimetype),
        'guard.mime_type_not_allowed'
      );

      const [tenantId] = await getTenantId(ctx.URL);
      assertThat(tenantId, 'guard.can_not_get_tenant_id');

      const { storageProviderConfig } = SystemContext.shared;
      assertThat(storageProviderConfig, 'storage.not_configured');

      const uploadFile = buildUploadFile(storageProviderConfig);
      const objectKey = `${tenantId}/${userId}/avatars/${format(
        new Date(),
        'yyyy/MM/dd'
      )}/${generateStandardId(8)}/${file.originalFilename ?? 'avatar'}`;

      let uploadedUrl: string;
      try {
        const { url } = await uploadFile(await readFile(file.filepath), objectKey, {
          contentType: file.mimetype,
          publicUrl: storageProviderConfig.publicUrl,
        });
        uploadedUrl = url;
      } catch (error: unknown) {
        getConsoleLogFromContext(ctx).error(error);
        throw new RequestError({
          code: 'storage.upload_error',
          status: 500,
        });
      }

      const updatedUser = await updateUserById(userId, { avatar: uploadedUrl });
      ctx.appendDataHookContext('User.Data.Updated', { user: updatedUser });

      const profile = await getScopedProfile(queries, libraries, scopes, userId);
      ctx.body = getAccountCenterFilteredProfile(profile, ctx.accountCenter);

      return next();
    }
  );

  router.delete(
    `${accountApiPrefix}/avatar`,
    koaGuard({
      response: userProfileResponseGuard.partial(),
      status: [200, 400, 401],
    }),
    async (ctx, next) => {
      const { id: userId, scopes } = ctx.auth;
      const { fields } = ctx.accountCenter;

      assertThat(
        fields.avatar === AccountCenterControlValue.Edit,
        'account_center.field_not_editable'
      );
      assertThat(scopes.has(UserScope.Profile), 'auth.unauthorized');

      const updatedUser = await updateUserById(userId, { avatar: null });
      ctx.appendDataHookContext('User.Data.Updated', { user: updatedUser });

      const profile = await getScopedProfile(queries, libraries, scopes, userId);
      ctx.body = getAccountCenterFilteredProfile(profile, ctx.accountCenter);

      return next();
    }
  );
}
