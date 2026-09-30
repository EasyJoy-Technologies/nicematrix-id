/**
 * [NiceMatrix override] new file (no upstream counterpart).
 *
 * "Re-verify with the linked third-party account" (social step-up) — NiceNote account-center review
 * 2026-09-27 §10 N11 long-term fix + H6. A user who signed up with WeChat / Apple / Google only has
 * no password / email / phone, so upstream offers them no way to prove identity for a sensitive
 * Account API call.
 *
 * A Social verification record counts as identity verification ONLY when all of these hold:
 *   1. the record row carries `userId` = the caller (only `routes/account/social-step-up.ts`
 *      inserts Social records with a userId; upstream `/api/verifications/social` never does);
 *   2. the record is verified (an third-party authorization was completed);
 *   3. the caller STILL has an identity for the record's connector target, and its third-party
 *      userId equals the one the authorization returned.
 * Check 3 runs at USE time, not only at creation: upstream `/api/verifications/social/verify`
 * accepts any record id, so a holder of a stolen bearer token could complete the same record with
 * their OWN third-party account; that record is verified but never matches the victim's identity.
 *
 * Used by `middleware/koa-auth/koa-oidc-auth.ts` (Account API `identityVerified`) and
 * `routes/admin-user/verification-records.ts` (Backend native bind/unbind gate).
 */
import { VerificationType } from '@logto/schemas';

import type { VerificationRecord } from '#src/routes/experience/classes/verifications/index.js';
import type Libraries from '#src/tenants/Libraries.js';
import type Queries from '#src/tenants/Queries.js';

/** Connector target (e.g. 'apple', 'wechat') for a connector id; undefined if unknown. */
export const getSocialTarget = async (
  libraries: Libraries,
  connectorId: string
): Promise<string | undefined> => {
  try {
    const connector = await libraries.socials.getConnector(connectorId);
    return connector.metadata.target;
  } catch {
    return undefined;
  }
};

/** True when `providerUserId` is the caller's currently linked identity for `target`. */
export const isLinkedIdentity = async (
  queries: Queries,
  userId: string,
  target: string,
  providerUserId: string
): Promise<boolean> => {
  const user = await queries.users.findUserById(userId);
  const identity = user.identities[target];
  return Boolean(identity) && identity?.userId === providerUserId;
};

/**
 * Extra condition for Social records (check 3 above); every other record type passes through
 * unchanged. Call only after ownership (`record.userId === userId`) and `isVerified` hold.
 */
export const isSocialStepUpBoundToUser = async (
  libraries: Libraries,
  queries: Queries,
  record: VerificationRecord,
  userId: string
): Promise<boolean> => {
  if (record.type !== VerificationType.Social) {
    return true;
  }
  const providerUserId = record.socialUserInfo?.id;
  if (!providerUserId) {
    return false;
  }
  const target = await getSocialTarget(libraries, record.connectorId);
  return Boolean(target) && isLinkedIdentity(queries, userId, target ?? '', providerUserId);
};
