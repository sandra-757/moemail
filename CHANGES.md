# MoeMail 管理员控制台可配置项扩展 v1 — 变更说明

基于上游 `beilunyang/moemail`（Next.js 15 + Cloudflare Pages / D1 / KV），在 `upstream/` 工作区内实现。
原则：**向后兼容、不改 D1 schema、所有新配置存现有 `SITE_CONFIG` KV、缺省值 = 当前上游行为**。
本次未部署、未 push、未触碰线上实例。

## 新增配置项清单（KV 键名 / 默认值 / GET /api/config 字段）

| KV 键 | 类型（KV 内存储） | 默认值 | API 字段 | 说明 |
| --- | --- | --- | --- | --- |
| `SITE_NAME` | string | `"MoeMail"` | `siteName` | 站点名称，用于页面 meta 与 OG siteName |
| `ANNOUNCEMENT_ENABLED` | `"true"`/`"false"` | `false` | `announcementEnabled` | 站点公告横幅开关 |
| `ANNOUNCEMENT_TEXT` | string | `""` | `announcementText` | 公告文本，非空且开关开启时才显示 |
| `ALLOW_REGISTRATION` | `"true"`/`"false"` | `true` | `allowRegistration` | 是否允许公开注册 |
| `MAINTENANCE_MODE` | `"true"`/`"false"` | `false` | `maintenanceMode` | 维护模式开关（皇帝不受限） |
| `MAINTENANCE_MESSAGE` | string | `""` | `maintenanceMessage` | 维护提示文本，空时用内置文案「系统维护中，请稍后再试」 |
| `DEFAULT_EXPIRY_MS` | string（毫秒数） | `86400000`（24 小时） | `defaultExpiry`（number） | 新建邮箱弹窗的默认有效期，必须是 `EXPIRY_OPTIONS` 之一 |
| `ALLOW_PERMANENT_EMAIL` | `"true"`/`"false"` | `true` | `allowPermanentEmail` | 是否允许非皇帝用户创建永久邮箱（`expiryTime=0`） |
| `POLL_INTERVAL_SECONDS` | string（秒数） | `10` | `pollIntervalSeconds`（number） | 消息列表轮询间隔，范围 3–120 秒 |

共享的默认值与解析/校验 helper 集中在新增文件 `app/lib/site-config.ts`
（`SITE_CONFIG_DEFAULTS`、`parseConfigBool`、`parseDefaultExpiry`、`parsePollIntervalSeconds`、`parseSiteName`、`normalizeEmailDomains`），API 路由、注册/生成路由、layout 与前端 hook 共用同一套口径。

## 每项的实际接线位置

1. **SITE_NAME**
   - `app/api/config/route.ts`：GET 公开返回 `siteName`；POST 校验后写入。
   - `app/[locale]/layout.tsx`：新增本地 `getSiteName()`，通过 `getRequestContext().env.SITE_CONFIG` 读取 KV，失败（无请求上下文等）回退 `"MoeMail"`；`generateMetadata` 的 `openGraph.siteName` 与 layout `<head>` 的 `application-name`、`apple-mobile-web-app-title` 两处 meta 改用该值。原有 i18n 标题（`metadata.title` 等）未动。

2. **ANNOUNCEMENT_ENABLED / ANNOUNCEMENT_TEXT**
   - 新增客户端组件 `app/components/site-announcement.tsx`（`SiteAnnouncement`，内部用 `useConfig` 读取；开关开启且文本 trim 后非空才渲染横幅）。
   - 挂载：`app/[locale]/page.tsx`（首页）与 `app/[locale]/moe/page.tsx`（邮箱页）顶部各一处。

3. **ALLOW_REGISTRATION**
   - `app/api/auth/register/route.ts`：POST 一开始（参数校验与 Turnstile 之前）读 KV，关闭时返回 403 `{ error: "当前已关闭公开注册" }`。
   - `app/components/auth/login-form.tsx`：表单内直接用 `useConfig()` 读取（未改调用方 `app/[locale]/login/page.tsx`，因为它在服务端只能拿到 Turnstile 配置，改动面更大）；关闭时隐藏注册 Tab、Tab 列表变单列、当前 Tab 强制为 login。配置未加载完时按默认 `true` 显示，加载后若关闭会即时隐藏（有极短暂闪烁，可接受）。

4. **MAINTENANCE_MODE / MAINTENANCE_MESSAGE**
   - `app/api/emails/generate/route.ts`：在已有的 `getUserRole` 皇帝判断内、最大邮箱数检查之前插入维护检查；非 EMPEROR 用户在维护开启时返回 503，`error` 为 `MAINTENANCE_MESSAGE`（为空回退内置文案）。皇帝不受限。

5. **DEFAULT_EXPIRY_MS**
   - `app/components/emails/create-dialog.tsx`：`expiryTime` 初始 state 仍为 `EXPIRY_OPTIONS[1]`（配置未加载回退值）；配置加载后通过一次性 effect（ref 防重复应用，不覆盖用户后续手动选择）设为 `config.defaultExpiry`；若默认值为永久（0）但站点不允许永久邮箱，则回退 `EXPIRY_OPTIONS[1]`。

6. **ALLOW_PERMANENT_EMAIL**
   - `app/api/emails/generate/route.ts`：过期时间合法性校验之后，非 EMPEROR 用户请求 `expiryTime=0` 且该配置关闭时返回 403「当前不允许创建永久邮箱」。
   - `app/components/emails/create-dialog.tsx`：关闭时从有效期单选项中过滤掉「永久」（value=0），标签与选项改为成对映射后再过滤，避免下标错位。

7. **POLL_INTERVAL_SECONDS**
   - `app/components/emails/message-list.tsx`：用 `useConfig` 读取，间隔 = `pollIntervalSeconds × 1000` 毫秒；配置未加载时回退 `EMAIL_CONFIG.POLL_INTERVAL`（10000ms，数值相等）。间隔经 ref 传入 `setInterval`，且配置加载/变更导致间隔变化时会自动重启轮询以应用新值。
   - 未改动：`app/[locale]/shared/[token]/page-client.tsx` 的分享页轮询仍用 `EMAIL_CONFIG.POLL_INTERVAL`（按任务约定可不动，此处注明）。

8. **管理面板**（`app/components/profile/website-config-panel.tsx`）
   - 按「站点信息 / 注册与维护 / 邮箱策略 / 人机验证」四组分区呈现全部新旧字段：站点名称、管理员联系方式、公告开关+文本；新用户默认角色、公开注册开关、维护模式开关+提示；邮箱域名、每用户最大邮箱数、默认有效期下拉（选项取 `EXPIRY_OPTIONS`，文案复用 `emails.create` 的 oneHour/oneDay/threeDays/permanent）、允许永久邮箱开关、轮询间隔秒数；Turnstile 开关与双 Key（原有逻辑保留）。
   - 保存仍走同一个 `POST /api/config`，一次提交全部字段；保存失败时优先展示服务端返回的 `error` 文案。
   - Resend 发件面板（`app/api/config/email-service/*` 及对应组件）未做任何改动。

9. **前端配置 hook**（`app/hooks/use-config.ts`）
   - `Config` 接口补齐全部新字段；fetch 映射对每个字段做默认值兜底（`defaultExpiry` 校验必须在 `EXPIRY_OPTIONS` 内、`pollIntervalSeconds` 校验 3–120 整数、布尔字段用 `??` 默认值），与服务端解析口径一致。

## 校验规则（POST /api/config，本次补齐/新增）

- `defaultRole`：保留原有校验，必须是 DUKE / KNIGHT / CIVILIAN 之一，否则 400。
- `MAX_EMAILS`：**新增校验**——必须是 1–10000 的整数，否则 400；写入 KV 时写规范化后的整数串。面板 UI 的 `max` 同步由 100 改为 10000。
- `EMAIL_DOMAINS`：**新增校验与规范化**——按逗号切分后逐个 trim、转小写、去重，再逐个用域名正则校验；结果为空或任一域名非法返回 400；写入 KV 的是规范化后以逗号连接的字符串。
- `SITE_NAME`：字符串、trim 后长度 ≤100；为空时按默认值 `"MoeMail"` 写入。
- `ANNOUNCEMENT_TEXT` / `MAINTENANCE_MESSAGE`：字符串、长度 ≤500，否则 400。
- 四个布尔字段（`announcementEnabled` / `allowRegistration` / `maintenanceMode` / `allowPermanentEmail`）：若提供则必须是 boolean，否则 400。
- `defaultExpiry`：若提供必须是 `EXPIRY_OPTIONS` 的 value 之一（3600000 / 86400000 / 259200000 / 0），否则 400。
- `pollIntervalSeconds`：若提供必须是 3–120 的整数，否则 400。
- Turnstile：保留原有校验（启用时 Site Key 与 Secret Key 必填）。
- 兼容处理：新字段在 POST 中均为可选，**未提供的字段不写入 KV**（不覆盖管理员此前保存的值），因此旧版面板/旧客户端调用 POST 不会把新配置重置为默认值。

GET /api/config 的解析侧同样防御：存量 KV 中若有非法值（如手工写入的 `DEFAULT_EXPIRY_MS` 不在选项内、轮询间隔越界），一律回退默认值，不会把非法值透传给前端。

## i18n

- `profile.website` 段新增文案键：`sections.{site,registration,emailPolicy,turnstile}`、`siteName(+Placeholder)`、`announcementEnabled(+Description)`、`announcementText(+Placeholder)`、`allowRegistration(+Description)`、`maintenanceMode(+Description)`、`maintenanceMessage(+Placeholder)`、`defaultExpiry`、`allowPermanentEmail(+Description)`、`pollIntervalSeconds(+Description)`。
- 已补 `zh-CN`（中文）与 `en`（英文）两套。
- **无跨语言回退机制**：`app/i18n/request.ts` 与 layout 的 `getMessages` 都是按 locale 整包加载对应语言文件，缺键不会回退英文（next-intl 会报缺键）。因此 `zh-TW`、`ja`、`ko` 三套也同步补了**英文占位**文案，保证不缺键；后续如需本地化，直接替换这三套的对应值即可。

## 与上游的兼容性说明

- 不改 D1 schema、不新增 migration；不新增 KV namespace，全部复用既有 `SITE_CONFIG` binding。
- KV 中没有任何新键时（老部署直接升级代码），所有行为与上游一致：站点名 MoeMail、无公告、允许注册、无维护模式、默认有效期 24 小时、允许永久邮箱、轮询 10 秒。
- `GET /api/config` 只新增字段，不改已有字段名与类型（`maxEmails` 仍为字符串）；`POST /api/config` 对新字段全部可选。
- 已知行为变化（均为修复性质）：POST 时 `EMAIL_DOMAINS` 会被规范化（小写/去重）后存储；此前无校验的非法 `MAX_EMAILS` 现在会被 400 拒绝。
- 新增文件仅两个：`app/lib/site-config.ts`、`app/components/site-announcement.tsx`；其余均为对既有文件的最小改动。Resend 发件配置、webhook、清理/邮件 worker 均未触碰。

## 部署时需要的 Cloudflare 资源 / 权限清单（仅清单，本次未执行部署）

- **Pages 项目**：现有 MoeMail Pages 项目即可，无需新建；构建命令不变（`npm run build:pages` 即 `@cloudflare/next-on-pages`，部署 `wrangler pages deploy`）。
- **KV**：复用现有 `SITE_CONFIG` namespace binding（wrangler 配置中的 `kv_namespaces` 已有），无新 namespace、无需新权限。
- **D1**：复用现有数据库，**无新 migration**。
- **环境变量/密钥**：无新增。
- **Turnstile**：无变化，沿用现有站点 Key（如启用）。
- **部署账号权限**：能发布该 Pages 项目的 Cloudflare API Token / 登录态即可（Pages 编辑 + 读取已绑定的 KV/D1 资源）；本次扩展不新增任何资源级权限需求。
- 部署后建议：用皇帝账号打开个人页网站配置面板，逐项保存一次（会把新键以默认值写入 KV），再按需调整。

## 验证结果（2026-11-18 实测）

- 依赖：`npm ci` 成功（1156 个包）。注：上游 `package-lock.json` 中 186 个包的 resolved 地址指向 `mirrors.tencent.com`、其余指向 `registry.npmmirror.com`，安装时需放行这两个镜像域名。
- 基线（上游 HEAD `5722ceb`，git worktree + 同一份完整依赖）：`npx tsc --noEmit` **exit=0，零错误**。
- 改动后（`upstream/` 工作区）：`npx tsc --noEmit` **exit=0，零错误**——本次改动未引入任何类型错误。
  - 过程中曾出现 `scripts/deploy/*.ts` 找不到 `cloudflare` 模块的 2 条报错，经基线对比确认是依赖未装完时的假象，完整安装后基线与改动后均消失。
- `npm run build`（在代码副本上执行，避免在工作区留下 `.next` 产物）：**exit=0，构建成功**；仅有上游既有的 ESLint 警告（react-hooks/exhaustive-deps、`<img>` 建议等），无新增报错、无 i18n 缺键报错。
- 未运行任何 deploy 脚本，未 push，未触碰线上实例。

---

# 六期：邮箱回收站（软删除 + 管理员可恢复）

在四期孤儿邮件机制之上，把「删除邮箱」从不可恢复的硬删升级为可进回收站的软删，并把到期处理改为站点/用户两级可控。全部新行为由站点开关 `MAILBOX_TRASH_ENABLED`（默认关）总控：**开关关闭、且 KV 无任何新键时，所有行为与五期完全一致**。本次未部署、未 push、未触碰线上实例与任何线上 KV/D1，未改 wrangler 配置。

## 设计口径

- 软删 = 给 email 行打 `deleted_at` 时间戳；邮件保持挂载不动（不转孤儿）；软删时先清该邮箱的 `email_share` 与其邮件的 `message_share`，保证回收站期间一切分享链接失效。
- 回收站中的邮箱对全站读路径不可见（按不存在处理）；管理员可在个人中心「回收站」标签页恢复（清 `deleted_at`，有效期原样）或彻底删除。
- 保留期 `TRASH_RETENTION_DAYS`（默认 30 天）同时管两类清仓：回收站邮箱超期硬删、孤儿邮件超期删除（后者与回收站开关无关、始终执行）。

## 新增配置

| KV 键 | 类型 | 默认值 | API 字段 | 说明 |
| --- | --- | --- | --- | --- |
| `MAILBOX_TRASH_ENABLED` | `"true"`/`"false"` | `false` | `mailboxTrashEnabled` | 回收站总开关 |
| `TRASH_RETENTION_DAYS` | string（天数） | `30` | `trashRetentionDays`（number） | 软删邮箱与孤儿邮件的保留天数，解析范围 1–3650，非法回退 30 |
| `EXPIRED_TRASH_DEFAULT` | `"true"`/`"false"` | `false` | `expiredTrashDefault` | 到期进回收站的站点默认（用户个人设置为空时跟随） |

接线：`app/lib/site-config.ts`（默认值、`parseTrashRetentionDays`）、`app/lib/orphan-mail.ts`（`isMailboxTrashEnabled` / `getTrashRetentionDays` / `getExpiredTrashDefault`，与孤儿同域）、`app/api/config/route.ts`（GET/POST，POST 校验口径同既有字段：布尔必须为 boolean、天数必须 1–3650 整数、缺失不覆盖）、`app/hooks/use-config.ts`（同口径兜底解析）、网站配置面板邮箱策略区（回收站开关 Switch + 保留天数数字输入 + 到期默认 Switch，与两个孤儿开关并列）。

## 迁移 0022（drizzle/0022_mailbox_trash.sql）

drizzle-kit generate 生成后已人工核对，全文只有三条语句，无重建表：

```sql
ALTER TABLE `email` ADD `deleted_at` integer;
CREATE INDEX `email_deleted_at_idx` ON `email` (`deleted_at`);
ALTER TABLE `user` ADD `expired_to_trash` integer;
```

- `email.deleted_at`：timestamp_ms 可空，NULL = 未软删；schema 中同步加 `deletedAt` 列与索引。
- `user.expired_to_trash`：布尔可空，NULL = 跟随站点默认 `EXPIRED_TRASH_DEFAULT`。

## 软删除接线（删除路径）

- 本人删除 `app/api/emails/[id]/route.ts` DELETE：回收站开启时走软删（追加设计 A 的二选一见下）；关闭时五期 KEEP/硬删逻辑一字未动。
- 管理员空间删除 `app/api/admin/space/[userId]/emails/[emailId]/route.ts` DELETE：回收站开启时软删，不给选择；关闭时原逻辑不动。
- 两处删除的邮箱查找都只匹配未软删行（已软删再删 → 走不存在分支：本人 403、空间 404）。
- 软删/彻删的公共实现在 `app/lib/orphan-mail.ts`：`moveMailboxToTrash(db, email)`（清 shares + 打标记）、`purgeMailbox(db, emailId)`（清 shares → 删 messages → 删 email 行的硬删版）。

## 读路径统一排除软删邮箱（查询点清单）

以下每一处都加了 `deleted_at IS NULL` 过滤（或等价的软删检查）：

- `app/api/emails/route.ts` GET：用户邮箱列表的计数与分页查询基条件。
- `app/api/emails/[id]/route.ts`：GET 消息列表、PATCH 改有效期、DELETE 的三处 `findFirst`。
- `app/api/emails/[id]/` 下子路由：`[messageId]/route.ts`（消息详情/删除两处）、`send/route.ts`（发信邮箱查找）、`share/route.ts` 与 `share/[shareId]/route.ts`（邮箱分享）、`messages/[messageId]/share/route.ts` 与 `messages/[messageId]/share/[shareId]/route.ts`（邮件分享）。
- `app/api/emails/reorder/route.ts` 与 `app/api/admin/space/[userId]/emails/reorder/route.ts`：归属校验 `findMany`。
- `app/lib/email-limit.ts` `countActiveEmails`：配额计数不含软删邮箱。
- `app/lib/admin-space.ts` `loadOwnedEmail`：管理员空间的邮箱详情、改有效期、删箱、消息列表/详情全部经此加载，一并排除。
- `app/api/admin/space/[userId]/route.ts` GET：空间邮箱列表与消息数分组统计。
- `app/lib/shared-data.ts`：`getSharedEmail` / `getSharedEmailMessages` 对软删邮箱返回空（软删时分享记录已清，此为双保险）；`getSharedMessage` 的邮箱查找排除软删。
- `workers/email-receiver.ts`：按地址查目标邮箱排除软删——软删 = 不存在，走原不存在分支（按 SAVE_ORPHAN_MAILS 存孤儿或丢弃）。
- `workers/cleanup.ts` 与 `app/api/admin/mail-cleanup/route.ts`：过期邮箱选取排除软删（回收站邮箱归清仓规则，不重复走过期处理）。
- `app/api/admin/mail-stats/route.ts`：邮箱总数与已过期数不含软删邮箱。
- `app/api/roles/users/route.ts`：用户管理列表的未过期邮箱计数不含软删邮箱。
- 两处建箱的排序号 `min(sortOrder)` 查询排除软删行，避免与恢复后的邮箱排序号冲突。
- 经查未改：`app/lib/send-permissions.ts` 的每日发信计数统计的是历史已发邮件（事实计数、与邮箱可见性无关）；`app/api/users/[id]/route.ts` 删用户走外键级联（账号级硬删，回收站不介入）。

## 建箱恢复与认领解耦

- 两处建箱（`app/api/emails/generate/route.ts`、管理员空间 POST）在创建前按 `LOWER(address)` 查已有行：
  - 未软删存在 → 原 409「该邮箱地址已被使用」；
  - 软删且属于同一用户（空间路径为目标用户）→ 恢复它：清 `deleted_at`、按本次请求的有效期更新 `expiresAt`，随后认领孤儿并按原响应格式返回该邮箱；
  - 软删但属于他人 → 409。
- 认领解耦：两处建箱成功后**无条件**调用 `claimOrphanMessages`，不再受 SAVE/KEEP 任一开关门控；`shouldClaimOrphans` 已无调用方，一并移除。

## 回收站 API 与面板

- `GET /api/admin/trash`：全部软删邮箱（id、address、userId、属主显示名、deletedAt、createdAt、expiresAt、挂载邮件数），按 deletedAt 倒序；权限守卫同 mail-stats（`PERMISSIONS.MANAGE_CONFIG`）。
- `POST /api/admin/trash/[emailId]/restore`：仅对软删中的邮箱恢复（清 `deleted_at`，有效期原样，哪怕已过期）；非软删/不存在返回 404。
- `DELETE /api/admin/trash/[emailId]`：仅对软删中的邮箱彻底删除（走 `purgeMailbox`）；非软删/不存在返回 404。
- 面板：个人中心管理标签页在「邮件统计」旁新增「回收站」标签页（新组件 `app/components/profile/trash-panel.tsx`，模式照邮件统计面板）：列表行含地址、属主、删除时间、邮件数与「恢复」「彻底删除」按钮，彻删走 AlertDialog 二次确认（含地址与邮件数、不可恢复提示），含空状态与刷新。

## cleanup 清仓与到期规则（workers/cleanup.ts）

每次运行依次执行（保留期均取 `TRASH_RETENTION_DAYS`）：

1. **过期邮箱**（选取排除已软删）：
   - 回收站关闭 → 五期逻辑原样（KEEP 开 = 信转孤儿删箱；关 = 连信硬删）。
   - 回收站开启 → 逐个邮箱三层判定（追加设计 B）：属主 `user.expired_to_trash` 非 NULL 用其值，NULL 用站点默认 `EXPIRED_TRASH_DEFAULT`；为真 → 软删（清 shares、置 deleted_at）；为假 → 回到五期 KEEP 分支。注：此分支下「不进回收站且 KEEP 关」的硬删改为逐行显式清 shares/messages 后删邮箱（与应用层口径一致，不再单靠外键级联），结果等价。
2. **回收站清仓**（仅回收站开启时）：`deleted_at` 早于保留期的邮箱硬删（清 shares → messages → email，单批 100）。
3. **孤儿清仓**（始终执行，不受回收站开关约束）：`emailId IS NULL` 且 `received_at` 早于保留期的邮件删除（连带其 message_share，单批 500）。
- `app/api/admin/mail-cleanup/route.ts` 的 `expired-mailboxes` 手动动作与 Worker 同步同口径（排除软删、三层判定），响应新增 `trashed` 计数字段。

## 追加设计 A：用户自删二选一

- 本人 DELETE 在回收站开启时接受查询参数 `toTrash`：未传或 `true` → 移入回收站；`false` → 本人明确彻底删除——不清孤儿、不走 KEEP 分支，邮箱与邮件一并硬删（走 `purgeMailbox`，shares 先清）。未传参数默认进回收站，旧前端调用行为兼容。
- 前端确认框（`app/components/emails/email-list.tsx`）随之二选一：回收站开启时文案提示「移入回收站（{天数} 天内可联系管理员恢复）/ 彻底删除（不可恢复）」并给出两个动作按钮（推荐前者、后者为危险样式）；关闭时保持原单按钮确认与原文案。
- 管理员空间删除不给选择：开关开即软删。

## 追加设计 B：到期进回收站的用户级设置

- 数据：`user.expired_to_trash`（迁移 0022，NULL = 跟随站点默认）。
- 站点默认：KV `EXPIRED_TRASH_DEFAULT`（默认 false），配置面板文案为「到期进回收站（站点默认，用户可在个人中心覆盖）」。
- 个人中心：新增用户级开关卡片（新组件 `app/components/profile/expired-trash-setting.tsx`，挂在个人信息卡下方，对所有登录用户可见；仅站点回收站开启时展示，因为关闭时该设置无实际作用）：展示值 = 个人设置 ?? 站点默认，并注明当前是「跟随站点默认」还是「已单独设置」，已单独设置时可一键恢复跟随默认；切换即保存。
- 保存接口：新增 `POST` 同风格的用户设置接口 `GET/PATCH /api/users/me/settings`（会话鉴权、只能改本人；PATCH 只接受 `expiredToTrash` 为布尔或 null，null = 恢复跟随默认）。
- cleanup 与 mail-cleanup 的到期判定顺序见上文三层判定。

## 追加设计 C：顶栏「返回邮箱」按钮

- `app/components/auth/sign-button.tsx`（顶栏与首页共用）：已登录状态下在登出按钮左侧新增「返回邮箱」按钮，去向与个人中心底部既有按钮相同（`/{locale}/moe`），文案复用现成 i18n 键 `common.nav.backToMailbox`（五语种均已有正式译文，未新增键）；当前路由已是邮箱主页（`/{locale}/moe`）时不显示。

## i18n

- `profile.json` 五语种新增：`website.{mailboxTrashEnabled(+Description), trashRetentionDays(+Description), expiredTrashDefault(+Description)}`、`adminTabs.trash`、整段 `trash.*`（回收站面板）、整段 `expiredTrash.*`（个人到期设置）。
- `emails.json` 五语种 `list` 段新增：`deleteDescriptionTrash`、`moveToTrash`、`permanentDelete`、`trashSuccess`。
- zh-CN / en / zh-TW 为正式译文，ja / ko 按惯例英文占位；已用脚本校验五语种键完整且无旧键丢失。

## 验证结果（2026-11-20 实测）

- `npx tsc --noEmit` **exit=0，零错误**。
- `npm run build` **exit=0，构建成功**；路由表含新增 `/api/admin/trash`、`/api/admin/trash/[emailId]`、`/api/admin/trash/[emailId]/restore`、`/api/users/me/settings`；仅有上游既有的 ESLint 警告（react-hooks/exhaustive-deps 等），无新增报错、无 i18n 缺键报错。
- 未运行任何 deploy 脚本，未 push，未触碰线上实例。


> 部署修复（2026-11-20，六期上线时）：六期构建产物将 Node 内置模块 async_hooks 打入中间件包，Pages 运行时 compatibility_date=2024-03-20 下无法提供该模块，导致整站 500（本地 wrangler pages dev 复现确认）。已将 wrangler.json（Pages）的 compatibility_date 提升至 2025-01-01（保留 nodejs_compat），重新部署后恢复。后续部署勿把该日期改回。
> 部署修复二（2026-11-20）：compatibility_date 提升后 Auth.js 改走 async_hooks 请求上下文路径，配置未显式 trustHost 导致 /api/auth/* 全部 500（UntrustedHost，登录不可用）。已在 app/lib/auth.ts 的 NextAuth 配置中显式设置 trustHost: true（自托管标准写法），本地以生产同等兼容参数验证 csrf/session 均 200。
> 部署修复三（2026-11-20，根因定版）：修复二部署后生产 /api/auth/* 仍 500。用 Pages 部署 tail 抓到真实异常为 `TypeError: Illegal invocation`（Auth.js 内部捕获后返回 500）。对照实验定版根因不在代码、也不在兼容日期本身：本机 node_modules 为旧环境（2026-11-18）安装、且被 worktree 符号链接实验污染（49 个失效链接），叠加一份被运行时重启打断过的 .next 构建缓存——由此产出的包把 async_hooks 拖进中间件、并在新兼容日期下触发上述异常；同代码用旧兼容日期则一切正常。处置：`pnpm install --frozen-lockfile`（pnpm 10）干净重装依赖 + 清空 .next/.vercel/output 全量重构建，新包中间件已无 async_hooks 引用，在一次性测试项目上以与生产完全相同的配置（2025-01-01 + nodejs_compat）验证 csrf/session/providers 全 200 后，才把同一产物部署到生产并复验全 200。compatibility_date=2025-01-01 与 trustHost: true 均保留（后者为自托管 Auth.js 的正确写法）。部署卫生（后续务必遵守）：构建前先清 .next 与 .vercel/output；不要把 node_modules 以符号链接形式借给 git worktree（pnpm 会改写其中的链接指向）；部署中断后先核产物完整性再续跑，不要在撕裂的缓存上叠构建。
> 六期线上实测（2026-11-20，浏览器真机 + D1 核对，全过）：建箱 trash-test-1120 → Amelu 真信到达 → 删除弹三按钮（取消/彻底删除/移入回收站）→ 移入回收站后列表消失、管理台回收站可见（属主/删除时间/邮件数 1/恢复+删除按钮）、D1 中 deleted_at 已标记且邮件仍挂载 → 恢复后箱与信完好 → 再移入回收站 → 回收站内彻底删除（二次确认）后 D1 邮箱行与邮件行均真删。认领解耦：SAVE_ORPHAN_MAILS 临时开 → 向不存在地址 claim-probe-1120 发信落孤儿（emailId NULL）→ 关开关 → 建同名箱，孤儿信在开关全关时照样被认领进箱；测毕以「彻底删除」清箱。另确认：顶栏「返回邮箱」按钮在非邮箱首页时位于登出左侧；个人中心「我的邮箱到期后自动进入回收站」可见且跟随站点默认（开启），回收站保留期 30 天。诊断用的一次性 Pages 项目 moemail-test 已删除。
> 修复（2026-11-20，用户实测反馈）：创建邮箱对话框把「名称留空」误判为错误并拦截，还拿占位文案 namePlaceholder 当报错描述弹出（红框显示「留空则随机生成」）；实际上后端 /api/emails/generate 与 /api/admin/space 均以 name || nanoid(8) 支持留空随机生成，管理台空间页也无此拦截，仅用户侧对话框有此上游遗留 bug。已删除该拦截、提交时传 trim 后的名称（空串即随机），并在域名配置未加载完（currentDomain 为空）时禁用创建按钮，避免误报「无效的域名」。commit d1fd3ad，已部署生产（部署 f94cd0af）；全新浏览器环境实测通过：留空创建出随机箱 5Lvc-A_K@mrin.de5.net（测后已删）。注意：早上沿用的长命浏览器窗口缓存顽固，Ctrl+Shift+R 未能刷掉旧脚本，前两轮实测误报未生效——部署后验收宜用全新 profile。
> 七期（2026-11-20）：旧实例（moemail.weiuqi.xx.kg，另一 Cloudflare 账号）原地升级到本 fork：CI（GitHub Actions「Deploy」工作流）以旧账号凭据按名复用现有 moemail / moemail-db / moemail-kv，补跑迁移 0019–0022 后部署 Pages 与 email-receiver/cleanup 两 Worker；工作流不传任何 AUTH_*，部署脚本无密钥可推时自动跳过，旧实例原有 AUTH_SECRET 与 GitHub OAuth 配置未被覆盖。升级后对账：用户 4 / 邮箱 31 / 邮件 74 / API Key 2 与升级前一致，GitHub 登录仍在 providers 列表，custom.moemail 的 API Key 照常可用，serv00 实测来信落库（测试信已删）。旧实例 KV 已按新实例口径开启 MAILBOX_TRASH_ENABLED 与 EXPIRED_TRASH_DEFAULT（均为 true）。同日打通双实例同步：工作流含 legacy/new 两 job，手动触发可选目标，feat/admin-config-v1 分支 push 自动两边同跑；仓库密钥为每账号一对（LEGACY_/NEW_ + CLOUDFLARE_API_TOKEN/ACCOUNT_ID）。注意：fork 仓库的工作流文件需同步一份到默认分支 master 才会被 GitHub 注册（仅在功能分支时 workflow_dispatch 返回 404）。

## 八期（2026-11-25）：搜索 + 排序

- **邮箱搜索**：`GET /api/emails?q=` 按地址子串搜（大小写不敏感；`%`/`_`/`\` 已转义，不会变成通配符）。邮箱列表顶部新增搜索框（防抖 300ms，清空按钮），计数显示过滤后的总数，无结果时显示「没有找到匹配的邮箱」。
- **邮件搜索**：`GET /api/emails/[id]?q=` 在本邮箱内按主题 / 发件人 / 收件人 / 正文子串搜。邮件列表顶部新增搜索框（同款防抖 + 清空）；搜索期间暂停轮询，避免新邮件合并冲掉搜索视图；清空后自动恢复轮询。
- **全局搜索**：新增 `GET /api/search?q=`（q 至少 2 字符，否则 400，避免单字符 LIKE 全表扫），跨当前用户全部未过期、未软删邮箱同时返回匹配邮箱（最多 10，按地址排）与匹配邮件（最多 20，最新在前，附正文摘要：命中词前后各 40 字符、去 HTML 标签）。三栏页顶部新增全局搜索框（桌面/移动共用），点邮箱结果切到该邮箱，点邮件结果切到其邮箱并打开该邮件；已发送邮件命中时中栏 Tab 自动切到「已发送」（`MessageListContainer` 新增 `selectedMessageType` 透传）。
- **邮箱排序**：`GET /api/emails?sort=`，`custom`（默认，现有手动拖拽顺序）| `created_desc` | `created_asc` | `expires_asc` | `expires_desc` | `address_asc` | `address_desc`。游标与排序模式绑定（时间排序用字段值、地址排序用地址作游标键，`app/lib/cursor.ts` 新增可选 `key` 字段），换 q/sort 后前端从头拉取。
- **邮件排序**：`GET /api/emails/[id]?sort=`，`date_desc`（默认）| `date_asc` | `subject_asc` | `subject_desc` | `from_asc` | `from_desc`（已发送按收件人排、收件按发件人排，与列表展示地址一致）。游标口径同上。
- **拖拽与排序的互斥**：搜索中或排序非 custom 时禁用拖拽重排（手柄隐藏），只对 custom 全量列表开放；未加载全量时点手柄仍可先加载全部（原行为保留）。
- **共用代码**：新增 `app/lib/search.ts`（`parseSearchQuery` 截断 100 字符、`escapeLikeValue`/`likeColumn` 带 `ESCAPE '\'` 的 LIKE、`parseMailboxSort`/`parseMessageSort` 非法值回退默认、`makeSnippet`）、`app/hooks/use-debounce.ts`（300ms）。
- **i18n**：`emails.json` 五语种新增 `list.searchPlaceholder/searchNoResults/sort*`（7 个）、`messages.searchPlaceholder/searchNoResults/sort*`（8 个）、整段 `search.*`（全局搜索，6 个）；`common.json` 五语种 `actions` 新增 `clear`（清除按钮 aria-label）。五语种均为正式译文。
- **范围外（有意未做）**：管理员空间页（`/admin/space/[userId]`）的邮箱/邮件列表未加搜索排序，仍走原有分页；如需可后续按同一套 `q`/`sort` 口径接。无 D1 schema 变更、无新 KV、无新环境变量。

## 验证结果（2026-11-25 实测）

- `npx tsc --noEmit` **exit=0，零错误**。
- `npm run build`（家目录下的构建副本，避免 /tmp 512MB tmpfs 爆满与工作区留 `.next` 产物；构建前清过一次误拷的顶层 `components/` 副本，已删净）**exit=0，构建成功**；路由表含新增 `ƒ /api/search`；无新增 ESLint 报错、无 i18n 缺键报错。
- 真实 lib 函数经 `tsx` 实测：`likePattern("a%b_c\\d")` 转义正确、`makeSnippet` 在 HTML 正文里命中 "123456" 前后取段且去标签、超长 q 截断 100 字符、非法 sort 回退默认、地址游标 `encode/decode` 往返一致。
- 未做线上实测（无可用发信通道做端到端搜索验收，D1 LIKE 语义与现有 `roles/users` 的 `like()` 用法一致）；未 push，未部署——**注意：`feat/admin-config-v1` 分支 push 会触发 CI 自动双实例部署**，部署需用户确认后执行。

> 修复（2026-11-25，八期部署后线上实测发现）：上线后 `GET /api/emails?q=…` 与带 q 的邮件搜索全部 500。根因在 `app/lib/search.ts` 的 `likeColumn`：模板字面量里写的 `ESCAPE '\'`，JS 把 `\'` 当成转义单引号、反斜杠被吃掉，实际发到 D1 的 SQL 是 `ESCAPE ''`（空串），SQLite 报错 "ESCAPE expression must be a single character"。此前 tsx 只测了 `likePattern` 的返回值、没跑真查询，所以没抓到。修复：转义符改用 `!`（`escapeLikeValue` 改为 `!`→`!!`、`%`→`!%`、`_`→`!_`，SQL 用 `ESCAPE '!'`，模板里再无反斜杠）；根因与教训已写进 `search.ts` 顶部注释。复核用临时脚本（drizzle sqlite-proxy + node:sqlite 内存库，已删）跑真查询：`q=mrin` 命中 2 条、地址排序/时间排序均正常、`a%b` 按字面命中含 `%` 的地址、`zzz` 无结果 0 条；`tsc` 与 `npm run build` 均通过。修复提交后重新部署双实例并线上复验。

> 修复二（2026-11-25，用户实测反馈三点）：
> 1. **邮箱搜索崩溃**：`GET /api/emails?q=131` 在修复一部署前是 500，前端 `fetchEmails` 未判 `response.ok` 就把错误体当列表 `setEmails(data.emails)`（undefined），渲染读 `emails.length` 抛 TypeError、整页白屏 "Application error"。已在 `email-list`（含 `ensureAllLoaded`）、`message-list` 的取数处加 `!response.ok` 即抛错 + `Array.isArray` 兜底，接口再报错也只保留旧列表、不崩页。另注：用户截图里的 500 发生在修复一部署完成前，修复后线上复验 `q=131` 已回 200（total 0，无此地址属正常）。
> 2. **右上角全局搜索搜 oscar 显示无结果**：同一故障的另一面——修复前 `/api/search` 也 500，而全局搜索组件把任何失败都按“无结果”显示。已加 `failed` 状态，失败时显示新增的 `search.searchFailed`（“搜索失败，请稍后重试”，五语种），不再误报无结果。全局搜索的邮件 JOIN 查询另用内存库真查询复核：`oscar` 命中邮箱 1 个 + 邮件 2 条（收件人/正文各一）、`123456` 命中验证码邮件且摘要含码、`zzz` 为空。
> 3. **排序下拉框挤成两行**：触发器 132px 塞不下“过期时间：最晚到期在前”这类长文案。已把两处触发器加宽到 152px + `text-xs` + `SelectValue truncate`，并把五语种排序文案缩短（中文如“创建：最新在前 / 过期：最晚在前 / 地址：A → Z”，其余语种同理）。

> 修复三（2026-11-25，用户手机实测反馈）：邮箱行与邮件行的操作按钮（改有效期/分享/删除）用的是 `opacity-0 group-hover:opacity-100`——桌面 hover 才显示，触屏没有 hover，按钮看不见却仍占位可点，点中行后触屏触发 :hover 才显示出来。已改为：选中行任何尺寸常显；未选中行在 lg 以下（单栏移动端）常显，lg 以上桌面端保留 hover 显示。两处同改（`email-list.tsx`、`message-list.tsx`）。
