import { PERMISSIONS, Role, ROLES } from "@/lib/permissions"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { EMAIL_CONFIG } from "@/config"
import { checkPermission } from "@/lib/auth"
import { EXPIRY_OPTIONS } from "@/types/email"
import {
  SITE_CONFIG_DEFAULTS,
  MAX_EMAILS_MIN,
  MAX_EMAILS_MAX,
  POLL_INTERVAL_MIN_SECONDS,
  POLL_INTERVAL_MAX_SECONDS,
  TRASH_RETENTION_MIN_DAYS,
  TRASH_RETENTION_MAX_DAYS,
  parseConfigBool,
  parseDefaultExpiry,
  parsePollIntervalSeconds,
  parseTrashRetentionDays,
  parseSiteName,
  normalizeEmailDomains,
} from "@/lib/site-config"
import { ROLE_LIMIT_KV_KEYS, ROLE_LIMIT_MIN, ROLE_LIMIT_MAX, isValidRoleLimitInput } from "@/lib/email-limit"

const ROLE_LIMIT_FIELDS = [
  ["emperor", ROLE_LIMIT_KV_KEYS[ROLES.EMPEROR] as string],
  ["duke", ROLE_LIMIT_KV_KEYS[ROLES.DUKE] as string],
  ["knight", ROLE_LIMIT_KV_KEYS[ROLES.KNIGHT] as string],
] as const

type RoleLimitField = (typeof ROLE_LIMIT_FIELDS)[number][0]

export const runtime = "edge"

export async function GET() {
  const env = getRequestContext().env
  const canManageConfig = await checkPermission(PERMISSIONS.MANAGE_CONFIG)

  const [
    defaultRole,
    emailDomains,
    adminContact,
    maxEmails,
    turnstileEnabled,
    turnstileSiteKey,
    turnstileSecretKey,
    siteName,
    announcementEnabled,
    announcementText,
    allowRegistration,
    maintenanceMode,
    maintenanceMessage,
    defaultExpiryMs,
    allowPermanentEmail,
    pollIntervalSeconds,
    saveOrphanMails,
    keepMailsOnDelete,
    mailboxTrashEnabled,
    trashRetentionDays,
    expiredTrashDefault,
    roleLimitValues
  ] = await Promise.all([
    env.SITE_CONFIG.get("DEFAULT_ROLE"),
    env.SITE_CONFIG.get("EMAIL_DOMAINS"),
    env.SITE_CONFIG.get("ADMIN_CONTACT"),
    env.SITE_CONFIG.get("MAX_EMAILS"),
    env.SITE_CONFIG.get("TURNSTILE_ENABLED"),
    env.SITE_CONFIG.get("TURNSTILE_SITE_KEY"),
    env.SITE_CONFIG.get("TURNSTILE_SECRET_KEY"),
    env.SITE_CONFIG.get("SITE_NAME"),
    env.SITE_CONFIG.get("ANNOUNCEMENT_ENABLED"),
    env.SITE_CONFIG.get("ANNOUNCEMENT_TEXT"),
    env.SITE_CONFIG.get("ALLOW_REGISTRATION"),
    env.SITE_CONFIG.get("MAINTENANCE_MODE"),
    env.SITE_CONFIG.get("MAINTENANCE_MESSAGE"),
    env.SITE_CONFIG.get("DEFAULT_EXPIRY_MS"),
    env.SITE_CONFIG.get("ALLOW_PERMANENT_EMAIL"),
    env.SITE_CONFIG.get("POLL_INTERVAL_SECONDS"),
    env.SITE_CONFIG.get("SAVE_ORPHAN_MAILS"),
    env.SITE_CONFIG.get("KEEP_MAILS_ON_DELETE"),
    env.SITE_CONFIG.get("MAILBOX_TRASH_ENABLED"),
    env.SITE_CONFIG.get("TRASH_RETENTION_DAYS"),
    env.SITE_CONFIG.get("EXPIRED_TRASH_DEFAULT"),
    Promise.all(ROLE_LIMIT_FIELDS.map(([, key]) => env.SITE_CONFIG.get(key)))
  ])

  return Response.json({
    defaultRole: defaultRole || ROLES.CIVILIAN,
    emailDomains: emailDomains || "moemail.app",
    adminContact: adminContact || "",
    maxEmails: maxEmails || EMAIL_CONFIG.MAX_ACTIVE_EMAILS.toString(),
    siteName: parseSiteName(siteName),
    announcementEnabled: parseConfigBool(announcementEnabled, SITE_CONFIG_DEFAULTS.ANNOUNCEMENT_ENABLED),
    announcementText: announcementText || "",
    allowRegistration: parseConfigBool(allowRegistration, SITE_CONFIG_DEFAULTS.ALLOW_REGISTRATION),
    maintenanceMode: parseConfigBool(maintenanceMode, SITE_CONFIG_DEFAULTS.MAINTENANCE_MODE),
    maintenanceMessage: maintenanceMessage || "",
    defaultExpiry: parseDefaultExpiry(defaultExpiryMs),
    allowPermanentEmail: parseConfigBool(allowPermanentEmail, SITE_CONFIG_DEFAULTS.ALLOW_PERMANENT_EMAIL),
    pollIntervalSeconds: parsePollIntervalSeconds(pollIntervalSeconds),
    saveOrphanMails: parseConfigBool(saveOrphanMails, SITE_CONFIG_DEFAULTS.SAVE_ORPHAN_MAILS),
    keepMailsOnDelete: parseConfigBool(keepMailsOnDelete, SITE_CONFIG_DEFAULTS.KEEP_MAILS_ON_DELETE),
    mailboxTrashEnabled: parseConfigBool(mailboxTrashEnabled, SITE_CONFIG_DEFAULTS.MAILBOX_TRASH_ENABLED),
    trashRetentionDays: parseTrashRetentionDays(trashRetentionDays),
    expiredTrashDefault: parseConfigBool(expiredTrashDefault, SITE_CONFIG_DEFAULTS.EXPIRED_TRASH_DEFAULT),
    roleLimits: Object.fromEntries(
      ROLE_LIMIT_FIELDS.map(([field], index) => [field, roleLimitValues[index] || ""])
    ) as Record<RoleLimitField, string>,
    turnstile: canManageConfig ? {
      enabled: turnstileEnabled === "true",
      siteKey: turnstileSiteKey || "",
      secretKey: turnstileSecretKey || "",
    } : undefined
  })
}

interface ConfigPostBody {
  defaultRole: Exclude<Role, typeof ROLES.EMPEROR>
  emailDomains: string
  adminContact: string
  maxEmails: string
  siteName?: string
  announcementEnabled?: boolean
  announcementText?: string
  allowRegistration?: boolean
  maintenanceMode?: boolean
  maintenanceMessage?: string
  defaultExpiry?: number
  allowPermanentEmail?: boolean
  pollIntervalSeconds?: number
  saveOrphanMails?: boolean
  keepMailsOnDelete?: boolean
  mailboxTrashEnabled?: boolean
  trashRetentionDays?: number
  expiredTrashDefault?: boolean
  roleLimits?: Partial<Record<RoleLimitField, string>>
  turnstile?: {
    enabled: boolean
    siteKey: string
    secretKey: string
  }
}

export async function POST(request: Request) {
  const canAccess = await checkPermission(PERMISSIONS.MANAGE_CONFIG)

  if (!canAccess) {
    return Response.json({
      error: "权限不足"
    }, { status: 403 })
  }

  const body = await request.json() as ConfigPostBody
  const {
    defaultRole,
    emailDomains,
    adminContact,
    maxEmails,
    turnstile
  } = body

  if (![ROLES.DUKE, ROLES.KNIGHT, ROLES.CIVILIAN].includes(defaultRole)) {
    return Response.json({ error: "无效的角色" }, { status: 400 })
  }

  // MAX_EMAILS：必须是 1–10000 的整数
  const maxEmailsNum = Number(maxEmails)
  if (!Number.isInteger(maxEmailsNum) || maxEmailsNum < MAX_EMAILS_MIN || maxEmailsNum > MAX_EMAILS_MAX) {
    return Response.json({ error: `最大邮箱数量必须是 ${MAX_EMAILS_MIN}–${MAX_EMAILS_MAX} 的整数` }, { status: 400 })
  }

  // EMAIL_DOMAINS：trim / 转小写 / 去重 / 域名正则校验，为空返回 400
  const normalizedDomains = normalizeEmailDomains(emailDomains)
  if (!normalizedDomains) {
    return Response.json({ error: "邮箱域名为空或包含无效域名" }, { status: 400 })
  }

  // 新增字段校验（字段缺失时不覆盖已有 KV 值，保持向后兼容）
  let siteNameValue: string | undefined
  if (body.siteName !== undefined) {
    if (typeof body.siteName !== "string" || body.siteName.trim().length > 100) {
      return Response.json({ error: "站点名称无效" }, { status: 400 })
    }
    siteNameValue = parseSiteName(body.siteName)
  }

  const boolFields: Array<[keyof ConfigPostBody, string]> = [
    ["announcementEnabled", "ANNOUNCEMENT_ENABLED"],
    ["allowRegistration", "ALLOW_REGISTRATION"],
    ["maintenanceMode", "MAINTENANCE_MODE"],
    ["allowPermanentEmail", "ALLOW_PERMANENT_EMAIL"],
    ["saveOrphanMails", "SAVE_ORPHAN_MAILS"],
    ["keepMailsOnDelete", "KEEP_MAILS_ON_DELETE"],
    ["mailboxTrashEnabled", "MAILBOX_TRASH_ENABLED"],
    ["expiredTrashDefault", "EXPIRED_TRASH_DEFAULT"],
  ]
  for (const [field] of boolFields) {
    if (body[field] !== undefined && typeof body[field] !== "boolean") {
      return Response.json({ error: `配置项 ${field} 必须是布尔值` }, { status: 400 })
    }
  }

  const textFields: Array<[keyof ConfigPostBody, string]> = [
    ["announcementText", "ANNOUNCEMENT_TEXT"],
    ["maintenanceMessage", "MAINTENANCE_MESSAGE"],
  ]
  for (const [field] of textFields) {
    if (body[field] !== undefined && (typeof body[field] !== "string" || (body[field] as string).length > 500)) {
      return Response.json({ error: `配置项 ${field} 无效或过长` }, { status: 400 })
    }
  }

  if (body.defaultExpiry !== undefined) {
    if (!EXPIRY_OPTIONS.some((option) => option.value === body.defaultExpiry)) {
      return Response.json({ error: "无效的默认邮箱有效期" }, { status: 400 })
    }
  }

  if (body.pollIntervalSeconds !== undefined) {
    if (
      !Number.isInteger(body.pollIntervalSeconds) ||
      body.pollIntervalSeconds < POLL_INTERVAL_MIN_SECONDS ||
      body.pollIntervalSeconds > POLL_INTERVAL_MAX_SECONDS
    ) {
      return Response.json({ error: `轮询间隔必须是 ${POLL_INTERVAL_MIN_SECONDS}–${POLL_INTERVAL_MAX_SECONDS} 的整数秒` }, { status: 400 })
    }
  }

  if (body.trashRetentionDays !== undefined) {
    if (
      !Number.isInteger(body.trashRetentionDays) ||
      body.trashRetentionDays < TRASH_RETENTION_MIN_DAYS ||
      body.trashRetentionDays > TRASH_RETENTION_MAX_DAYS
    ) {
      return Response.json({ error: `回收站保留天数必须是 ${TRASH_RETENTION_MIN_DAYS}–${TRASH_RETENTION_MAX_DAYS} 的整数` }, { status: 400 })
    }
  }

  // 分组邮箱上限：每个字段缺失时不动；空字符串 = 清除（跟随下一级规则）；
  // 其余必须是 1–100000 的整数字符串
  if (body.roleLimits !== undefined) {
    if (typeof body.roleLimits !== "object" || body.roleLimits === null) {
      return Response.json({ error: "分组邮箱上限格式无效" }, { status: 400 })
    }
    for (const [field] of ROLE_LIMIT_FIELDS) {
      const value = body.roleLimits[field]
      if (value !== undefined && !isValidRoleLimitInput(value)) {
        return Response.json({ error: `分组邮箱上限必须是 ${ROLE_LIMIT_MIN}–${ROLE_LIMIT_MAX} 的整数或留空` }, { status: 400 })
      }
    }
  }

  const turnstileConfig = turnstile ?? {
    enabled: false,
    siteKey: "",
    secretKey: ""
  }

  if (turnstileConfig.enabled && (!turnstileConfig.siteKey || !turnstileConfig.secretKey)) {
    return Response.json({ error: "Turnstile 启用时需要提供 Site Key 和 Secret Key" }, { status: 400 })
  }

  const env = getRequestContext().env
  const puts: Promise<void>[] = [
    env.SITE_CONFIG.put("DEFAULT_ROLE", defaultRole),
    env.SITE_CONFIG.put("EMAIL_DOMAINS", normalizedDomains.join(",")),
    env.SITE_CONFIG.put("ADMIN_CONTACT", adminContact),
    env.SITE_CONFIG.put("MAX_EMAILS", maxEmailsNum.toString()),
    env.SITE_CONFIG.put("TURNSTILE_ENABLED", turnstileConfig.enabled.toString()),
    env.SITE_CONFIG.put("TURNSTILE_SITE_KEY", turnstileConfig.siteKey),
    env.SITE_CONFIG.put("TURNSTILE_SECRET_KEY", turnstileConfig.secretKey)
  ]

  if (siteNameValue !== undefined) {
    puts.push(env.SITE_CONFIG.put("SITE_NAME", siteNameValue))
  }
  for (const [field, key] of boolFields) {
    if (body[field] !== undefined) {
      puts.push(env.SITE_CONFIG.put(key, String(body[field])))
    }
  }
  for (const [field, key] of textFields) {
    if (body[field] !== undefined) {
      puts.push(env.SITE_CONFIG.put(key, body[field] as string))
    }
  }
  if (body.defaultExpiry !== undefined) {
    puts.push(env.SITE_CONFIG.put("DEFAULT_EXPIRY_MS", body.defaultExpiry.toString()))
  }
  if (body.pollIntervalSeconds !== undefined) {
    puts.push(env.SITE_CONFIG.put("POLL_INTERVAL_SECONDS", body.pollIntervalSeconds.toString()))
  }
  if (body.trashRetentionDays !== undefined) {
    puts.push(env.SITE_CONFIG.put("TRASH_RETENTION_DAYS", body.trashRetentionDays.toString()))
  }
  if (body.roleLimits !== undefined) {
    for (const [field, key] of ROLE_LIMIT_FIELDS) {
      const value = body.roleLimits[field]
      if (value === undefined) continue
      const trimmed = value.trim()
      puts.push(
        trimmed === ""
          ? env.SITE_CONFIG.delete(key)
          : env.SITE_CONFIG.put(key, Number(trimmed).toString())
      )
    }
  }

  await Promise.all(puts)

  return Response.json({ success: true })
}
