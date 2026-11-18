import { and, eq } from "drizzle-orm"
import type { Db } from "./db"
import { emails, messages, users } from "./schema"
import { ROLES } from "./permissions"
import { getUserRoleName } from "./email-limit"

export const SPACE_TARGET_FORBIDDEN_ERROR = "平民用户没有邮箱权限，不能进入其邮箱空间"

/**
 * 平民（及无角色）没有任何邮箱权限，本人用不了邮箱，管理员也不进其空间：
 * 只有皇帝/公爵/骑士（持有 MANAGE_EMAIL 的角色）可作为空间目标。
 */
export async function isSpaceTargetForbidden(db: Db, userId: string): Promise<boolean> {
  const role = await getUserRoleName(db, userId)
  return role !== ROLES.EMPEROR && role !== ROLES.DUKE && role !== ROLES.KNIGHT
}

/** Space API 的归属校验 helper：邮箱/消息必须属于路径上的 userId，不符一律按不存在处理（404） */

export async function loadSpaceUser(db: Db, userId: string) {
  return db.query.users.findFirst({
    where: eq(users.id, userId),
  })
}

export async function loadOwnedEmail(db: Db, userId: string, emailId: string) {
  return db.query.emails.findFirst({
    where: and(eq(emails.id, emailId), eq(emails.userId, userId)),
  })
}

export async function loadOwnedMessage(db: Db, emailId: string, messageId: string) {
  return db.query.messages.findFirst({
    where: and(eq(messages.id, messageId), eq(messages.emailId, emailId)),
  })
}
