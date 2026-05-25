import { z } from 'zod';

import { alipaySigningAlgorithms, charsetEnum, fallbackCharset } from './constant.js';

const charsetGuard = z.enum(charsetEnum);

export const alipayConfigGuard = z.object({
  appId: z.string(),
  privateKey: z.string(),
  signType: z.enum(alipaySigningAlgorithms),
  charset: charsetGuard.default(fallbackCharset),
  scope: z.string().optional(),
});

export type AlipayConfig = z.infer<typeof alipayConfigGuard>;

// `error_response` and `alipay_system_oauth_token_response` are mutually exclusive.
export const errorResponseGuard = z.object({
  code: z.string(),
  msg: z.string(), // To know `code` and `msg` details, see: https://opendocs.alipay.com/common/02km9f
  sub_code: z.string().optional(),
  sub_msg: z.string().optional(),
});

export const alipaySystemOauthTokenResponseGuard = z.object({
  // NiceMatrix patch: post-2024-04-01 Alipay apps default to OpenID mode and only return `open_id`.
  // Legacy apps still return `user_id` (2088xxx); apps in an Application Grouping additionally return `union_id`.
  user_id: z.string().optional(),
  open_id: z.string().optional(),
  union_id: z.string().optional(),
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string(),
  re_expires_in: z.number(),
});

export const accessTokenResponseGuard = z.object({
  sign: z.string(), // To know `sign` details, see: https://opendocs.alipay.com/common/02kf5q
  error_response: z.optional(errorResponseGuard),
  alipay_system_oauth_token_response: z.optional(alipaySystemOauthTokenResponseGuard),
});

export type AccessTokenResponse = z.infer<typeof accessTokenResponseGuard>;

export const alipayUserInfoShareResponseGuard = z.object({
  // NiceMatrix patch: OpenID mode replaces user_id with open_id (and optionally union_id).
  user_id: z.string().optional(),
  open_id: z.string().optional(),
  union_id: z.string().optional(),
  avatar: z.string().optional(), // URL of avatar
  province: z.string().optional(),
  city: z.string().optional(),
  nick_name: z.string().optional(),
  gender: z.string().optional(), // Enum type: 'F' for female, 'M' for male
  code: z.string(),
  msg: z.string(), // To know `code` and `msg` details, see: https://opendocs.alipay.com/common/02km9f
  sub_code: z.string().optional(),
  sub_msg: z.string().optional(),
});

type AlipayUserInfoShareResponse = z.infer<typeof alipayUserInfoShareResponseGuard>;

export const userInfoResponseGuard = z.object({
  sign: z.string(), // To know `sign` details, see: https://opendocs.alipay.com/common/02kf5q
  alipay_user_info_share_response: alipayUserInfoShareResponseGuard,
});

export type UserInfoResponse = z.infer<typeof userInfoResponseGuard>;

export type ErrorHandler = (response: AlipayUserInfoShareResponse) => void;
