import { NextResponse } from "next/server"
import { createDb } from "@/lib/db"
import { emails, messages, emailShares, messageShares } from "@/lib/schema"
import { eq, inArray } from "drizzle-orm"
import { isAdminAuthorized } from "@/lib/admin-access"
import { loadOwnedEmail, isSpaceTargetForbidden, SPACE_TARGET_FORBIDDEN_ERROR } from "@/lib/admin-space"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { ROLES } from "@/lib/permissions"
import { computeExpiresAt } from "@/lib/email-expiry"
import { detachMessagesToOrphans, isKeepMailsOnDeleteEnabled } from "@/lib/orphan-mail"

export const runtime = "edge"

/** 管理员删除某用户的邮箱：先手动清分享与消息，再删邮箱（不完全依赖 D1 外键级联） */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string; emailId: string }> }
) {
  if (!(await isAdminAuthorized(request))) {
    return NextResponse.json({ error: "未授权" }, { status: 401 })
  }

  const { userId, emailId } = await params
  const db = createDb()

  if (await isSpaceTargetForbidden(db, userId)) {
    return NextResponse.json({ error: SPACE_TARGET_FORBIDDEN_ERROR }, { status: 403 })
  }

  try {
    const email = await loadOwnedEmail(db, userId, emailId)
    if (!email) {
      return NextResponse.json({ error: "邮箱不存在" }, { status: 404 })
    }

    // 站点开关 KEEP_MAILS_ON_DELETE 开启时：删邮箱保留邮件（转孤儿，日后同地址重建可认领）
    const keepMails = await isKeepMailsOnDeleteEnabled(getRequestContext().env.SITE_CONFIG)
    if (keepMails) {
      await detachMessagesToOrphans(db, email)
    } else {
      const messageRows = await db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.emailId, emailId))
      const messageIds = messageRows.map((row) => row.id)

      if (messageIds.length > 0) {
        await db.delete(messageShares).where(inArray(messageShares.messageId, messageIds))
        await db.delete(messages).where(eq(messages.emailId, emailId))
      }
      await db.delete(emailShares).where(eq(emailShares.emailId, emailId))
    }
    await db.delete(emails).where(eq(emails.id, emailId))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to delete email in admin space:", error)
    return NextResponse.json({ error: "删除邮箱失败" }, { status: 500 })
  }
}

/** 管理员修改某用户邮箱的有效期：expiryTime 为相对时长（毫秒，0 = 永久），从现在起算；操作者按皇帝口径 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string; emailId: string }> }
) {
  if (!(await isAdminAuthorized(request))) {
    return NextResponse.json({ error: "未授权" }, { status: 401 })
  }

  const { userId, emailId } = await params
  const db = createDb()

  if (await isSpaceTargetForbidden(db, userId)) {
    return NextResponse.json({ error: SPACE_TARGET_FORBIDDEN_ERROR }, { status: 403 })
  }

  try {
    const email = await loadOwnedEmail(db, userId, emailId)
    if (!email) {
      return NextResponse.json({ error: "邮箱不存在" }, { status: 404 })
    }

    const { expiryTime } = (await request.json()) as { expiryTime?: number }
    const result = await computeExpiresAt(
      getRequestContext().env.SITE_CONFIG,
      ROLES.EMPEROR,
      expiryTime
    )
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    await db.update(emails).set({ expiresAt: result.expiresAt }).where(eq(emails.id, emailId))

    return NextResponse.json({ success: true, expiresAt: result.expiresAt.getTime() })
  } catch (error) {
    console.error("Failed to update email expiry in admin space:", error)
    return NextResponse.json({ error: "修改邮箱有效期失败" }, { status: 500 })
  }
}
