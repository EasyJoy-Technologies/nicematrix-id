# 通行密钥引导页：不支持 WebAuthn 的浏览器自动跳过

**日期**: 2026-09-17
**基线**: Logto v1.43.0
**改动**: 1 个 override 文件 + 1 个新增单测（`packages/experience/src/pages/PasskeySetup/`）
**风险面**: 仅 experience 前端；无服务端改动、无配置改动、无数据改动、无新增 i18n key

---

## 1. 问题

租户开了 `passkey_sign_in.enabled`（prod-1 与 staging 均为 true），服务端因此会在每次
sign-in / register 交互提交时建议绑定通行密钥：

```
core/routes/experience/classes/mfa.ts  assertPasskeySignInFulfilled()
  → 422 user.passkey_preferred → 前端导向 /create-passkey
```

`pages/PasskeySetup` 对不支持 WebAuthn 的浏览器直接返回
`<ErrorPage title="mfa.webauthn_not_supported" />`。**而「跳过」控件挂在
`SecondaryPageLayout` 上，这条分支根本不渲染它** —— 交互不跳过就无法提交，用户因此卡死：
返回上一页 → 重新提交 → 再次 422 → 又回到同一张错误页。

### 生产实测规模（prod-1，60 天窗口）

| 指标 | 值 |
|---|---|
| 撞上该页的用户 | 175 |
| 其中此后**再没有一次登录成功** | **81（46%）** |
| 这 81 人里曾发起过 WebAuthn 注册的 | 6 → 其余 75 人浏览器根本没有该 API |
| 成功点过「跳过」并落库的用户（对照） | 99 |
| 已绑通行密钥的用户（对照） | 31 |

受影响客户端（卡死用户的浏览器）：Android WebView 以及**没装 Chrome 的国产安卓机上
Custom Tabs 回落到的厂商自带浏览器** —— 华为 37 / Android Browser 24 / MIUI 15 /
Samsung 11 / HeyTap 10 / vivo 5 / Quark 5 / UC 4，Chrome 系合计仅 18。
**客户端换 Custom Tabs 解决不了**，必须在这里修。

## 2. 改动

`logto-custom/overrides/packages/experience/src/pages/PasskeySetup/index.tsx`
（v1.43.0 逐字拷贝，只改「不支持 WebAuthn」这一条分支）

- 不支持 WebAuthn 时不再渲染终止错误页，而是**自动调用既有的跳过接口**
  （`POST /experience/profile/mfa/passkey-skipped` + 提交，与「跳过」按钮发的是同一个请求），
  流程照常继续；期间渲染项目里通用的 `<LoadingLayer />`（与 `SwitchAccount` / `OneTimeToken` 一致）。
- 自动跳过若失败 → **回落到上游那张错误页**，最坏情况不比改动前更差。
- `useRef` 守卫保证重渲染时只发一次请求（模式照抄 `pages/DirectSignIn`）。

唯一的结构性调整：把上游 `onSkip` 的返回类型从 `void` 改成 `boolean`，让自动路径能判断流程是否
继续；`SecondaryPageLayout.onSkip` 的类型是 `() => void`，忽略返回值，**按钮路径行为完全不变**。
这样做是为了避免复制一份重复的跳过逻辑。

### 刻意不动

- **支持 WebAuthn 的浏览器：与上游完全一致** —— 注册选项拉取、绑定按钮、手动跳过全部原样。
- 跳过的语义本身：复用同一个请求，落库的 `logto_config.passkey_sign_in.skipped` 含义不变
  （用户之后仍可在账户中心自行添加通行密钥）。
- 服务端 `assertPasskeySignInFulfilled` 一行未动；SIE 的 `passkey_sign_in.*` 三个开关一个未改
  （`enabled` / `showPasskeyButton` / `allowAutofill` 均保持原值）。

## 3. 自检

| 项目 | 结果 |
|---|---|
| `tsc --noEmit`（`packages/experience` 全包，含 override） | **0 error** |
| 新增单测 `src/pages/PasskeySetup/index.test.tsx` | **4 / 4 通过** |
| `packages/experience` 全量单测回归 | **83 suites / 507 tests 全绿** |

新增用例：①不支持 → 自动跳过并继续、不请求注册选项、不出现错误页；②重渲染只发一次跳过请求；
③跳过失败 → 回落上游错误页；④**回归护栏**：支持 WebAuthn 时一次跳过请求都不发。

## 4. 上线记录

（部署后补：staging 镜像 / 验证结果 / prod-1 镜像 / 回滚锚点）
