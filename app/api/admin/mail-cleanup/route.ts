import { and, eq, inArray, isNotNull, isNull, lt, type SQL } from "drizzle-orm"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { PERMISSIONS } from "@/lib/permissions"
import { checkPermission } from "@/lib/auth"
import { createDb, type Db } from "@/lib/db"
import { emailShares, emails, messageShares, messages, users } from "@/lib/schema"
import { detachMessagesToOrphans, getExpiredTrashDefault, isKeepMailsOnDeleteEnabled, isMailboxTrashEnabled, moveMailboxToTrash } from "@/lib/orphan-mail"

export const runtime = "edge"

const DAY_MS = 86400000
const ACTIONS = ["orphans-all", "orphans-old", "old-messages", "expired-mailboxes"] as const
type CleanupAction = (typeof ACTIONS)[number]

/** 按条件分批硬删邮件（先清分享记录），返回删除数量 */
async function purgeMessages(db: Db, where: SQL | undefined): Promise<number> {
  let total = 0
  for (;;) {
    const rows = await db.select({ id: messages.id }).from(messages).where(where).limit(500)
    if (rows.length === 0) break
    const ids = rows.map((row) => row.id)
    await db.delete(messageShares).where(inArray(messageShares.messageId, ids))
    await db.delete(messages).where(inArray(messages.id, ids))
    total += ids.length
  }
  return total
}

/**
 * 管理员快速清理：
 * - orphans-all：删除全部无主（孤儿）邮件
 * - orphans-old：删除 days 天前的无主邮件（默认 30）
 * - old-messages：删除邮箱内 days 天前的邮件（默认 90，不含无主邮件）
 * - expired-mailboxes：立即处理已过期邮箱（回收站开启时按属主设置/站点默认决定是否软删进回收站，
 *   不进回收站的再按 KEEP_MAILS_ON_DELETE 决定留信转孤儿或连信删除；回收站中的邮箱不在此处理）
 */
export async function POST(request: Request) {
  const canAccess = await checkPermission(PERMISSIONS.MANAGE_CONFIG)
  if (!canAccess) {
    return Response.json({ error: "权限不足" }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as { action?: string; days?: number } | null
  const action = body?.action as CleanupAction | undefined
  if (!action || !ACTIONS.includes(action)) {
    return Response.json({ error: "无效的清理动作" }, { status: 400 })
  }
  const days = body?.days
  if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 3650)) {
    return Response.json({ error: "天数必须是 1–3650 的整数" }, { status: 400 })
  }

  const db = createDb()
  const now = Date.now()

  if (action === "orphans-all") {
    const deleted = await purgeMessages(db, isNull(messages.emailId))
    return Response.json({ success: true, action, deleted })
  }

  if (action === "orphans-old") {
    const cutoff = new Date(now - (days ?? 30) * DAY_MS)
    const deleted = await purgeMessages(
      db,
      and(isNull(messages.emailId), lt(messages.receivedAt, cutoff))
    )
    return Response.json({ success: true, action, deleted })
  }

  if (action === "old-messages") {
    const cutoff = new Date(now - (days ?? 90) * DAY_MS)
    const deleted = await purgeMessages(
      db,
      and(isNotNull(messages.emailId), lt(messages.receivedAt, cutoff))
    )
    return Response.json({ success: true, action, deleted })
  }

  // expired-mailboxes
  const env = getRequestContext().env
  const trashEnabled = await isMailboxTrashEnabled(env.SITE_CONFIG)
  const expiredTrashDefault = trashEnabled ? await getExpiredTrashDefault(env.SITE_CONFIG) : false
  const keepMails = await isKeepMailsOnDeleteEnabled(env.SITE_CONFIG)
  const expired = await db
    .select({ id: emails.id, address: emails.address, expiredToTrash: users.expiredToTrash })
    .from(emails)
    .leftJoin(users, eq(emails.userId, users.id))
    .where(and(lt(emails.expiresAt, new Date(now)), isNull(emails.deletedAt)))
    .limit(500)

  let keptMessages = 0
  let trashedCount = 0
  for (const email of expired) {
    // 回收站开启时逐个邮箱判定：属主个人设置优先，未设置跟随站点默认（与 cleanup Worker 同口径）
    const toTrash = trashEnabled && (email.expiredToTrash ?? expiredTrashDefault)
    if (toTrash) {
      const rows = await db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.emailId, email.id))
      keptMessages += rows.length
      trashedCount += 1
      await moveMailboxToTrash(db, email)
      continue
    }
    if (keepMails) {
      const rows = await db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.emailId, email.id))
      keptMessages += rows.length
      await detachMessagesToOrphans(db, email)
    } else {
      await purgeMessages(db, eq(messages.emailId, email.id))
      await db.delete(emailShares).where(eq(emailShares.emailId, email.id))
    }
    await db.delete(emails).where(eq(emails.id, email.id))
  }

  return Response.json({
    success: true,
    action,
    deleted: expired.length,
    trashed: trashedCount,
    keptMessages: keepMails || trashedCount > 0 ? keptMessages : 0,
  })
}
