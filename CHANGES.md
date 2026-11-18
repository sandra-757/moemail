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
