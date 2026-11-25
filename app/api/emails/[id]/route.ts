import { NextResponse } from "next/server"
import { createDb } from "@/lib/db"
import { emails, messages } from "@/lib/schema"
import { eq, and, gt, lt, or, sql, ne, isNull } from "drizzle-orm"
import { encodeCursor, decodeCursor } from "@/lib/cursor"
import { likeColumn, parseMessageSort, parseSearchQuery } from "@/lib/search"
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

/**
 * GET /api/emails/[id]?cursor=&type=&q=&sort=
 * - q：在本邮箱内按主题 / 发件人 / 收件人 / 正文子串搜索（大小写不敏感）。
 * - sort：date_desc（默认，最新在前）| date_asc | subject_asc | subject_desc
 *   | from_asc | from_desc（已发送按收件人排，未发送按发件人排）。
 *   游标与排序模式绑定，换 q / sort / type 后旧游标失效，前端须从头拉取。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { searchParams } = new URL(request.url)
  const cursorStr = searchParams.get('cursor')
  const messageType = searchParams.get('type')
  const query = parseSearchQuery(searchParams.get('q'))
  const sort = parseMessageSort(searchParams.get('sort'))

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

    const typeCondition = messageType === 'sent'
      ? eq(messages.type, "sent")
      : or(
          ne(messages.type, "sent"),
          isNull(messages.type)
        )
    // 发件人排序列：已发送按收件人、收件按发件人（与列表展示的地址一致）
    const fromColumn = messageType === 'sent' ? messages.toAddress : messages.fromAddress
    const orderByTime = messageType === 'sent' ? messages.sentAt : messages.receivedAt

    const baseConditions = and(
      eq(messages.emailId, id),
      typeCondition,
      ...(query
        ? [or(
            likeColumn(messages.subject, query),
            likeColumn(messages.fromAddress, query),
            likeColumn(messages.toAddress, query),
            likeColumn(messages.content, query)
          )]
        : [])
    )

    const totalResult = await db.select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(baseConditions)
    const totalCount = Number(totalResult[0].count)

    const conditions = [baseConditions]

    if (cursorStr) {
      const { timestamp, id: cursorId, key } = decodeCursor(cursorStr)
      const ts = new Date(timestamp)
      if (sort === "date_asc") {
        conditions.push(
          or(
            gt(orderByTime, ts),
            and(eq(orderByTime, ts), gt(messages.id, cursorId))
          )
        )
      } else if (sort === "subject_asc" || sort === "from_asc") {
        const col = sort === "subject_asc" ? messages.subject : fromColumn
        if (key !== undefined) {
          conditions.push(
            or(
              gt(col, key),
              and(eq(col, key), gt(messages.id, cursorId))
            )
          )
        }
      } else if (sort === "subject_desc" || sort === "from_desc") {
        const col = sort === "subject_desc" ? messages.subject : fromColumn
        if (key !== undefined) {
          conditions.push(
            or(
              lt(col, key),
              and(eq(col, key), lt(messages.id, cursorId))
            )
          )
        }
      } else {
        conditions.push(
          or(
            lt(orderByTime, ts),
            and(
              eq(orderByTime, ts),
              lt(messages.id, cursorId)
            )
          )
        )
      }
    }

    const results = await db.query.messages.findMany({
      where: and(...conditions),
      orderBy: (t, { asc, desc }) => {
        switch (sort) {
          case "date_asc":
            return [asc(orderByTime), asc(t.id)]
          case "subject_asc":
            return [asc(t.subject), asc(t.id)]
          case "subject_desc":
            return [desc(t.subject), desc(t.id)]
          case "from_asc":
            return [asc(fromColumn), asc(t.id)]
          case "from_desc":
            return [desc(fromColumn), desc(t.id)]
          case "date_desc":
          default:
            return [desc(orderByTime), desc(t.id)]
        }
      },
      limit: PAGE_SIZE + 1
    })

    const hasMore = results.length > PAGE_SIZE
    const lastRow = results[PAGE_SIZE - 1]
    const nextCursor = hasMore
      ? sort === "subject_asc" || sort === "subject_desc"
        ? encodeCursor(0, lastRow.id, undefined, lastRow.subject)
        : sort === "from_asc" || sort === "from_desc"
          ? encodeCursor(0, lastRow.id, undefined, messageType === 'sent' ? (lastRow.toAddress ?? "") : (lastRow.fromAddress ?? ""))
          : encodeCursor(
              messageType === 'sent'
                ? lastRow.sentAt!.getTime()
                : lastRow.receivedAt.getTime(),
              lastRow.id
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