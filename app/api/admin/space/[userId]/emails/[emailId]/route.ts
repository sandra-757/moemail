import { NextResponse } from "next/server"
import { createDb } from "@/lib/db"
import { emails, messages, emailShares, messageShares } from "@/lib/schema"
import { eq, inArray } from "drizzle-orm"
import { isAdminAuthorized } from "@/lib/admin-access"
import { loadOwnedEmail, isSpaceTargetForbidden, SPACE_TARGET_FORBIDDEN_ERROR } from "@/lib/admin-space"

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
    await db.delete(emails).where(eq(emails.id, emailId))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to delete email in admin space:", error)
    return NextResponse.json({ error: "删除邮箱失败" }, { status: 500 })
  }
}
