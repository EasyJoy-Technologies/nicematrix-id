# Logto 1.41 — Sign-in & account 保存报错修复 + username 点号 override 复核 (2026-07-15)

## 背景 / 两个问题（Xianglin 报）
1. Console **Sign-in experience → Sign-in & account** 页保存总是报
   `Cannot find entities with the given names: name, avatar`。
2. 复核 Logto 1.41 改了 username 规则后，我们让 username 支持点号 (`.`) 的
   override 是否仍生效。

## 问题 2 结论：✅ 仍生效，无需改动
- 1.41 新增 `packages/toolkit/core-kit/src/username-policy.ts`。其 `allowedChars`
  只有 lowercase/uppercase/numbers/underscore 四类，**没有 dot**。点号只经常开的
  `validateUsernameHardFloor()` → `usernameRegEx.test()` 放行。
- 已部署镜像核验（staging+prod-1 均）：`core-kit/lib/regex.js` =
  `/^[A-Z_a-z](?:[\w.]*\w)?$/`，`username-policy.js` 从 `./regex.js` import
  `usernameRegEx`。→ 点号仍可用。
- ⚠️ 升级提醒：dot 依赖现横跨 2 文件（`regex.ts` + 新的 `username-policy.ts`），
  下次 upgrade drift 检查要一起看。

## 问题 1 根因（源码级 + 线上确认）
- 1.41 alteration `1.41.0-1782354362-set-admin-account-center-profile-fields`
  把 admin `account_centers.profile_fields` 种成 `[{name},{avatar}]`。
- 保存 = console `PATCH /api/account-center`（原样回传 profileFields）→
  `normalizeProfileFields` → `validateProfileFieldsList`：把**每个** name 拿去
  `custom_profile_fields` 表查存在性，**无内置字段豁免**。
- `name`/`avatar` 是 users 列支撑的内置字段，从不是该表行（线上表只有
  birthdate/gender/nickname/fullname/address）→ 必抛 `name, avatar`。
- 上游缺口（master 亦然），非我方回归。console 每次保存都会失败。

## 修复（源码 override，无 DB 迁移）
- Override 文件：
  `logto-custom/overrides/packages/core/src/libraries/custom-profile-fields/index.ts`
  （逐字拷贝 upstream + 3 处最小改动）
- 改动：`validateProfileFieldsList` 仅对**列支撑内置**键 `name`+`avatar`
  （取自 `nameAndAvatarGuard.keyof().options`）豁免「缺失名」检查；重复名检查仍作用于
  完整列表；当 `namesToVerify` 为空时跳过 catalog 查询（`where name in ()` 是非法
  Postgres SQL — admin 默认保存正好命中此空路径）。
- 作用域护栏：其它内置键（birthdate/gender/nickname/address…）在本部署是**真实**
  catalog 行，**保持校验**，悬空引用检测不削弱。
- 镜像内编译产物核验：`columnBackedBuiltInProfileFieldKeys = new Set(nameAndAvatarGuard2.keyof().options)`、
  `namesToVerify` ×4、`namesToVerify.length > 0` 守卫齐全。

## 提交
- nicematrix-id repo commit `8e18cd6`（含 override + `docs/patches.md` item 7 +
  `docs/account-center-profile.md` server-side override 段）。

## 镜像
- 新镜像 `nicematrix-logto:latest`（本机构建 manifest-list `955ff9c7fab5` /
  config digest `238b2fd04473`；同一镜像，两种 digest 视图）。
- feature tag：`nicematrix-logto:profilefields-fix-20260715`。
- 回滚 tag：
  - staging：`nicematrix-logto:staging-backup-20260715-2248` = `6300ce02ea2c`
    （亦 `pre-profilefields-fix-20260715-2248`）
  - prod-1：`nicematrix-logto:prod-backup-20260715_2300` = `c7f669934021`
    （亦 `pre-profilefields-fix-20260715_2300`）= 修复前 avatar-fix 版
- 传输：`docker save` → scp（329MB，md5 双端一致 `548d5a4e220f1a7d549c0b5adfb88cbd`，
  tar -tf 完整性 OK）→ `docker load`。传输文件双端已清理。

## 部署 + 冒烟（staging + prod-1 均 6/6 PASS）
两环境同一套 M2M（`m-admin` → admin Management API `PATCH /api/account-center`）：
- T1 `[{name},{avatar}]`（原报错用例）→ **200**，profileFields 保留 ✓
- T2 未知字段名 → **400** `entity_not_exists_with_names`（仅报未知名，name 已豁免）✓
- T3 `name+avatar+birthdate` → **200** ✓
- T4 重复自定义名 → **400** `request.invalid_input`（dup 列表）✓
- T5 重复内置名(name,name) → **400**（完整列表 dup 检查仍捕获）✓
- T6 空数组 → **200** no-op ✓
- 测试后两环境 `account_centers` 均还原为默认 `[{name},{avatar}]`。
- 回归：username 点号 regex 新镜像内完好；`/console` `/account` `/oidc discovery`
  全 200；容器日志零 error/500。prod-1 冒烟在本机执行，secrets 不离机。

## 回滚（30s，无数据影响）
- prod-1：`docker tag nicematrix-logto:prod-backup-20260715_2300 nicematrix-logto:latest`
  + `cd /var/www/nicematrix-id && docker compose --env-file /etc/nicematrix/id.env
  -f deploy/docker-compose.yml up -d logto`
- staging：`docker tag nicematrix-logto:staging-backup-20260715-2248 nicematrix-logto:latest` + 同 up -d
