import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import type { Db } from "./db"
import { emailShares, emails, messageShares, messages } from "./schema"
import { parseConfigBool, parseTrashRetentionDays, SITE_CONFIG_DEFAULTS } from "./site-config"

/**
 * 孤儿邮件：没有归属邮箱的邮件（message.emailId 为空、ownerAddress 记录其目标地址）。
 * 来源有二：收信时目标邮箱不存在（开关 SAVE_ORPHAN_MAILS）、删邮箱时保留下来的邮件
 * （开关 KEEP_MAILS_ON_DELETE）。同地址邮箱被新建时，孤儿邮件被认领回该邮箱。
 */

export interface SiteConfigKvLike {
  get(key: string): Promise<string | null>
}

export async function isSaveOrphanMailsEnabled(kv: SiteConfigKvLike): Promise<boolean> {
  return parseConfigBool(await kv.get("SAVE_ORPHAN_MAILS"), SITE_CONFIG_DEFAULTS.SAVE_ORPHAN_MAILS)
}

export async function isKeepMailsOnDeleteEnabled(kv: SiteConfigKvLike): Promise<boolean> {
  return parseConfigBool(await kv.get("KEEP_MAILS_ON_DELETE"), SITE_CONFIG_DEFAULTS.KEEP_MAILS_ON_DELETE)
}

export async function isMailboxTrashEnabled(kv: SiteConfigKvLike): Promise<boolean> {
  return parseConfigBool(await kv.get("MAILBOX_TRASH_ENABLED"), SITE_CONFIG_DEFAULTS.MAILBOX_TRASH_ENABLED)
}

/** 回收站保留天数（软删邮箱与孤儿邮件的清仓期限），非法/缺失回退默认 30 天 */
export async function getTrashRetentionDays(kv: SiteConfigKvLike): Promise<number> {
  return parseTrashRetentionDays(await kv.get("TRASH_RETENTION_DAYS"))
}

/** 到期进回收站的站点默认（用户个人设置 user.expired_to_trash 为 NULL 时跟随此值） */
export async function getExpiredTrashDefault(kv: SiteConfigKvLike): Promise<boolean> {
  return parseConfigBool(await kv.get("EXPIRED_TRASH_DEFAULT"), SITE_CONFIG_DEFAULTS.EXPIRED_TRASH_DEFAULT)
}

/** 把属于 address 的全部孤儿邮件挂到 emailId 名下，返回认领数量（建箱时无条件调用，与保留开关解耦） */
export async function claimOrphanMessages(db: Db, emailId: string, address: string): Promise<number> {
  const claimed = await db
    .update(messages)
    .set({ emailId, ownerAddress: null })
    .where(
      and(
        isNull(messages.emailId),
        eq(sql`LOWER(${messages.ownerAddress})`, address.toLowerCase())
      )
    )
    .returning({ id: messages.id })
  return claimed.length
}

/** 删邮箱时保留其邮件：清掉分享记录，把邮件转成以邮箱地址为归属的孤儿邮件 */
export async function detachMessagesToOrphans(
  db: Db,
  email: { id: string; address: string }
): Promise<void> {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.emailId, email.id))
  const ids = rows.map((row) => row.id)
  if (ids.length > 0) {
    await db.delete(messageShares).where(inArray(messageShares.messageId, ids))
    await db
      .update(messages)
      .set({ emailId: null, ownerAddress: email.address })
      .where(eq(messages.emailId, email.id))
  }
  await db.delete(emailShares).where(eq(emailShares.emailId, email.id))
}

/**
 * 软删邮箱（进回收站）：清掉分享记录（回收站期间分享链接失效），
 * 邮件保持挂载不动，只给邮箱打 deleted_at 标记。
 */
export async function moveMailboxToTrash(
  db: Db,
  email: { id: string }
): Promise<void> {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.emailId, email.id))
  const ids = rows.map((row) => row.id)
  if (ids.length > 0) {
    await db.delete(messageShares).where(inArray(messageShares.messageId, ids))
  }
  await db.delete(emailShares).where(eq(emailShares.emailId, email.id))
  await db
    .update(emails)
    .set({ deletedAt: new Date() })
    .where(eq(emails.id, email.id))
}

/** 彻底删除邮箱（回收站彻删/清仓）：清分享记录后删邮件、再删邮箱行，不依赖外键级联 */
export async function purgeMailbox(db: Db, emailId: string): Promise<void> {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.emailId, emailId))
  const ids = rows.map((row) => row.id)
  if (ids.length > 0) {
    await db.delete(messageShares).where(inArray(messageShares.messageId, ids))
  }
  await db.delete(emailShares).where(eq(emailShares.emailId, emailId))
  await db.delete(messages).where(eq(messages.emailId, emailId))
  await db.delete(emails).where(eq(emails.id, emailId))
}
