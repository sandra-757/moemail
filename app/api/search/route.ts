import { NextResponse } from "next/server"
import { createDb } from "@/lib/db"
import { emails, messages } from "@/lib/schema"
import { and, desc, eq, gt, isNull, or } from "drizzle-orm"
import { getUserId } from "@/lib/apiKey"
import { likeColumn, makeSnippet, parseSearchQuery } from "@/lib/search"

export const runtime = "edge"

const MAX_EMAIL_RESULTS = 10
const MAX_MESSAGE_RESULTS = 20
const MIN_QUERY_LENGTH = 2

/**
 * GET /api/search?q=
 * 跨全部邮箱的全局搜索：同时返回匹配的邮箱（按地址）和匹配的邮件
 * （主题 / 发件人 / 收件人 / 正文，最新在前，附正文摘要）。
 * 只搜当前用户未过期、未软删的邮箱；q 少于 2 字符返回 400，
 * 避免单字符 LIKE 全表扫。
 */
export async function GET(request: Request) {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: "未授权" }, { status: 401 })
  }

  const query = parseSearchQuery(new URL(request.url).searchParams.get("q"))
  if (!query || query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json(
      { error: "搜索关键词至少需要 2 个字符" },
      { status: 400 }
    )
  }

  const db = createDb()
  const now = new Date()

  try {
    const matchedEmails = await db.query.emails.findMany({
      where: and(
        eq(emails.userId, userId),
        gt(emails.expiresAt, now),
        isNull(emails.deletedAt),
        likeColumn(emails.address, query)
      ),
      orderBy: (t, { asc }) => [asc(t.address)],
      limit: MAX_EMAIL_RESULTS,
      columns: { id: true, address: true, createdAt: true, expiresAt: true },
    })

    const matchedMessages = await db
      .select({
        id: messages.id,
        emailId: messages.emailId,
        emailAddress: emails.address,
        subject: messages.subject,
        fromAddress: messages.fromAddress,
        toAddress: messages.toAddress,
        content: messages.content,
        type: messages.type,
        receivedAt: messages.receivedAt,
        sentAt: messages.sentAt,
      })
      .from(messages)
      .innerJoin(emails, eq(messages.emailId, emails.id))
      .where(
        and(
          eq(emails.userId, userId),
          gt(emails.expiresAt, now),
          isNull(emails.deletedAt),
          or(
            likeColumn(messages.subject, query),
            likeColumn(messages.fromAddress, query),
            likeColumn(messages.toAddress, query),
            likeColumn(messages.content, query)
          )
        )
      )
      .orderBy(desc(messages.receivedAt))
      .limit(MAX_MESSAGE_RESULTS)

    return NextResponse.json({
      query,
      emails: matchedEmails.map((e) => ({
        id: e.id,
        address: e.address,
        createdAt: e.createdAt.getTime(),
        expiresAt: e.expiresAt.getTime(),
      })),
      messages: matchedMessages
        .filter((m) => m.emailId !== null)
        .map((m) => ({
          id: m.id,
          emailId: m.emailId,
          emailAddress: m.emailAddress,
          subject: m.subject,
          fromAddress: m.fromAddress,
          toAddress: m.toAddress,
          type: m.type === "sent" ? "sent" : "received",
          receivedAt: m.receivedAt?.getTime(),
          sentAt: m.sentAt?.getTime(),
          snippet: makeSnippet(m.content, query),
        })),
    })
  } catch (error) {
    console.error("Failed to run global search:", error)
    return NextResponse.json({ error: "搜索失败" }, { status: 500 })
  }
}
