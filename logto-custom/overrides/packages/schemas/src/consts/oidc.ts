import { z } from 'zod';

import { type CustomClientMetadata } from '../foundations/index.js';
import { type ToZodObject } from '../utils/zod.js';

import { inSeconds } from './date.js';

export const tenantIdKey = 'tenant_id';

export const oidcRoutes = Object.freeze({
  codeVerification: '/oidc/device',
} as const);

export const customClientMetadataDefault = Object.freeze({
  idTokenTtl: inSeconds.oneHour,
  // [NiceMatrix override] Default refresh-token TTL raised 14 -> 60 days (2026-06-10)
  // to reduce inactivity-based forced logouts on the 12 Native business client apps,
  // which carry no explicit `refreshTokenTtlInDays` and therefore inherit this default.
  // Apps with an explicit value (consoles: NiceMatrix Admin / Email System / OmniFire /
  // bbs = 14) are unaffected; the built-in `admin-console` is pinned to 14 separately.
  // Capped at 180 by the schema guard; Grant ceiling stays 180d. Why-not-per-app: a
  // per-app PATCH is wiped wholesale by syncAppToLogto() on the next admin edit.
  refreshTokenTtlInDays: 60,
  rotateRefreshToken: true,
} as const satisfies Partial<CustomClientMetadata>);

export enum ExtraParamsKey {
  /**
   * @deprecated Use {@link FirstScreen} instead.
   * @see {@link InteractionMode} for the available values.
   */
  InteractionMode = 'interaction_mode',
  /**
   * The first screen to show for the user.
   *
   * @see {@link FirstScreen} for the available values.
   */
  FirstScreen = 'first_screen',
  /**
   * Directly sign in via the specified method. Note that the method must be properly configured
   * in Logto.
   *
   * @remark
   * The format of the value for this key is one of the following:
   *
   * - `social:<target>` (Use a social connector with the specified target, e.g. `social:google`)
   * - `sso:<connector-id>` (Use the specified SSO connector, e.g. `sso:123456`)
   */
  DirectSignIn = 'direct_sign_in',
  /**
   * Override the default sign-in experience configuration with the settings from the specified
   * organization ID.
   */
  OrganizationId = 'organization_id',
  /**
   * Provides a hint about the login identifier the user might use.
   * This can be used to pre-fill the identifier field **only on the first screen** of the sign-in/sign-up flow.
   */
  LoginHint = 'login_hint',
  /**
   * The end-users preferred languages to use for the client application, represented as a space-separated list of BCP47 language tags.
   * E.g. `en` or `en-US` or `en-US en`.
   *
   * @see {@link https://openid.net/specs/openid-connect-core-1_0.html#rfc.section.13.2.1}
   */
  UiLocales = 'ui_locales',
  /**
   * Specifies the identifier used in the identifier sign-in or identifier register page.
   *
   * This parameter is applicable only when first_screen is set to either `FirstScreen.IdentifierSignIn` or `FirstScreen.IdentifierRegister`.
   * Multiple identifiers can be provided in the identifier parameter, separated by spaces.
   *
   * If the provided identifier is not supported in the Logto sign-in experience configuration, it will be ignored,
   * and if no one of them is supported, it will fallback to the sign-in / sign-up method value set in the sign-in experience configuration.
   *
   * @see {@link SignInIdentifier} for available values.
   */
  Identifier = 'identifier',
  /**
   * The one-time token used as a proof for the user's identity. Example use case: Magic link.
   */
  OneTimeToken = 'one_time_token',
  /**
   * The Google One Tap credential JWT token for external website integration.
   */
  GoogleOneTapCredential = 'google_one_tap_credential',
  /**
   * [NiceMatrix] The server-generated device UUID from POST /v1/devices/register.
   * Passed through to PostSignIn webhook payload for login device control.
   */
  DeviceRef = 'device_ref',
  /**
   * [NiceMatrix] The application slug identifying which NiceMatrix app the user is signing into.
   * Passed through to PostSignIn webhook payload for per-app login control.
   */
  AppSlug = 'app_slug',
  /**
   * [NiceMatrix] Comma-separated list of native social providers the device can take over
   * via App-side SDKs (e.g. `wechat,alipay,qq`). Whitelisted client-side; structural
   * pass-through here. See `packages/experience/src/utils/native-caps.ts`.
   */
  NativeCaps = 'native_caps',
  /**
   * [NiceMatrix] Custom URL scheme of the calling App (e.g. `cn.nicematrix.toolbox`).
   * Combined with NativeCaps + AppSlug to enable native takeover of social sign-in.
   * Validated client-side against a denylist of dangerous schemes.
   */
  NativeScheme = 'native_scheme',
  /**
   * [NiceMatrix] Comma-separated list of social connector targets to HIDE on the
   * hosted login page (blacklist), e.g. `google,facebook` for a cn build.
   * Client-side only (pure UI visibility); the connector is still returned by
   * `/.well-known/experience`. Only affects SOCIAL buttons — email/password are
   * never hideable. See `packages/experience/src/utils/native-caps.ts`.
   */
  HideSocial = 'hide_social',
  /**
   * [NiceMatrix] Comma-separated whitelist of social connector targets to SHOW on
   * the hosted login page; any social provider not listed is hidden. Combine with
   * HideSocial: visible = (target in show, or show absent) AND target not in hide.
   * Client-side only; never affects email/password. See native-caps.ts.
   */
  ShowSocial = 'show_social',
  /**
   * [NiceMatrix] The deployment region this sign-in belongs to (`intl` | `cn`).
   * Self-reported by the client (= its build flavor / the API base it talks to).
   * Passed through to the PostSignIn webhook payload so that, when the SAME
   * event is fanned out to both regions' hooks (prod-1 + prod-3), each backend
   * processes ONLY its own region and ignores the rest. See the cross-region
   * device-routing design (§6) and `packages/core/src/libraries/hook/index.ts`.
   */
  Region = 'region',
}

/** @deprecated Use {@link FirstScreen} instead. */
export enum InteractionMode {
  SignIn = 'signIn',
  SignUp = 'signUp',
}

export enum FirstScreen {
  SignIn = 'sign_in',
  Register = 'register',
  ResetPassword = 'reset_password',
  IdentifierSignIn = 'identifier:sign_in',
  IdentifierRegister = 'identifier:register',
  SingleSignOn = 'single_sign_on',
  /** @deprecated Use snake_case 'sign_in' instead. */
  SignInDeprecated = 'signIn',
}

export const extraParamsObjectGuard = z
  .object({
    [ExtraParamsKey.InteractionMode]: z.nativeEnum(InteractionMode),
    [ExtraParamsKey.FirstScreen]: z.nativeEnum(FirstScreen),
    [ExtraParamsKey.DirectSignIn]: z.string(),
    [ExtraParamsKey.OrganizationId]: z.string(),
    [ExtraParamsKey.LoginHint]: z.string(),
    [ExtraParamsKey.UiLocales]: z.string(),
    [ExtraParamsKey.Identifier]: z.string(),
    [ExtraParamsKey.OneTimeToken]: z.string(),
    [ExtraParamsKey.GoogleOneTapCredential]: z.string(),
    [ExtraParamsKey.DeviceRef]: z.string(),
    [ExtraParamsKey.AppSlug]: z.string(),
    [ExtraParamsKey.NativeCaps]: z.string(),
    [ExtraParamsKey.NativeScheme]: z.string(),
    [ExtraParamsKey.HideSocial]: z.string(),
    [ExtraParamsKey.ShowSocial]: z.string(),
    [ExtraParamsKey.Region]: z.string(),
  })
  .partial() satisfies ToZodObject<ExtraParamsObject>;

export type ExtraParamsObject = Partial<{
  [ExtraParamsKey.InteractionMode]: InteractionMode;
  [ExtraParamsKey.FirstScreen]: FirstScreen;
  [ExtraParamsKey.DirectSignIn]: string;
  [ExtraParamsKey.OrganizationId]: string;
  [ExtraParamsKey.LoginHint]: string;
  [ExtraParamsKey.UiLocales]: string;
  [ExtraParamsKey.Identifier]: string;
  [ExtraParamsKey.OneTimeToken]: string;
  [ExtraParamsKey.GoogleOneTapCredential]: string;
  [ExtraParamsKey.DeviceRef]: string;
  [ExtraParamsKey.AppSlug]: string;
  [ExtraParamsKey.NativeCaps]: string;
  [ExtraParamsKey.NativeScheme]: string;
  [ExtraParamsKey.HideSocial]: string;
  [ExtraParamsKey.ShowSocial]: string;
  [ExtraParamsKey.Region]: string;
}>;
