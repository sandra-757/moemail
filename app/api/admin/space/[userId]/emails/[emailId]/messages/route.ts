import { NextResponse } from "next/server"
import { createDb } from "@/lib/db"
import { messages } from "@/lib/schema"
import { desc, eq, sql } from "drizzle-orm"
import { isAdminAuthorized } from "@/lib/admin-access"
import { loadOwnedEmail } from "@/lib/admin-space"

export const runtime = "edge"

/** 管理员查看某用户邮箱的消息列表（按接收时间倒序，分页） */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string; emailId: string }> }
) {
  if (!(await isAdminAuthorized(request))) {
    return NextResponse.json({ error: "未授权" }, { status: 401 })
  }

  const { userId, emailId } = await params
  const db = createDb()

  try {
    const email = await loadOwnedEmail(db, userId, emailId)
    if (!email) {
      return NextResponse.json({ error: "邮箱不存在" }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, Number(searchParams.get("page") || "1"))
    const pageSize = Math.min(50, Math.max(1, Number(searchParams.get("pageSize") || "20")))

    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.emailId, emailId))
    const total = Number(totalResult[0].count)

    const rows = await db
      .select({
        id: messages.id,
        subject: messages.subject,
        fromAddress: messages.fromAddress,
        toAddress: messages.toAddress,
        receivedAt: messages.receivedAt,
        type: messages.type,
      })
      .from(messages)
      .where(eq(messages.emailId, emailId))
      .orderBy(desc(messages.receivedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    return NextResponse.json({
      messages: rows,
      total,
      page,
      pageSize,
    })
  } catch (error) {
    console.error("Failed to list messages in admin space:", error)
    return NextResponse.json({ error: "获取消息列表失败" }, { status: 500 })
  }
}
