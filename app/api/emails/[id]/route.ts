import { NextResponse } from "next/server"
import { createDb } from "@/lib/db"
import { emails, messages } from "@/lib/schema"
import { eq, and, lt, or, sql, ne, isNull } from "drizzle-orm"
import { encodeCursor, decodeCursor } from "@/lib/cursor"
import { getUserId } from "@/lib/apiKey"
import { checkBasicSendPermission } from "@/lib/send-permissions"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { getUserRoleName } from "@/lib/email-limit"
import { computeExpiresAt } from "@/lib/email-expiry"
import { detachMessagesToOrphans, isKeepMailsOnDeleteEnabled, isMailboxTrashEnabled, moveMailboxToTrash, purgeMailbox } from "@/lib/orphan-mail"

export const runtime = "edge"

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId()

  try {
    const db = createDb()
    const { id } = await params
    const email = await db.query.emails.findFirst({
      where: and(
        eq(emails.id, id),
        eq(emails.userId, userId!),
        isNull(emails.deletedAt)
      )
    })

    if (!email) {
      return NextResponse.json(
        { error: "邮箱不存在或无权限删除" },
        { status: 403 }
      )
    }
    const kv = getRequestContext().env.SITE_CONFIG
    // 站点开关 MAILBOX_TRASH_ENABLED 开启时，本人删除可二选一：
    // 默认（未传参或 toTrash=true）软删进回收站；toTrash=false 为本人明确彻底删除——
    // 不清孤儿、不走 KEEP 分支，邮箱与邮件一并硬删（shares 仍先清干净）
    if (await isMailboxTrashEnabled(kv)) {
      const toTrash = new URL(request.url).searchParams.get("toTrash") !== "false"
      if (toTrash) {
        await moveMailboxToTrash(db, email)
      } else {
        await purgeMailbox(db, email.id)
      }
      return NextResponse.json({ success: true })
    }
    // 站点开关 KEEP_MAILS_ON_DELETE 开启时：删邮箱保留邮件（转孤儿，日后同地址重建可认领）
    const keepMails = await isKeepMailsOnDeleteEnabled(kv)
    if (keepMails) {
      await detachMessagesToOrphans(db, email)
    } else {
      await db.delete(messages)
        .where(eq(messages.emailId, id))
    }

    await db.delete(emails)
      .where(eq(emails.id, id))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete email:', error)
    return NextResponse.json(
      { error: "删除邮箱失败" },
      { status: 500 }
    )
  }
} 

/** 修改自己邮箱的有效期：expiryTime 为相对时长（毫秒，0 = 永久），从现在起算 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId()

  try {
    const db = createDb()
    const { id } = await params
    const email = await db.query.emails.findFirst({
      where: and(
        eq(emails.id, id),
        eq(emails.userId, userId!),
        isNull(emails.deletedAt)
      )
    })

    if (!email) {
      return NextResponse.json(
        { error: "邮箱不存在或无权限修改" },
        { status: 403 }
      )
    }

    const { expiryTime } = (await request.json()) as { expiryTime?: number }
    const role = await getUserRoleName(db, userId!)
    const result = await computeExpiresAt(
      getRequestContext().env.SITE_CONFIG,
      role,
      expiryTime
    )
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    await db.update(emails)
      .set({ expiresAt: result.expiresAt })
      .where(eq(emails.id, id))

    return NextResponse.json({ success: true, expiresAt: result.expiresAt.getTime() })
  } catch (error) {
    console.error('Failed to update email expiry:', error)
    return NextResponse.json(
      { error: "修改邮箱有效期失败" },
      { status: 500 }
    )
  }
}

const PAGE_SIZE = 20

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { searchParams } = new URL(request.url)
  const cursorStr = searchParams.get('cursor')
  const messageType = searchParams.get('type')

  try {
    const db = createDb()
    const { id } = await params

    const userId = await getUserId()
    if (messageType === 'sent') {
      const permissionResult = await checkBasicSendPermission(userId!)
      if (!permissionResult.canSend) {
        return NextResponse.json(
          { error: permissionResult.error || "您没有查看发送邮件的权限" },
          { status: 403 }
        )
      }
    }

    const email = await db.query.emails.findFirst({
      where: and(
        eq(emails.id, id),
        eq(emails.userId, userId!),
        isNull(emails.deletedAt)
      )
    })

    if (!email) {
      return NextResponse.json(
        { error: "无权限查看" },
        { status: 403 }
      )
    }

    const baseConditions = and(
      eq(messages.emailId, id),
      messageType === 'sent' 
        ? eq(messages.type, "sent") 
        : or(
            ne(messages.type, "sent"),
            isNull(messages.type)
          )
    )

    const totalResult = await db.select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(baseConditions)
    const totalCount = Number(totalResult[0].count)

    const conditions = [baseConditions]

    if (cursorStr) {
      const { timestamp, id } = decodeCursor(cursorStr)
      const orderByTime = messageType === 'sent' ? messages.sentAt : messages.receivedAt
      conditions.push(
        or(
          lt(orderByTime, new Date(timestamp)),
          and(
            eq(orderByTime, new Date(timestamp)),
            lt(messages.id, id)
          )
        )
      )
    }

    const orderByTime = messageType === 'sent' ? messages.sentAt : messages.receivedAt
    
    const results = await db.query.messages.findMany({
      where: and(...conditions),
      orderBy: (messages, { desc }) => [
        desc(orderByTime),
        desc(messages.id)
      ],
      limit: PAGE_SIZE + 1
    })
    
    const hasMore = results.length > PAGE_SIZE
    const nextCursor = hasMore 
      ? encodeCursor(
          messageType === 'sent' 
            ? results[PAGE_SIZE - 1].sentAt!.getTime()
            : results[PAGE_SIZE - 1].receivedAt.getTime(),
          results[PAGE_SIZE - 1].id
        )
      : null
    const messageList = hasMore ? results.slice(0, PAGE_SIZE) : results

    return NextResponse.json({ 
      messages: messageList.map(msg => ({
        id: msg.id,
        from_address: msg?.fromAddress,
        to_address: msg?.toAddress,
        subject: msg.subject,
        content: msg.content,
        html: msg.html,
        sent_at: msg.sentAt?.getTime(),
        received_at: msg.receivedAt?.getTime()
      })),
      nextCursor,
      total: totalCount
    })
  } catch (error) {
    console.error('Failed to fetch messages:', error)
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    )
  }
} 