import { createDb } from "@/lib/db"
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm"
import { NextResponse } from "next/server"
import { emails } from "@/lib/schema"
import { encodeCursor, decodeCursor } from "@/lib/cursor"
import { getUserId } from "@/lib/apiKey"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { resolveEmailLimit } from "@/lib/email-limit"
import {
  likeColumn,
  parseMailboxSort,
  parseSearchQuery,
  type MailboxSort,
} from "@/lib/search"

export const runtime = "edge"

const PAGE_SIZE = 20

/**
 * GET /api/emails?cursor=&q=&sort=
 * - q：按邮箱地址子串搜索（大小写不敏感，%/_ 已转义），空 = 不过滤。
 * - sort：custom（默认，手动拖拽顺序）| created_desc | created_asc
 *   | expires_asc | expires_desc | address_asc | address_desc。
 *   游标与排序模式绑定：换 q 或 sort 后旧游标失效，前端须从头拉取。
 *   搜索 / 非 custom 排序时前端禁用拖拽重排（重排只对 custom 全量列表有意义）。
 */
export async function GET(request: Request) {
  const userId = await getUserId()

  const { searchParams } = new URL(request.url)
  const cursor = searchParams.get('cursor')
  const query = parseSearchQuery(searchParams.get('q'))
  const sort = parseMailboxSort(searchParams.get('sort'))

  const db = createDb()
  const env = getRequestContext().env

  try {
    const baseConditions = and(
      eq(emails.userId, userId!),
      gt(emails.expiresAt, new Date()),
      isNull(emails.deletedAt),
      ...(query ? [likeColumn(emails.address, query)] : [])
    )

    const totalResult = await db.select({ count: sql<number>`count(*)` })
      .from(emails)
      .where(baseConditions)
    const totalCount = Number(totalResult[0].count)

    const conditions = [baseConditions]

    if (cursor) {
      const { timestamp, id, sort: sortVal, key } = decodeCursor(cursor)
      const cursorCondition = buildCursorCondition(sort, timestamp, id, sortVal ?? 0, key)
      if (cursorCondition) conditions.push(cursorCondition)
    }

    const results = await db.query.emails.findMany({
      where: and(...conditions),
      orderBy: (t, { asc, desc }) => {
        switch (sort) {
          case "created_desc":
            return [desc(t.createdAt), desc(t.id)]
          case "created_asc":
            return [asc(t.createdAt), asc(t.id)]
          case "expires_asc":
            return [asc(t.expiresAt), asc(t.id)]
          case "expires_desc":
            return [desc(t.expiresAt), desc(t.id)]
          case "address_asc":
            return [asc(t.address), asc(t.id)]
          case "address_desc":
            return [desc(t.address), desc(t.id)]
          case "custom":
          default:
            return [asc(t.sortOrder), desc(t.createdAt), desc(t.id)]
        }
      },
      limit: PAGE_SIZE + 1
    })

    const hasMore = results.length > PAGE_SIZE
    const last = results[PAGE_SIZE - 1]
    const nextCursor = hasMore ? encodeCursorFor(sort, last) : null
    const emailList = hasMore ? results.slice(0, PAGE_SIZE) : results

    // 与建邮箱同一口径的生效上限：个人上限 → 分组上限 → 皇帝不限 → 全局上限。
    // Infinity（不限）序列化为 null，前端据此显示“不限量”。
    const emailLimit = await resolveEmailLimit(db, env.SITE_CONFIG, userId!)

    return NextResponse.json({
      emails: emailList,
      nextCursor,
      total: totalCount,
      effectiveLimit: Number.isFinite(emailLimit) ? emailLimit : null
    })
  } catch (error) {
    console.error('Failed to fetch user emails:', error)
    return NextResponse.json(
      { error: "Failed to fetch emails" },
      { status: 500 }
    )
  }
}

type EmailRow = typeof emails.$inferSelect

function buildCursorCondition(
  sort: MailboxSort,
  timestamp: number,
  id: string,
  sortVal: number,
  key?: string
) {
  const ts = new Date(timestamp)
  switch (sort) {
    case "created_desc":
      return or(
        lt(emails.createdAt, ts),
        and(eq(emails.createdAt, ts), lt(emails.id, id))
      )
    case "created_asc":
      return or(
        gt(emails.createdAt, ts),
        and(eq(emails.createdAt, ts), gt(emails.id, id))
      )
    case "expires_asc":
      return or(
        gt(emails.expiresAt, ts),
        and(eq(emails.expiresAt, ts), gt(emails.id, id))
      )
    case "expires_desc":
      return or(
        lt(emails.expiresAt, ts),
        and(eq(emails.expiresAt, ts), lt(emails.id, id))
      )
    case "address_asc":
      if (key === undefined) return null
      return or(
        gt(emails.address, key),
        and(eq(emails.address, key), gt(emails.id, id))
      )
    case "address_desc":
      if (key === undefined) return null
      return or(
        lt(emails.address, key),
        and(eq(emails.address, key), lt(emails.id, id))
      )
    case "custom":
    default:
      return or(
        gt(emails.sortOrder, sortVal),
        and(
          eq(emails.sortOrder, sortVal),
          lt(emails.createdAt, ts)
        ),
        and(
          eq(emails.sortOrder, sortVal),
          eq(emails.createdAt, ts),
          lt(emails.id, id)
        )
      )
  }
}

function encodeCursorFor(sort: MailboxSort, row: EmailRow): string {
  switch (sort) {
    case "created_desc":
    case "created_asc":
      return encodeCursor(row.createdAt.getTime(), row.id)
    case "expires_asc":
    case "expires_desc":
      return encodeCursor(row.expiresAt.getTime(), row.id)
    case "address_asc":
    case "address_desc":
      return encodeCursor(0, row.id, undefined, row.address)
    case "custom":
    default:
      return encodeCursor(row.createdAt.getTime(), row.id, row.sortOrder)
  }
}
