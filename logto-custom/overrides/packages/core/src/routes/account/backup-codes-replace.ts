/**
 * [NiceMatrix override] new file (no upstream counterpart).
 *
 * POST /api/my-account/mfa-verifications/backup-codes/replace   { codes: string[] } -> 204
 *
 * WHY: upstream only lets a user ADD a backup-code factor when every existing code is used
 * (422 user.backup_code_already_in_use). "Regenerate" therefore meant DELETE + POST: a failure
 * between the two calls left the user with no backup codes at all. This route swaps the old
 * factor for the new one in ONE `updateUserById` write, so the user always holds exactly one
 * valid set (NiceNote account-center review 2026-09-27 §10, item 3).
 *
 * Guards are the same as upstream's `POST /mfa-verifications` BackupCode branch
 * (routes/account/mfa-verifications.ts): verification record, `fields.mfa = Edit`,
 * `identities` scope, first-party client, BackupCode enabled in the sign-in experience,
 * `validateBackupCodes`, and "backup codes can not be the only factor". It never writes
 * `logtoConfig.mfa.enabled` (explicit opt-in, docs/mfa-explicit-optin-plan.md).
 * With no existing backup-code factor it behaves like an add.
 */
import { UserScope } from '@logto/core-kit';
import { AccountCenterControlValue, MfaFactor } from '@logto/schemas';
import { generateStandardId } from '@logto/shared';
import { z } from 'zod';

import RequestError from '#src/errors/RequestError/index.js';
import { validateBackupCodes } from '#src/libraries/verification-helpers/backup-code-validation.js';
import koaGuard from '#src/middleware/koa-guard.js';
import { assertFirstPartyClient } from '#src/utils/assert-first-party-client.js';
import assertThat from '#src/utils/assert-that.js';

import type { UserRouter, RouterInitArgs } from '../types.js';

import { accountApiPrefix } from './constants.js';

export default function backupCodesReplaceRoutes<T extends UserRouter>(
  ...[router, { queries }]: RouterInitArgs<T>
) {
  const {
    users: { updateUserById, findUserById },
    signInExperiences: { findDefaultSignInExperience },
  } = queries;

  router.post(
    `${accountApiPrefix}/mfa-verifications/backup-codes/replace`,
    koaGuard({
      body: z.object({ codes: z.string().array() }),
      status: [204, 400, 401, 403, 422],
    }),
    async (ctx, next) => {
      const { id: userId, scopes, identityVerified, clientId } = ctx.auth;
      assertThat(
        identityVerified,
        new RequestError({ code: 'verification_record.permission_denied', status: 401 })
      );
      assertThat(
        ctx.accountCenter.fields.mfa === AccountCenterControlValue.Edit,
        'account_center.field_not_editable'
      );
      assertThat(
        scopes.has(UserScope.Identities),
        new RequestError({ code: 'auth.unauthorized', status: 401 })
      );
      await assertFirstPartyClient(queries, clientId);

      const { mfa } = await findDefaultSignInExperience();
      assertThat(
        mfa.factors.includes(MfaFactor.BackupCode),
        'session.mfa.mfa_factor_not_enabled'
      );

      const { codes } = ctx.guard.body;
      assertThat(
        validateBackupCodes(codes),
        new RequestError({ code: 'user.wrong_backup_code_format', status: 422 })
      );

      const user = await findUserById(userId);
      const others = user.mfaVerifications.filter(({ type }) => type !== MfaFactor.BackupCode);
      assertThat(
        others.length > 0,
        new RequestError({ code: 'session.mfa.backup_code_can_not_be_alone', status: 422 })
      );

      const updatedUser = await updateUserById(userId, {
        mfaVerifications: [
          ...others,
          {
            id: generateStandardId(),
            createdAt: new Date().toISOString(),
            type: MfaFactor.BackupCode as const,
            codes: codes.map((code) => ({ code })),
          },
        ],
      });

      ctx.appendDataHookContext('User.Data.Updated', { user: updatedUser });
      ctx.status = 204;

      return next();
    }
  );
}
