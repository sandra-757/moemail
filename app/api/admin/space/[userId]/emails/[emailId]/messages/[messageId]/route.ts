import { NextResponse } from "next/server"
import { createDb } from "@/lib/db"
import { messages, messageShares } from "@/lib/schema"
import { eq } from "drizzle-orm"
import { isAdminAuthorized } from "@/lib/admin-access"
import { loadOwnedEmail, loadOwnedMessage, isSpaceTargetForbidden, SPACE_TARGET_FORBIDDEN_ERROR } from "@/lib/admin-space"

export const runtime = "edge"

/** 管理员查看某条消息全文（归属链：userId → emailId → messageId，任一不符 404） */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string; emailId: string; messageId: string }> }
) {
  if (!(await isAdminAuthorized(request))) {
    return NextResponse.json({ error: "未授权" }, { status: 401 })
  }

  const { userId, emailId, messageId } = await params
  const db = createDb()

  if (await isSpaceTargetForbidden(db, userId)) {
    return NextResponse.json({ error: SPACE_TARGET_FORBIDDEN_ERROR }, { status: 403 })
  }

  try {
    const email = await loadOwnedEmail(db, userId, emailId)
    if (!email) {
      return NextResponse.json({ error: "邮箱不存在" }, { status: 404 })
    }

    const message = await loadOwnedMessage(db, emailId, messageId)
    if (!message) {
      return NextResponse.json({ error: "消息不存在" }, { status: 404 })
    }

    return NextResponse.json({
      message: {
        id: message.id,
        emailId: message.emailId,
        subject: message.subject,
        content: message.content,
        html: message.html,
        fromAddress: message.fromAddress,
        toAddress: message.toAddress,
        type: message.type,
        receivedAt: message.receivedAt,
        sentAt: message.sentAt,
      },
    })
  } catch (error) {
    console.error("Failed to load message in admin space:", error)
    return NextResponse.json({ error: "获取消息失败" }, { status: 500 })
  }
}

/** 管理员删除某条消息（先清其分享记录，再删消息） */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string; emailId: string; messageId: string }> }
) {
  if (!(await isAdminAuthorized(request))) {
    return NextResponse.json({ error: "未授权" }, { status: 401 })
  }

  const { userId, emailId, messageId } = await params
  const db = createDb()

  if (await isSpaceTargetForbidden(db, userId)) {
    return NextResponse.json({ error: SPACE_TARGET_FORBIDDEN_ERROR }, { status: 403 })
  }

  try {
    const email = await loadOwnedEmail(db, userId, emailId)
    if (!email) {
      return NextResponse.json({ error: "邮箱不存在" }, { status: 404 })
    }

    const message = await loadOwnedMessage(db, emailId, messageId)
    if (!message) {
      return NextResponse.json({ error: "消息不存在" }, { status: 404 })
    }

    await db.delete(messageShares).where(eq(messageShares.messageId, messageId))
    await db.delete(messages).where(eq(messages.id, messageId))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to delete message in admin space:", error)
    return NextResponse.json({ error: "删除消息失败" }, { status: 500 })
  }
}
