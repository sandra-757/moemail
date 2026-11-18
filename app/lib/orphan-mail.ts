import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import type { Db } from "./db"
import { emailShares, messageShares, messages } from "./schema"
import { parseConfigBool, SITE_CONFIG_DEFAULTS } from "./site-config"

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

/** 任一保留开关开启时，新建邮箱都可认领该地址的孤儿邮件 */
export async function shouldClaimOrphans(kv: SiteConfigKvLike): Promise<boolean> {
  const [save, keep] = await Promise.all([
    kv.get("SAVE_ORPHAN_MAILS"),
    kv.get("KEEP_MAILS_ON_DELETE"),
  ])
  return (
    parseConfigBool(save, SITE_CONFIG_DEFAULTS.SAVE_ORPHAN_MAILS) ||
    parseConfigBool(keep, SITE_CONFIG_DEFAULTS.KEEP_MAILS_ON_DELETE)
  )
}

/** 把属于 address 的全部孤儿邮件挂到 emailId 名下，返回认领数量 */
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
