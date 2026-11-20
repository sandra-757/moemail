interface Env {
  DB: D1Database
  SITE_CONFIG?: KVNamespace
}

const CLEANUP_CONFIG = {
  // Whether to delete expired emails
  DELETE_EXPIRED_EMAILS: true,

  // Batch processing size
  BATCH_SIZE: 100,
} as const

const DAY_MS = 86400000
const ORPHAN_BATCH_SIZE = 500

interface CleanupSettings {
  keepMails: boolean
  trashEnabled: boolean
  retentionDays: number
  expiredTrashDefault: boolean
}

/** 读取站点开关：解析口径与 app/lib/site-config.ts 一致（非法/缺失回退默认） */
async function readSettings(env: Env): Promise<CleanupSettings> {
  const [keepRaw, trashRaw, daysRaw, expiredDefaultRaw] = env.SITE_CONFIG
    ? await Promise.all([
        env.SITE_CONFIG.get("KEEP_MAILS_ON_DELETE"),
        env.SITE_CONFIG.get("MAILBOX_TRASH_ENABLED"),
        env.SITE_CONFIG.get("TRASH_RETENTION_DAYS"),
        env.SITE_CONFIG.get("EXPIRED_TRASH_DEFAULT"),
      ])
    : [null, null, null, null]
  const days = Number(daysRaw)
  return {
    keepMails: keepRaw === "true",
    trashEnabled: trashRaw === "true",
    retentionDays: Number.isInteger(days) && days >= 1 && days <= 3650 ? days : 30,
    expiredTrashDefault: expiredDefaultRaw === "true",
  }
}

/** 硬删一个邮箱的语句组：先清分享记录，再删邮件、最后删邮箱行 */
function purgeMailboxStatements(db: D1Database, emailId: string): D1PreparedStatement[] {
  return [
    db
      .prepare(`DELETE FROM message_share WHERE message_id IN (SELECT id FROM message WHERE "emailId" = ?)`)
      .bind(emailId),
    db.prepare(`DELETE FROM email_share WHERE email_id = ?`).bind(emailId),
    db.prepare(`DELETE FROM message WHERE "emailId" = ?`).bind(emailId),
    db.prepare(`DELETE FROM email WHERE id = ?`).bind(emailId),
  ]
}

/** 软删一个邮箱的语句组：先清分享记录（回收站期间分享失效），邮件保持挂载，只打 deleted_at 标记 */
function trashMailboxStatements(db: D1Database, emailId: string, now: number): D1PreparedStatement[] {
  return [
    db
      .prepare(`DELETE FROM message_share WHERE message_id IN (SELECT id FROM message WHERE "emailId" = ?)`)
      .bind(emailId),
    db.prepare(`DELETE FROM email_share WHERE email_id = ?`).bind(emailId),
    db.prepare(`UPDATE email SET deleted_at = ? WHERE id = ?`).bind(now, emailId),
  ]
}

/** 删邮箱留信的语句组：清分享记录，邮件转孤儿（owner_address 记目标地址），再删邮箱行 */
function keepOrphanStatements(db: D1Database, emailId: string, address: string): D1PreparedStatement[] {
  return [
    db
      .prepare(`DELETE FROM message_share WHERE message_id IN (SELECT id FROM message WHERE "emailId" = ?)`)
      .bind(emailId),
    db
      .prepare(`UPDATE message SET "emailId" = NULL, owner_address = ? WHERE "emailId" = ?`)
      .bind(address, emailId),
    db.prepare(`DELETE FROM email_share WHERE email_id = ?`).bind(emailId),
    db.prepare(`DELETE FROM email WHERE id = ?`).bind(emailId),
  ]
}

const main = {
  async scheduled(_: ScheduledEvent, env: Env) {
    const now = Date.now()

    try {
      const { keepMails, trashEnabled, retentionDays, expiredTrashDefault } = await readSettings(env)
      const retentionCutoff = now - retentionDays * DAY_MS

      // 1) 过期邮箱处理（只处理未软删的；回收站中的邮箱归下面的清仓规则）
      if (!CLEANUP_CONFIG.DELETE_EXPIRED_EMAILS) {
        console.log('Expired email deletion is disabled')
      } else if (trashEnabled) {
        // 回收站开启：逐个邮箱三层判定——属主个人设置 expired_to_trash 优先，
        // 未设置（NULL）跟随站点默认 EXPIRED_TRASH_DEFAULT；进回收站 = 软删，
        // 不进回收站 = 回到五期 KEEP 分支（留信转孤儿 / 连信硬删）
        const { results } = await env.DB
          .prepare(`SELECT email.id AS id, email.address AS address, user.expired_to_trash AS expired_to_trash
            FROM email LEFT JOIN user ON user.id = email."userId"
            WHERE email.expires_at < ? AND email.deleted_at IS NULL LIMIT ?`)
          .bind(now, CLEANUP_CONFIG.BATCH_SIZE)
          .all<{ id: string; address: string; expired_to_trash: number | null }>()

        const expired = results ?? []
        let trashed = 0
        let kept = 0
        let deleted = 0
        for (const row of expired) {
          const toTrash = row.expired_to_trash != null ? row.expired_to_trash === 1 : expiredTrashDefault
          if (toTrash) {
            await env.DB.batch(trashMailboxStatements(env.DB, row.id, now))
            trashed++
          } else if (keepMails) {
            await env.DB.batch(keepOrphanStatements(env.DB, row.id, row.address))
            kept++
          } else {
            await env.DB.batch(purgeMailboxStatements(env.DB, row.id))
            deleted++
          }
        }
        console.log(`Processed ${expired.length} expired emails: ${trashed} moved to trash, ${kept} deleted with messages kept as orphan mails, ${deleted} deleted`)
      } else if (!keepMails) {
        const result = await env.DB
          .prepare(`
          DELETE FROM email 
          WHERE expires_at < ? AND deleted_at IS NULL
          LIMIT ?
        `)
          .bind(now, CLEANUP_CONFIG.BATCH_SIZE)
          .run()

        if (result.success) {
          console.log(`Deleted ${result?.meta?.changes ?? 0} expired emails and their associated messages`)
        } else {
          console.error('Failed to delete expired emails')
        }
      } else {
        // 站点开关 KEEP_MAILS_ON_DELETE 开启时：过期邮箱照常删除，
        // 但其邮件转为孤儿邮件保留（日后同地址重建邮箱可认领），不随邮箱一并删除。
        const { results } = await env.DB
          .prepare(`SELECT id, address FROM email WHERE expires_at < ? AND deleted_at IS NULL LIMIT ?`)
          .bind(now, CLEANUP_CONFIG.BATCH_SIZE)
          .all<{ id: string; address: string }>()

        const expired = results ?? []
        for (const row of expired) {
          await env.DB.batch(keepOrphanStatements(env.DB, row.id, row.address))
        }
        console.log(`Deleted ${expired.length} expired emails; their messages were kept as orphan mails`)
      }

      // 2) 回收站清仓（仅回收站开启时）：软删超过保留期的邮箱彻底删除
      if (trashEnabled) {
        const { results } = await env.DB
          .prepare(`SELECT id FROM email WHERE deleted_at IS NOT NULL AND deleted_at < ? LIMIT ?`)
          .bind(retentionCutoff, CLEANUP_CONFIG.BATCH_SIZE)
          .all<{ id: string }>()

        const stale = results ?? []
        for (const row of stale) {
          await env.DB.batch(purgeMailboxStatements(env.DB, row.id))
        }
        console.log(`Purged ${stale.length} trashed emails past the ${retentionDays}-day retention`)
      }

      // 3) 孤儿清仓（始终执行，不受回收站开关约束）：超过保留期的无主邮件删除（连带其分享记录）
      const { results: orphanResults } = await env.DB
        .prepare(`SELECT id FROM message WHERE "emailId" IS NULL AND received_at < ? LIMIT ?`)
        .bind(retentionCutoff, ORPHAN_BATCH_SIZE)
        .all<{ id: string }>()

      const orphanIds = (orphanResults ?? []).map((row) => row.id)
      if (orphanIds.length > 0) {
        const placeholders = orphanIds.map(() => "?").join(",")
        await env.DB.batch([
          env.DB
            .prepare(`DELETE FROM message_share WHERE message_id IN (${placeholders})`)
            .bind(...orphanIds),
          env.DB
            .prepare(`DELETE FROM message WHERE id IN (${placeholders})`)
            .bind(...orphanIds),
        ])
      }
      console.log(`Deleted ${orphanIds.length} orphan messages past the ${retentionDays}-day retention`)
    } catch (error) {
      console.error('Failed to cleanup:', error)
      throw error
    }
  }
}

export default main
