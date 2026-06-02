import type { ManagementApiRouter, RouterInitArgs } from '../types.js';

import adminUserBasicsRoutes from './basics.js';
// [NiceMatrix override] reverse-lookup user by social identity (target,userId).
import adminUserByIdentityRoutes from './by-identity.js';
import adminUserEnterpriseSsoRoutes from './enterprise-sso.js';
import adminUserGrantRoutes from './grants.js';
import adminUserMfaVerificationsRoutes from './mfa-verifications.js';
import adminUserOrganizationRoutes from './organization.js';
import adminUserPersonalAccessTokenRoutes from './personal-access-token.js';
import adminUserRoleRoutes from './role.js';
import adminUserSearchRoutes from './search.js';
import adminUserSessionRoutes from './session.js';
import adminUserSocialRoutes from './social.js';

export default function adminUserRoutes<T extends ManagementApiRouter>(...args: RouterInitArgs<T>) {
  // [NiceMatrix override] MUST be registered BEFORE adminUserBasicsRoutes so the
  // static path `/users/by-identity` is matched before the `/users/:userId`
  // wildcard in basics.ts (koa-router matches in registration order). Real Logto
  // ids are 12-char nanoids that never equal the literal `by-identity`, so this
  // is belt-and-braces; the ordering makes it unconditionally correct.
  adminUserByIdentityRoutes(...args);
  adminUserBasicsRoutes(...args);
  adminUserRoleRoutes(...args);
  adminUserSearchRoutes(...args);
  adminUserSocialRoutes(...args);
  adminUserOrganizationRoutes(...args);
  adminUserGrantRoutes(...args);
  adminUserMfaVerificationsRoutes(...args);
  adminUserPersonalAccessTokenRoutes(...args);
  adminUserEnterpriseSsoRoutes(...args);
  adminUserSessionRoutes(...args);
}
