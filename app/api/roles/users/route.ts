import { createDb } from "@/lib/db"
import { users, userRoles, roles, emails } from "@/lib/schema"
import { and, eq, gt, inArray, like, or, sql } from "drizzle-orm"
import { checkPermission } from "@/lib/auth"
import { PERMISSIONS, ROLES } from "@/lib/permissions"

export const runtime = "edge"

export async function GET(request: Request) {
  const canPromote = await checkPermission(PERMISSIONS.PROMOTE_USER)
  if (!canPromote) {
    return Response.json({ error: "权限不足" }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, Number(searchParams.get("page") || "1"))
  const pageSize = Math.min(50, Math.max(1, Number(searchParams.get("pageSize") || "20")))
  const search = searchParams.get("search")?.trim()

  const db = createDb()

  try {
    const searchCondition = search
      ? or(
          like(users.username, `%${search}%`),
          like(users.email, `%${search}%`),
          like(users.name, `%${search}%`)
        )
      : undefined

    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(searchCondition)
    const total = Number(totalResult[0].count)

    const roleRank = sql`CASE COALESCE(${roles.name}, ${ROLES.CIVILIAN})
      WHEN ${ROLES.EMPEROR} THEN 0
      WHEN ${ROLES.DUKE} THEN 1
      WHEN ${ROLES.KNIGHT} THEN 2
      WHEN ${ROLES.CIVILIAN} THEN 3
      ELSE 4
    END`

    const userList = await db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
        email: users.email,
        image: users.image,
        emailLimit: users.emailLimit,
        role: roles.name,
      })
      .from(users)
      .leftJoin(userRoles, eq(userRoles.userId, users.id))
      .leftJoin(roles, eq(roles.id, userRoles.roleId))
      .where(searchCondition)
      .orderBy(roleRank, sql`LENGTH(COALESCE(${users.username}, ${users.name}))`, sql`LOWER(COALESCE(${users.username}, ${users.name}))`)
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    // 当前页用户的未过期邮箱数（一次分组统计，避免逐用户查询）
    const pageUserIds = userList.map((u) => u.id)
    const activeCounts = new Map<string, number>()
    if (pageUserIds.length > 0) {
      const countRows = await db
        .select({
          userId: emails.userId,
          count: sql<number>`count(*)`,
        })
        .from(emails)
        .where(
          and(
            inArray(emails.userId, pageUserIds),
            gt(emails.expiresAt, new Date())
          )
        )
        .groupBy(emails.userId)
      for (const row of countRows) {
        if (row.userId) activeCounts.set(row.userId, Number(row.count))
      }
    }

    return Response.json({
      users: userList.map((u) => ({
        id: u.id,
        name: u.name,
        username: u.username,
        email: u.email,
        image: u.image,
        role: u.role || null,
        emailLimit: u.emailLimit ?? null,
        activeEmailCount: activeCounts.get(u.id) ?? 0,
      })),
      total,
      page,
      pageSize,
    })
  } catch (error) {
    console.error("Failed to list users:", error)
    return Response.json({ error: "获取用户列表失败" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const canPromote = await checkPermission(PERMISSIONS.PROMOTE_USER)
  if (!canPromote) {
    return Response.json({ error: "权限不足" }, { status: 403 })
  }

  try {
    const json = await request.json()
    const { searchText } = json as { searchText: string }

    if (!searchText) {
      return Response.json({ error: "请提供用户名或邮箱地址" }, { status: 400 })
    }

    const db = createDb()

    const user = await db.query.users.findFirst({
      where: searchText.includes('@') ? eq(users.email, searchText) : eq(users.username, searchText),
      with: {
        userRoles: {
          with: {
            role: true
          }
        }
      }
    });

    if (!user) {
      return Response.json({ error: "未找到用户" }, { status: 404 })
    }

    return Response.json({
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.userRoles[0]?.role.name
      }
    })
  } catch (error) {
    console.error("Failed to find user:", error)
    return Response.json(
      { error: "查询用户失败" },
      { status: 500 }
    )
  }
}
