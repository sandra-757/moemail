import { and, eq, gt, sql } from "drizzle-orm"
import type { Db } from "./db"
import { emails, userRoles, users } from "./schema"
import { ROLES, type Role } from "./permissions"
import { EMAIL_CONFIG } from "@/config"

/**
 * 邮箱上限分层配置：
 * 1. 用户个人上限（D1 user.email_limit，非 null 时最高优先级，对所有角色生效）
 * 2. 分组（角色）上限（KV MAX_EMAILS_<ROLE>，空/缺失/非法 = 未设置）
 * 3. 皇帝在未被 1/2 设置时不限量（Infinity）
 * 4. 全局上限（KV MAX_EMAILS，缺失/非法时回退 EMAIL_CONFIG.MAX_ACTIVE_EMAILS）
 */

export const ROLE_LIMIT_MIN = 1
export const ROLE_LIMIT_MAX = 100000

export const ROLE_LIMIT_KV_KEYS: Record<Role, string> = {
  [ROLES.EMPEROR]: "MAX_EMAILS_EMPEROR",
  [ROLES.DUKE]: "MAX_EMAILS_DUKE",
  [ROLES.KNIGHT]: "MAX_EMAILS_KNIGHT",
  [ROLES.CIVILIAN]: "MAX_EMAILS_CIVILIAN",
}

export interface SiteConfigKv {
  get(key: string): Promise<string | null>
}

/** 解析分组上限：合法整数（1–100000）返回数字，其余（空/缺失/非法）返回 null 表示未设置 */
export function parseRoleLimit(value: string | null | undefined): number | null {
  if (value == null) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < ROLE_LIMIT_MIN || parsed > ROLE_LIMIT_MAX) {
    return null
  }
  return parsed
}

/** 校验管理员提交的分组上限：空字符串 = 清除设置；其余必须是 1–100000 的整数 */
export function isValidRoleLimitInput(value: string): boolean {
  if (typeof value !== "string") return false
  if (value.trim() === "") return true
  return parseRoleLimit(value) !== null
}

/** 校验个人邮箱上限输入（API 层）：null = 清除；数字必须是 1–100000 的整数 */
export function isValidUserEmailLimit(value: unknown): value is number | null {
  if (value === null) return true
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= ROLE_LIMIT_MIN &&
    value <= ROLE_LIMIT_MAX
  )
}

export async function getUserRoleName(db: Db, userId: string): Promise<Role | null> {
  const records = await db.query.userRoles.findMany({
    where: eq(userRoles.userId, userId),
    with: { role: true },
  })
  const name = records[0]?.role.name
  return (name as Role) ?? null
}

/**
 * 解析某用户当前生效的邮箱上限。
 * 返回 Infinity 表示不限量（仅皇帝在未设置个人/分组上限时）。
 */
export async function resolveEmailLimit(db: Db, kv: SiteConfigKv, userId: string): Promise<number> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { emailLimit: true },
  })
  if (user?.emailLimit != null) {
    return user.emailLimit
  }

  const roleName = await getUserRoleName(db, userId)

  if (roleName) {
    const roleLimit = parseRoleLimit(await kv.get(ROLE_LIMIT_KV_KEYS[roleName]))
    if (roleLimit !== null) {
      return roleLimit
    }
  }

  if (roleName === ROLES.EMPEROR) {
    return Infinity
  }

  const globalRaw = await kv.get("MAX_EMAILS")
  const globalParsed = Number(globalRaw)
  if (globalRaw != null && globalRaw.trim() !== "" && Number.isInteger(globalParsed) && globalParsed > 0) {
    return globalParsed
  }
  return EMAIL_CONFIG.MAX_ACTIVE_EMAILS
}

/** 统计用户当前未过期的邮箱数量 */
export async function countActiveEmails(db: Db, userId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(emails)
    .where(
      and(
        eq(emails.userId, userId),
        gt(emails.expiresAt, new Date())
      )
    )
  return Number(result[0].count)
}
