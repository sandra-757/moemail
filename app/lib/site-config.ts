import { EXPIRY_OPTIONS } from "@/types/email"

/**
 * 站点配置（存于 KV binding SITE_CONFIG）的默认值与解析 helper。
 * 所有键缺省时必须等价于扩展前的上游行为（向后兼容）。
 */
export const SITE_CONFIG_DEFAULTS = {
  SITE_NAME: "MoeMail",
  ANNOUNCEMENT_ENABLED: false,
  ANNOUNCEMENT_TEXT: "",
  ALLOW_REGISTRATION: true,
  MAINTENANCE_MODE: false,
  MAINTENANCE_MESSAGE: "",
  DEFAULT_EXPIRY_MS: 86400000,
  ALLOW_PERMANENT_EMAIL: true,
  POLL_INTERVAL_SECONDS: 10,
  SAVE_ORPHAN_MAILS: false,
  KEEP_MAILS_ON_DELETE: false,
  MAILBOX_TRASH_ENABLED: false,
  TRASH_RETENTION_DAYS: 30,
  EXPIRED_TRASH_DEFAULT: false,
} as const

export const POLL_INTERVAL_MIN_SECONDS = 3
export const POLL_INTERVAL_MAX_SECONDS = 120
export const TRASH_RETENTION_MIN_DAYS = 1
export const TRASH_RETENTION_MAX_DAYS = 3650
export const MAX_EMAILS_MIN = 1
export const MAX_EMAILS_MAX = 10000

/** KV 中布尔值的解析：只有精确的 "true" 为真，其余（包括缺失）回退默认值 */
export function parseConfigBool(value: string | null | undefined, fallback: boolean): boolean {
  if (value === "true") return true
  if (value === "false") return false
  return fallback
}

/** 解析默认有效期：必须是 EXPIRY_OPTIONS 之一，否则回退默认值 */
export function parseDefaultExpiry(value: string | null | undefined): number {
  const parsed = Number(value)
  if (value != null && EXPIRY_OPTIONS.some((option) => option.value === parsed)) {
    return parsed
  }
  return SITE_CONFIG_DEFAULTS.DEFAULT_EXPIRY_MS
}

/** 解析轮询间隔（秒）：整数且在 3–120 范围内，否则回退默认值 */
export function parsePollIntervalSeconds(value: string | null | undefined): number {
  const parsed = Number(value)
  if (
    value != null &&
    Number.isInteger(parsed) &&
    parsed >= POLL_INTERVAL_MIN_SECONDS &&
    parsed <= POLL_INTERVAL_MAX_SECONDS
  ) {
    return parsed
  }
  return SITE_CONFIG_DEFAULTS.POLL_INTERVAL_SECONDS
}

/** 解析回收站保留天数：整数且在 1–3650 范围内，否则回退默认值 */
export function parseTrashRetentionDays(value: string | null | undefined): number {
  const parsed = Number(value)
  if (
    value != null &&
    Number.isInteger(parsed) &&
    parsed >= TRASH_RETENTION_MIN_DAYS &&
    parsed <= TRASH_RETENTION_MAX_DAYS
  ) {
    return parsed
  }
  return SITE_CONFIG_DEFAULTS.TRASH_RETENTION_DAYS
}

export function parseSiteName(value: string | null | undefined): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : SITE_CONFIG_DEFAULTS.SITE_NAME
}

const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

/**
 * 规范化邮箱域名列表：trim、转小写、去重。
 * 返回 null 表示输入为空或包含非法域名（调用方应返回 400）。
 */
export function normalizeEmailDomains(input: string): string[] | null {
  if (typeof input !== "string") return null
  const domains = Array.from(
    new Set(
      input
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter((d) => d.length > 0)
    )
  )
  if (domains.length === 0) return null
  if (!domains.every((d) => DOMAIN_REGEX.test(d))) return null
  return domains
}
