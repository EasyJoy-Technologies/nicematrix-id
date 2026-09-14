/*
 * [NiceMatrix override] vs upstream packages/core/src/routes/account/mfa-verifications.ts
 * (v1.43.0). Verbatim copy EXCEPT the four `logtoConfig` writes removed below.
 *
 * WHY
 * Upstream 1.42 (`d91696c70`) made the Account API set `logtoConfig.mfa.enabled = true`
 * whenever a user binds a TOTP / backup-code / WebAuthn factor. That means "the user added
 * a verification method" silently becomes "the system turned two-step verification ON for
 * them", which contradicts the NiceMatrix product rule that two-step verification is only
 * on when the user explicitly turns it on.
 *
 * WHAT
 * The four call sites are reverted to the 1.41 behaviour: binding a factor writes ONLY
 * `mfaVerifications` and never touches `logtoConfig.mfa.enabled`. Purely subtractive - no
 * new logic, no new branches. This keeps the 1.41 -> 1.43 upgrade MFA-neutral so any
 * production issue can be attributed to the upgrade itself rather than to a silently
 * changed MFA rule.
 *
 * SAFETY (all 6 readers of `mfa.enabled` in 1.43 were checked)
 *   - `mfa-validator.isMfaRequired` (sign-in enforcement): identical to 1.41.
 *   - `experience/classes/mfa.ts assertOptionalMfaEnablement` (sign-in nudge): the only
 *     visible effect - a user with factors bound but `enabled=false` sees the "turn on
 *     two-step verification" page once; that page has a Skip button which persists
 *     `mfa.skipped=true` and never prompts again. This is exactly today's 1.41 behaviour,
 *     not something this override introduces.
 *   - legacy interaction `mfa-verification.ts`, `account/logto-config.ts`,
 *     `admin-user/basics.ts`, `libraries/user-logto-config.ts`: pass-through reads with no
 *     decision logic - unaffected.
 *
 * SCOPE
 * Stage 1 (upgrade) only. The explicit-opt-in redesign - including the separate,
 * pre-existing `assertMfaEnabledOrSuggest` -> `markMfaEnabled()` silent back-fill path -
 * is stage 2: see docs/mfa-explicit-optin-plan.md. This override is expected to be retired
 * or rewritten there once `user-mfa-state` owns the judgement.
 *
 * On upstream sync: re-copy this file from upstream and re-remove the same four
 * `logtoConfig: buildUpdatedUserLogtoConfig(user, { mfa: { enabled: true } })` writes.
 */
/* eslint-disable max-lines */
import { UserScope } from '@logto/core-kit';
import {
  VerificationType,
  MfaFactor,
  AccountCenterControlValue,
  userMfaVerificationResponseGuard,
} from '@logto/schemas';
import { generateStandardId } from '@logto/shared';
import { z } from 'zod';

import RequestError from '#src/errors/RequestError/index.js';
// [NiceMatrix override] upstream also imports `conditional` from '@silverhand/essentials'
// and `buildUpdatedUserLogtoConfig` from '#src/libraries/user-logto-config.js'; both were
// used solely by the four removed `mfa.enabled` auto-writes.
import {
  generateBackupCodes,
  validateBackupCodes,
} from '#src/libraries/verification-helpers/backup-code-validation.js';
import {
  generateTotpSecret,
  validateTotpSecret,
  validateTotpToken,
} from '#src/libraries/verification-helpers/totp-validation.js';
import { buildVerificationRecordByIdAndType } from '#src/libraries/verification.js';
import koaGuard from '#src/middleware/koa-guard.js';
import { assertFirstPartyClient } from '#src/utils/assert-first-party-client.js';
import assertThat from '#src/utils/assert-that.js';
import { transpileUserMfaVerifications } from '#src/utils/user.js';

import type { UserRouter, RouterInitArgs } from '../types.js';

import { accountApiPrefix } from './constants.js';

export default function mfaVerificationsRoutes<T extends UserRouter>(
  ...[router, { queries, libraries }]: RouterInitArgs<T>
) {
  const {
    users: { updateUserById, findUserById },
    signInExperiences: { findDefaultSignInExperience },
  } = queries;

  router.get(
    `${accountApiPrefix}/mfa-verifications`,
    koaGuard({
      response: userMfaVerificationResponseGuard,
      status: [200, 400, 401],
    }),
    async (ctx, next) => {
      const { id: userId, scopes } = ctx.auth;
      const { fields } = ctx.accountCenter;

      assertThat(
        fields.mfa === AccountCenterControlValue.Edit ||
          fields.mfa === AccountCenterControlValue.ReadOnly,
        'account_center.field_not_enabled'
      );

      assertThat(
        scopes.has(UserScope.Identities),
        new RequestError({ code: 'auth.unauthorized', status: 401 })
      );

      const user = await findUserById(userId);
      ctx.body = transpileUserMfaVerifications(user.mfaVerifications);

      return next();
    }
  );

  router.post(
    `${accountApiPrefix}/mfa-verifications`,
    koaGuard({
      body: z.discriminatedUnion('type', [
        z.object({
          type: z.literal(MfaFactor.WebAuthn),
          newIdentifierVerificationRecordId: z.string(),
          name: z.string().optional(),
        }),
        z.object({
          type: z.literal(MfaFactor.TOTP),
          secret: z.string(),
          code: z.string().optional(),
        }),
        z.object({
          type: z.literal(MfaFactor.BackupCode),
          codes: z.string().array(),
        }),
      ]),
      status: [204, 400, 401, 403, 422],
    }),
    async (ctx, next) => {
      const { id: userId, scopes, identityVerified, clientId } = ctx.auth;
      assertThat(
        identityVerified,
        new RequestError({ code: 'verification_record.permission_denied', status: 401 })
      );
      const { fields } = ctx.accountCenter;
      const isWebAuthn = ctx.guard.body.type === MfaFactor.WebAuthn;
      const passkeyControl = isWebAuthn ? (fields.passkey ?? fields.mfa) : fields.mfa;
      assertThat(
        passkeyControl === AccountCenterControlValue.Edit,
        'account_center.field_not_editable'
      );

      assertThat(
        scopes.has(UserScope.Identities),
        new RequestError({ code: 'auth.unauthorized', status: 401 })
      );
      await assertFirstPartyClient(queries, clientId);

      const user = await findUserById(userId);

      // Check sign in experience, if mfa factor is enabled
      const { mfa, passkeySignIn } = await findDefaultSignInExperience();
      const isFactorEnabled = isWebAuthn
        ? mfa.factors.includes(MfaFactor.WebAuthn) || passkeySignIn.enabled
        : mfa.factors.includes(ctx.guard.body.type);
      assertThat(isFactorEnabled, 'session.mfa.mfa_factor_not_enabled');

      switch (ctx.guard.body.type) {
        case MfaFactor.TOTP: {
          const { secret, code } = ctx.guard.body;

          // A user can only bind one TOTP factor
          assertThat(
            user.mfaVerifications.every(({ type }) => type !== MfaFactor.TOTP),
            new RequestError({
              code: 'user.totp_already_in_use',
              status: 422,
            })
          );

          // Check secret
          assertThat(validateTotpSecret(secret), 'user.totp_secret_invalid');

          // Verify TOTP code if provided
          if (code) {
            assertThat(
              validateTotpToken(secret, code),
              new RequestError({
                code: 'session.mfa.invalid_totp_code',
                status: 400,
              })
            );
          }

          const mfaVerifications = [
            ...user.mfaVerifications,
            {
              id: generateStandardId(),
              createdAt: new Date().toISOString(),
              type: MfaFactor.TOTP as const,
              key: secret,
            },
          ];
          // [NiceMatrix override] upstream 1.42+ `mfa.enabled` auto-write removed (see header).
          const updatedUser = await updateUserById(userId, {
            mfaVerifications,
          });

          ctx.appendDataHookContext('User.Data.Updated', { user: updatedUser });

          break;
        }
        case MfaFactor.BackupCode: {
          // A user can only bind one available backup code factor
          assertThat(
            user.mfaVerifications.every(
              (verification) =>
                verification.type !== MfaFactor.BackupCode ||
                verification.codes.every(({ usedAt }) => usedAt)
            ),
            new RequestError({
              code: 'user.backup_code_already_in_use',
              status: 422,
            })
          );
          assertThat(
            user.mfaVerifications.some(({ type }) => type !== MfaFactor.BackupCode),
            new RequestError({
              code: 'session.mfa.backup_code_can_not_be_alone',
              status: 422,
            })
          );
          assertThat(
            validateBackupCodes(ctx.guard.body.codes),
            new RequestError({
              code: 'user.wrong_backup_code_format',
              status: 422,
            })
          );
          const { codes } = ctx.guard.body;
          const mfaVerifications = [
            ...user.mfaVerifications,
            {
              id: generateStandardId(),
              createdAt: new Date().toISOString(),
              type: MfaFactor.BackupCode as const,
              codes: codes.map((code) => ({ code })),
            },
          ];
          // [NiceMatrix override] upstream 1.42+ `mfa.enabled` auto-write removed (see header).
          const updatedUser = await updateUserById(userId, {
            mfaVerifications,
          });

          ctx.appendDataHookContext('User.Data.Updated', { user: updatedUser });

          break;
        }
        case MfaFactor.WebAuthn: {
          const { newIdentifierVerificationRecordId, name } = ctx.guard.body;
          // Check new identifier
          const newVerificationRecord = await buildVerificationRecordByIdAndType({
            type: VerificationType.WebAuthn,
            id: newIdentifierVerificationRecordId,
            queries,
            libraries,
          });
          assertThat(newVerificationRecord.isVerified, 'verification_record.not_found');

          const bindMfa = newVerificationRecord.toBindMfa();

          const mfaVerifications = [
            ...user.mfaVerifications,
            {
              ...bindMfa,
              id: generateStandardId(),
              createdAt: new Date().toISOString(),
              name,
            },
          ];
          // [NiceMatrix override] upstream 1.42+ conditionally writes
          // `logtoConfig.mfa.enabled = true` here when WebAuthn is an enabled factor.
          // Removed - see file header.
          const updatedUser = await updateUserById(userId, {
            mfaVerifications,
          });

          ctx.appendDataHookContext('User.Data.Updated', { user: updatedUser });

          break;
        }
        // No default
      }

      ctx.status = 204;

      return next();
    }
  );

  router.put(
    `${accountApiPrefix}/mfa-verifications/totp`,
    koaGuard({
      body: z.object({
        secret: z.string(),
        code: z.string(),
      }),
      status: [204, 400, 401, 403],
    }),
    async (ctx, next) => {
      const { id: userId, scopes, identityVerified, clientId } = ctx.auth;
      assertThat(
        identityVerified,
        new RequestError({ code: 'verification_record.permission_denied', status: 401 })
      );
      const { fields } = ctx.accountCenter;
      assertThat(
        fields.mfa === AccountCenterControlValue.Edit,
        'account_center.field_not_editable'
      );

      assertThat(
        scopes.has(UserScope.Identities),
        new RequestError({ code: 'auth.unauthorized', status: 401 })
      );
      await assertFirstPartyClient(queries, clientId);

      const { mfa } = await findDefaultSignInExperience();
      assertThat(mfa.factors.includes(MfaFactor.TOTP), 'session.mfa.mfa_factor_not_enabled');

      const user = await findUserById(userId);

      const { secret, code } = ctx.guard.body;

      assertThat(validateTotpSecret(secret), 'user.totp_secret_invalid');
      assertThat(
        validateTotpToken(secret, code),
        new RequestError({
          code: 'session.mfa.invalid_totp_code',
          status: 400,
        })
      );

      const totpVerification = {
        id: generateStandardId(),
        createdAt: new Date().toISOString(),
        type: MfaFactor.TOTP as const,
        key: secret,
      };

      const existingTotpVerification = user.mfaVerifications.find(
        ({ type }) => type === MfaFactor.TOTP
      );

      const mfaVerifications = existingTotpVerification
        ? user.mfaVerifications.map((mfaVerification) =>
            mfaVerification.id === existingTotpVerification.id ? totpVerification : mfaVerification
          )
        : [...user.mfaVerifications, totpVerification];

      // [NiceMatrix override] upstream 1.42+ `mfa.enabled` auto-write removed (see header).
      const updatedUser = await updateUserById(userId, {
        mfaVerifications,
      });

      ctx.appendDataHookContext('User.Data.Updated', { user: updatedUser });

      ctx.status = 204;

      return next();
    }
  );

  router.post(
    `${accountApiPrefix}/mfa-verifications/totp-secret/generate`,
    koaGuard({
      status: [200],
    }),
    async (ctx, next) => {
      const secret = generateTotpSecret();
      ctx.body = {
        secret,
      };

      return next();
    }
  );

  router.post(
    `${accountApiPrefix}/mfa-verifications/backup-codes/generate`,
    koaGuard({
      status: [200],
    }),
    async (ctx, next) => {
      const codes = generateBackupCodes();
      ctx.body = {
        codes,
      };

      return next();
    }
  );

  router.get(
    `${accountApiPrefix}/mfa-verifications/backup-codes`,
    koaGuard({
      status: [200, 401, 404],
    }),
    async (ctx, next) => {
      const { id: userId, scopes, identityVerified } = ctx.auth;

      assertThat(
        identityVerified,
        new RequestError({ code: 'verification_record.permission_denied', status: 401 })
      );

      assertThat(
        scopes.has(UserScope.Identities),
        new RequestError({ code: 'auth.unauthorized', status: 401 })
      );

      const user = await findUserById(userId);
      const backupCodeVerification = user.mfaVerifications.find(
        (verification) => verification.type === MfaFactor.BackupCode
      );

      assertThat(
        backupCodeVerification,
        new RequestError({ code: 'verification_record.not_found', status: 404 })
      );

      ctx.body = {
        codes: backupCodeVerification.codes.map(({ code, usedAt }) => ({ code, usedAt })),
      };

      return next();
    }
  );

  // Update mfa verification name, only support webauthn
  router.patch(
    `${accountApiPrefix}/mfa-verifications/:verificationId/name`,
    koaGuard({
      params: z.object({
        verificationId: z.string(),
      }),
      body: z.object({
        name: z.string(),
      }),
      status: [200, 400, 401, 403],
    }),
    async (ctx, next) => {
      const { id: userId, scopes, identityVerified, clientId } = ctx.auth;
      assertThat(
        identityVerified,
        new RequestError({ code: 'verification_record.permission_denied', status: 401 })
      );
      const { name } = ctx.guard.body;
      const { fields } = ctx.accountCenter;
      const passkeyControl = fields.passkey ?? fields.mfa;
      assertThat(
        passkeyControl === AccountCenterControlValue.Edit,
        'account_center.field_not_editable'
      );

      assertThat(
        scopes.has(UserScope.Identities),
        new RequestError({ code: 'auth.unauthorized', status: 401 })
      );
      await assertFirstPartyClient(queries, clientId);

      const user = await findUserById(userId);
      const mfaVerification = user.mfaVerifications.find(
        (mfaVerification) =>
          mfaVerification.id === ctx.guard.params.verificationId &&
          mfaVerification.type === MfaFactor.WebAuthn
      );
      assertThat(mfaVerification, 'verification_record.not_found');

      const updatedUser = await updateUserById(userId, {
        mfaVerifications: user.mfaVerifications.map((mfaVerification) =>
          mfaVerification.id === ctx.guard.params.verificationId
            ? { ...mfaVerification, name }
            : mfaVerification
        ),
      });

      ctx.appendDataHookContext('User.Data.Updated', { user: updatedUser });

      ctx.status = 200;

      return next();
    }
  );

  router.delete(
    `${accountApiPrefix}/mfa-verifications/:verificationId`,
    koaGuard({
      params: z.object({
        verificationId: z.string(),
      }),
      status: [204, 400, 401, 403],
    }),
    async (ctx, next) => {
      const { id: userId, scopes, identityVerified, clientId } = ctx.auth;
      assertThat(
        identityVerified,
        new RequestError({ code: 'verification_record.permission_denied', status: 401 })
      );
      assertThat(
        scopes.has(UserScope.Identities),
        new RequestError({ code: 'auth.unauthorized', status: 401 })
      );
      await assertFirstPartyClient(queries, clientId);

      const user = await findUserById(userId);
      const mfaVerification = user.mfaVerifications.find(
        (mfaVerification) => mfaVerification.id === ctx.guard.params.verificationId
      );
      assertThat(mfaVerification, 'verification_record.not_found');

      const { fields } = ctx.accountCenter;
      const isWebAuthnVerification = mfaVerification.type === MfaFactor.WebAuthn;
      const deleteControl = isWebAuthnVerification ? (fields.passkey ?? fields.mfa) : fields.mfa;
      assertThat(
        deleteControl === AccountCenterControlValue.Edit,
        'account_center.field_not_editable'
      );

      const mfaVerifications = user.mfaVerifications.filter(
        (mfaVerification) => mfaVerification.id !== ctx.guard.params.verificationId
      );
      const updatedUser = await updateUserById(userId, {
        mfaVerifications,
      });

      ctx.appendDataHookContext('User.Data.Updated', { user: updatedUser });

      ctx.status = 204;

      return next();
    }
  );
}
/* eslint-enable max-lines */
