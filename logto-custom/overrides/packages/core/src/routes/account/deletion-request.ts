/**
 * NiceMatrix — user self-service account deletion with a 15-day grace period.
 *
 * Endpoints (all under the Account Center auth, require UserScope.Profile):
 *
 *   GET  /api/my-account/deletion-request
 *     Returns the current open request (if any) for the authenticated user.
 *
 *   POST /api/my-account/deletion-request
 *     Requires identity-verified request (logto-verification-id header, same
 *     pattern as other sensitive endpoints). Creates a row with status
 *     'awaiting_confirmation' and a single-use confirmation token. The email
 *     is sent by NiceMatrix-Backend via the 'account_deletion_requested'
 *     template once it polls the row (or alternatively, pushed via webhook).
 *     Body: { reason?: string }
 *     Response: { id, status, confirmation_token_expires_at }
 *
 *   POST /api/my-account/deletion-request/confirm
 *     Consumes the token (sent to the user by email), flips status to
 *     'pending', and sets scheduled_at = now() + 15 days.
 *     Body: { confirmation_token: string }
 *     Response: { id, status, scheduled_at }
 *
 *   DELETE /api/my-account/deletion-request
 *     Cancels the current open request (either awaiting_confirmation or
 *     pending). Safe to call even if no open request exists (returns 204).
 *
 *   The actual user deletion is executed by NiceMatrix-Backend's cron job,
 *   not by Logto. See apps/api/src/modules/user-deletion.js.
 */

import { UserScope } from '@logto/core-kit';
import { generateStandardId } from '@logto/shared';
import { sql } from '@silverhand/slonik';
import { z } from 'zod';

import RequestError from '#src/errors/RequestError/index.js';
import koaGuard from '#src/middleware/koa-guard.js';
import assertThat from '#src/utils/assert-that.js';

import type { UserRouter, RouterInitArgs } from '../types.js';

import { accountApiPrefix } from './constants.js';

// 15-day grace window from the moment the user CONFIRMS deletion via email.
const DEFAULT_GRACE_WINDOW_MS = 15 * 24 * 60 * 60 * 1000;
// Confirmation token lifetime (email link must be clicked within this).
const CONFIRMATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// NOTE: slonik (via @silverhand/slonik's default `createInterceptorsPreset()`,
// see packages/core/src/env-set/create-pool.ts) decodes Postgres `timestamptz`
// columns to a **millisecond epoch number**, NOT a JS `Date`. These fields are
// typed as `number` so the response mapping (`toIso`) and the expiry comparison
// in the confirm handler stay truthful. Declaring them as `Date` here was the
// root cause of the GET 500: the response guard's `z.date()` rejected the number
// and koa-guard threw `ResponseBodyError`.
type DeletionRequestRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  status: string;
  reason: string | null;
  requested_at: number;
  confirmed_at: number | null;
  scheduled_at: number | null;
  cancelled_at: number | null;
  executed_at: number | null;
  confirmation_token: string | null;
  confirmation_token_expires_at: number | null;
};

// Convert a slonik-decoded `timestamptz` (ms epoch number) to an ISO-8601 string
// for the JSON response, matching the Account Center client contract (which
// types these fields as `string`). Accepts Date/string too so it stays correct
// even if a future type-parser change hands us a different representation.
const toIso = (value: number | Date | string | null): string | null =>
  value === null ? null : new Date(value).toISOString();

const rowToResponse = (row: DeletionRequestRow) => ({
  id: row.id,
  status: row.status,
  reason: row.reason,
  requested_at: toIso(row.requested_at),
  confirmed_at: toIso(row.confirmed_at),
  scheduled_at: toIso(row.scheduled_at),
  cancelled_at: toIso(row.cancelled_at),
});

// We wrap the optional deletion-request row in an envelope so that an
// "empty" response is still a 200 JSON body (`{ request: null }`).
// Returning a bare `null` would make Koa send 204 No Content, which then
// makes `ky.json()` throw SyntaxError on the Account Center side and masks
// the section entirely.
const responseGuard = z.object({
  request: z
    .object({
      id: z.string(),
      status: z.string(),
      reason: z.string().nullable(),
      requested_at: z.string(),
      confirmed_at: z.string().nullable(),
      scheduled_at: z.string().nullable(),
      cancelled_at: z.string().nullable(),
    })
    .nullable(),
});

export default function deletionRequestRoutes<T extends UserRouter>(
  ...[router, tenant]: RouterInitArgs<T>
) {
  const pool = tenant.envSet.pool;
  const tenantId = tenant.id;

  // ── GET current open request ─────────────────────────────────────────────
  router.get(
    `${accountApiPrefix}/deletion-request`,
    koaGuard({
      response: responseGuard,
      status: [200],
    }),
    async (ctx, next) => {
      // GET is a read-only self-query: any authenticated user can read their own
      // pending deletion request without needing the `profile` scope. This avoids
      // a 401 loop that would leave the DeletionSection invisible in the UI.
      const { id: userId } = ctx.auth;

      const row = await pool.maybeOne<DeletionRequestRow>(sql`
        select id, tenant_id, user_id, status, reason,
               requested_at, confirmed_at, scheduled_at, cancelled_at, executed_at,
               confirmation_token, confirmation_token_expires_at
          from user_deletion_requests
         where tenant_id = ${tenantId}
           and user_id = ${userId}
           and status in ('awaiting_confirmation', 'pending')
         order by created_at desc
         limit 1
      `);

      ctx.body = { request: row ? rowToResponse(row) : null };
      return next();
    }
  );

  // ── POST create a new deletion request ───────────────────────────────────
  router.post(
    `${accountApiPrefix}/deletion-request`,
    koaGuard({
      body: z.object({
        reason: z.string().max(2000).optional(),
      }),
      response: z.object({
        id: z.string(),
        status: z.string(),
        confirmation_token: z.string(),
        // ISO-8601 string (see DeletionRequestRow note); matches client contract.
        confirmation_token_expires_at: z.string(),
      }),
      status: [200, 401, 409],
    }),
    async (ctx, next) => {
      const { id: userId, scopes, identityVerified } = ctx.auth;

      assertThat(
        scopes.has(UserScope.Profile),
        new RequestError({ code: 'auth.unauthorized', status: 401 })
      );

      // Require the caller to have passed re-verification (password / MFA /
      // email code) within this verification record. This is the same pattern
      // used by password change and MFA binding.
      assertThat(
        identityVerified,
        new RequestError({ code: 'verification_record.permission_denied', status: 401 })
      );

      // Refuse if there's already an open request (awaiting_confirmation or
      // pending). Partial unique index at the DB level enforces this too, but
      // surface a clean 409 here.
      const existing = await pool.maybeOne<{ id: string; status: string }>(sql`
        select id, status from user_deletion_requests
         where tenant_id = ${tenantId}
           and user_id = ${userId}
           and status in ('awaiting_confirmation', 'pending')
         limit 1
      `);
      if (existing) {
        throw new RequestError({
          code: 'user.deletion_request_already_exists',
          status: 409,
        });
      }

      const id = generateStandardId();
      const token = generateStandardId(32);
      const tokenExpiresAt = new Date(Date.now() + CONFIRMATION_TOKEN_TTL_MS);
      const reason = ctx.guard.body.reason ?? null;
      const ip =
        (typeof ctx.request.ip === 'string' && ctx.request.ip) ||
        (typeof ctx.ip === 'string' && ctx.ip) ||
        null;

      await pool.query(sql`
        insert into user_deletion_requests
          (id, tenant_id, user_id, status, reason, created_ip,
           confirmation_token, confirmation_token_expires_at)
        values
          (${id}, ${tenantId}, ${userId}, 'awaiting_confirmation',
           ${reason}, ${ip}, ${token}, ${tokenExpiresAt.toISOString()})
      `);

      ctx.body = {
        id,
        status: 'awaiting_confirmation',
        confirmation_token: token,
        confirmation_token_expires_at: tokenExpiresAt.toISOString(),
      };
      return next();
    }
  );

  // ── POST confirm via token ──────────────────────────────────────────────
  router.post(
    `${accountApiPrefix}/deletion-request/confirm`,
    koaGuard({
      body: z.object({
        confirmation_token: z.string().min(10),
      }),
      response: z.object({
        id: z.string(),
        status: z.string(),
        // ISO-8601 string (see DeletionRequestRow note); matches client contract.
        scheduled_at: z.string(),
      }),
      status: [200, 400, 401, 404],
    }),
    async (ctx, next) => {
      const { id: userId, scopes } = ctx.auth;
      assertThat(
        scopes.has(UserScope.Profile),
        new RequestError({ code: 'auth.unauthorized', status: 401 })
      );

      const { confirmation_token: token } = ctx.guard.body;

      const row = await pool.maybeOne<DeletionRequestRow>(sql`
        select id, tenant_id, user_id, status, reason,
               requested_at, confirmed_at, scheduled_at, cancelled_at, executed_at,
               confirmation_token, confirmation_token_expires_at
          from user_deletion_requests
         where tenant_id = ${tenantId}
           and user_id = ${userId}
           and confirmation_token = ${token}
           and status = 'awaiting_confirmation'
         limit 1
      `);

      if (!row) {
        throw new RequestError({
          code: 'user.deletion_request_token_invalid',
          status: 404,
        });
      }

      if (
        row.confirmation_token_expires_at !== null &&
        row.confirmation_token_expires_at < Date.now()
      ) {
        throw new RequestError({
          code: 'user.deletion_request_token_expired',
          status: 400,
        });
      }

      const scheduledAt = new Date(Date.now() + DEFAULT_GRACE_WINDOW_MS);

      await pool.query(sql`
        update user_deletion_requests
           set status = 'pending',
               confirmed_at = now(),
               scheduled_at = ${scheduledAt.toISOString()},
               confirmation_token = null,
               confirmation_token_expires_at = null
         where id = ${row.id}
      `);

      ctx.body = {
        id: row.id,
        status: 'pending',
        scheduled_at: scheduledAt.toISOString(),
      };
      return next();
    }
  );

  // ── DELETE cancel current open request ──────────────────────────────────
  router.delete(
    `${accountApiPrefix}/deletion-request`,
    koaGuard({
      status: [204, 401],
    }),
    async (ctx, next) => {
      const { id: userId, scopes } = ctx.auth;
      assertThat(
        scopes.has(UserScope.Profile),
        new RequestError({ code: 'auth.unauthorized', status: 401 })
      );

      await pool.query(sql`
        update user_deletion_requests
           set status = 'cancelled',
               cancelled_at = now(),
               confirmation_token = null,
               confirmation_token_expires_at = null
         where tenant_id = ${tenantId}
           and user_id = ${userId}
           and status in ('awaiting_confirmation', 'pending')
      `);

      ctx.status = 204;
      return next();
    }
  );
}
