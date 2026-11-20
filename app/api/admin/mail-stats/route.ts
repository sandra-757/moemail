import { and, count, eq, isNull, lt, sql } from "drizzle-orm"
import { PERMISSIONS } from "@/lib/permissions"
import { checkPermission } from "@/lib/auth"
import { createDb } from "@/lib/db"
import { emails, messages } from "@/lib/schema"

export const runtime = "edge"

const DAY_MS = 86400000

/** 管理员邮件统计：邮箱/邮件总量、无主（孤儿）邮件、体积与可清理量（邮箱数不含回收站中的软删邮箱） */
export async function GET() {
  const canAccess = await checkPermission(PERMISSIONS.MANAGE_CONFIG)
  if (!canAccess) {
    return Response.json({ error: "权限不足" }, { status: 403 })
  }

  const db = createDb()
  const now = new Date()
  const orphanOldCutoff = new Date(now.getTime() - 30 * DAY_MS)
  const oldCutoff = new Date(now.getTime() - 90 * DAY_MS)
  const bytesExpr = sql<number>`coalesce(sum(length(${messages.content}) + length(coalesce(${messages.html}, ''))), 0)`

  const [
    emailsTotalRows,
    emailsExpiredRows,
    messagesTotalRows,
    messagesReceivedRows,
    messagesSentRows,
    messagesBytesRows,
    orphansTotalRows,
    orphansBytesRows,
    orphansOldRows,
    oldestOrphanRows,
    oldMessagesRows,
  ] = await Promise.all([
    db.select({ value: count() }).from(emails).where(isNull(emails.deletedAt)),
    db.select({ value: count() }).from(emails).where(and(isNull(emails.deletedAt), lt(emails.expiresAt, now))),
    db.select({ value: count() }).from(messages),
    db.select({ value: count() }).from(messages).where(eq(messages.type, "received")),
    db.select({ value: count() }).from(messages).where(eq(messages.type, "sent")),
    db.select({ value: bytesExpr }).from(messages),
    db.select({ value: count() }).from(messages).where(isNull(messages.emailId)),
    db.select({ value: bytesExpr }).from(messages).where(isNull(messages.emailId)),
    db
      .select({ value: count() })
      .from(messages)
      .where(sql`${messages.emailId} IS NULL AND ${messages.receivedAt} < ${orphanOldCutoff.getTime()}`),
    db
      .select({ value: sql<number | null>`min(${messages.receivedAt})` })
      .from(messages)
      .where(isNull(messages.emailId)),
    db
      .select({ value: count() })
      .from(messages)
      .where(sql`${messages.emailId} IS NOT NULL AND ${messages.receivedAt} < ${oldCutoff.getTime()}`),
  ])

  return Response.json({
    emailsTotal: emailsTotalRows[0]?.value ?? 0,
    emailsExpired: emailsExpiredRows[0]?.value ?? 0,
    messagesTotal: messagesTotalRows[0]?.value ?? 0,
    messagesReceived: messagesReceivedRows[0]?.value ?? 0,
    messagesSent: messagesSentRows[0]?.value ?? 0,
    messagesBytes: messagesBytesRows[0]?.value ?? 0,
    orphansTotal: orphansTotalRows[0]?.value ?? 0,
    orphansBytes: orphansBytesRows[0]?.value ?? 0,
    orphansOlderThan30d: orphansOldRows[0]?.value ?? 0,
    oldestOrphanAt: oldestOrphanRows[0]?.value ?? null,
    messagesOlderThan90d: oldMessagesRows[0]?.value ?? 0,
  })
}
