import { and, eq } from "drizzle-orm"
import type { Db } from "./db"
import { emails, messages, users } from "./schema"

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
