import { desc, eq, isNotNull, sql } from "drizzle-orm"
import { PERMISSIONS } from "@/lib/permissions"
import { checkPermission } from "@/lib/auth"
import { createDb } from "@/lib/db"
import { emails, messages, users } from "@/lib/schema"

export const runtime = "edge"

/** 管理员回收站：列出全部软删邮箱（按删除时间倒序），含属主与挂载邮件数 */
export async function GET() {
  const canAccess = await checkPermission(PERMISSIONS.MANAGE_CONFIG)
  if (!canAccess) {
    return Response.json({ error: "权限不足" }, { status: 403 })
  }

  const db = createDb()

  const rows = await db
    .select({
      id: emails.id,
      address: emails.address,
      userId: emails.userId,
      ownerUsername: users.username,
      ownerName: users.name,
      ownerEmail: users.email,
      deletedAt: emails.deletedAt,
      createdAt: emails.createdAt,
      expiresAt: emails.expiresAt,
    })
    .from(emails)
    .leftJoin(users, eq(emails.userId, users.id))
    .where(isNotNull(emails.deletedAt))
    .orderBy(desc(emails.deletedAt))

  // 挂载邮件数单独分组统计（相关子查询在 D1 上结果不可靠）
  const countRows = await db
    .select({ emailId: messages.emailId, count: sql<number>`count(*)` })
    .from(messages)
    .innerJoin(emails, eq(messages.emailId, emails.id))
    .where(isNotNull(emails.deletedAt))
    .groupBy(messages.emailId)
  const countByEmailId = new Map(countRows.map((r) => [r.emailId, Number(r.count)]))

  return Response.json({
    mailboxes: rows.map((row) => ({
      id: row.id,
      address: row.address,
      userId: row.userId,
      owner: row.ownerUsername || row.ownerName || row.ownerEmail || null,
      deletedAt: row.deletedAt,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      messageCount: countByEmailId.get(row.id) ?? 0,
    })),
  })
}
