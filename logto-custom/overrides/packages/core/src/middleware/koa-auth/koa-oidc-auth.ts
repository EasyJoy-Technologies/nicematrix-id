/*
 * [NiceMatrix override] vs upstream packages/core/src/middleware/koa-auth/koa-oidc-auth.ts (v1.43.0).
 * Delta (search "[NiceMatrix]"): a verified Social record also sets `identityVerified`, but only
 * when it is bound to the caller AND its third-party user id is the caller's currently linked
 * identity for that connector (`libraries/social-step-up.ts`). Upstream never inserts Social
 * records with a userId, so upstream-created records still fail the ownership check.
 * On upstream sync: re-copy this file and re-apply the two marked edits.
 */
import { TemplateType } from '@logto/connector-kit';
import { VerificationType } from '@logto/schemas';
import type { MiddlewareType } from 'koa';
import type { IRouterParamContext } from 'koa-router';

import RequestError from '#src/errors/RequestError/index.js';
// [NiceMatrix] social step-up binding check.
import { isSocialStepUpBoundToUser } from '#src/libraries/social-step-up.js';
import {
  verificationRecordDataGuard,
  buildVerificationRecord,
  type VerificationRecord,
} from '#src/routes/experience/classes/verifications/index.js';
import type Libraries from '#src/tenants/Libraries.js';
import type Queries from '#src/tenants/Queries.js';
import type TenantContext from '#src/tenants/TenantContext.js';
import assertThat from '#src/utils/assert-that.js';

import { verificationRecordIdHeader } from './constants.js';
import { type WithAuthContext } from './types.js';
import { extractBearerTokenFromHeaders } from './utils.js';

const isUserPermissionVerificationRecord = (record: VerificationRecord) => {
  if (!record.isVerified) {
    return false;
  }

  switch (record.type) {
    case VerificationType.Password:
    // [NiceMatrix] social step-up; the linked-identity match is checked by the caller below.
    case VerificationType.Social: {
      return true;
    }
    case VerificationType.EmailVerificationCode:
    case VerificationType.PhoneVerificationCode: {
      return record.templateType === TemplateType.UserPermissionValidation;
    }
    default: {
      return false;
    }
  }
};

/**
 * Checks whether the verification record exists, belongs to the given user, and can be used for
 * user permission verification.
 */
const getVerificationRecordResultById = async ({
  id,
  queries,
  libraries,
  userId,
}: {
  id: string;
  queries: Queries;
  libraries: Libraries;
  userId: string;
}): Promise<boolean> => {
  const record = await queries.verificationRecords.findActiveVerificationRecordById(id);
  if (record?.userId !== userId) {
    return false;
  }

  const result = verificationRecordDataGuard.safeParse({
    ...record.data,
    id: record.id,
  });

  if (!result.success) {
    return false;
  }

  const instance = buildVerificationRecord(libraries, queries, result.data);
  // [NiceMatrix] Social records must still match the caller's linked identity at use time.
  if (!isUserPermissionVerificationRecord(instance)) {
    return false;
  }
  return isSocialStepUpBoundToUser(libraries, queries, instance, userId);
};

/**
 * Auth middleware for OIDC opaque token
 */
export default function koaOidcAuth<StateT, ContextT extends IRouterParamContext, ResponseBodyT>(
  tenant: TenantContext
): MiddlewareType<StateT, WithAuthContext<ContextT>, ResponseBodyT> {
  const authMiddleware: MiddlewareType<StateT, WithAuthContext<ContextT>, ResponseBodyT> = async (
    ctx,
    next
  ) => {
    const { request } = ctx;
    const accessTokenValue = extractBearerTokenFromHeaders(request.headers);
    const accessToken = await tenant.provider.AccessToken.find(accessTokenValue);

    assertThat(accessToken, new RequestError({ code: 'auth.unauthorized', status: 401 }));

    const { accountId, scopes, clientId, sessionUid } = accessToken;
    assertThat(accountId, new RequestError({ code: 'auth.unauthorized', status: 401 }));
    assertThat(scopes.has('openid'), new RequestError({ code: 'auth.forbidden', status: 403 }));

    const verificationRecordId = request.headers[verificationRecordIdHeader];
    const identityVerified =
      typeof verificationRecordId === 'string'
        ? await getVerificationRecordResultById({
            id: verificationRecordId,
            queries: tenant.queries,
            libraries: tenant.libraries,
            userId: accountId,
          })
        : false;

    ctx.auth = {
      type: 'user',
      id: accountId,
      scopes,
      clientId,
      identityVerified,
      sessionUid,
    };

    return next();
  };

  return authMiddleware;
}
