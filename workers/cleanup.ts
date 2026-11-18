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

const main = {
  async scheduled(_: ScheduledEvent, env: Env) {
    const now = Date.now()

    try {
      if (!CLEANUP_CONFIG.DELETE_EXPIRED_EMAILS) {
        console.log('Expired email deletion is disabled')
        return
      }

      // 站点开关 KEEP_MAILS_ON_DELETE 开启时：过期邮箱照常删除，
      // 但其邮件转为孤儿邮件保留（日后同地址重建邮箱可认领），不随邮箱一并删除。
      const keepMails = env.SITE_CONFIG
        ? (await env.SITE_CONFIG.get("KEEP_MAILS_ON_DELETE")) === "true"
        : false

      if (!keepMails) {
        const result = await env.DB
          .prepare(`
          DELETE FROM email 
          WHERE expires_at < ?
          LIMIT ?
        `)
          .bind(now, CLEANUP_CONFIG.BATCH_SIZE)
          .run()

        if (result.success) {
          console.log(`Deleted ${result?.meta?.changes ?? 0} expired emails and their associated messages`)
        } else {
          console.error('Failed to delete expired emails')
        }
        return
      }

      const { results } = await env.DB
        .prepare(`SELECT id, address FROM email WHERE expires_at < ? LIMIT ?`)
        .bind(now, CLEANUP_CONFIG.BATCH_SIZE)
        .all<{ id: string; address: string }>()

      const expired = results ?? []
      for (const row of expired) {
        await env.DB.batch([
          env.DB
            .prepare(`DELETE FROM message_share WHERE message_id IN (SELECT id FROM message WHERE "emailId" = ?)`)
            .bind(row.id),
          env.DB
            .prepare(`UPDATE message SET "emailId" = NULL, owner_address = ? WHERE "emailId" = ?`)
            .bind(row.address, row.id),
          env.DB
            .prepare(`DELETE FROM email_share WHERE email_id = ?`)
            .bind(row.id),
          env.DB
            .prepare(`DELETE FROM email WHERE id = ?`)
            .bind(row.id),
        ])
      }
      console.log(`Deleted ${expired.length} expired emails; their messages were kept as orphan mails`)
    } catch (error) {
      console.error('Failed to cleanup:', error)
      throw error
    }
  }
}

export default main
