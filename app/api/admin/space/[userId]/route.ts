import { NextResponse } from "next/server"
import { nanoid } from "nanoid"
import { createDb } from "@/lib/db"
import { emails, messages } from "@/lib/schema"
import { eq, sql } from "drizzle-orm"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { EXPIRY_OPTIONS } from "@/types/email"
import { ROLES } from "@/lib/permissions"
import { parseConfigBool, SITE_CONFIG_DEFAULTS } from "@/lib/site-config"
import { isAdminAuthorized } from "@/lib/admin-access"
import { loadSpaceUser, isSpaceTargetForbidden, SPACE_TARGET_FORBIDDEN_ERROR } from "@/lib/admin-space"
import { resolveEmailLimit, countActiveEmails, getUserRoleName } from "@/lib/email-limit"

export const runtime = "edge"

/** 管理员查看某用户的邮箱空间：用户信息 + 全部邮箱（含消息数） */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  if (!(await isAdminAuthorized(request))) {
    return NextResponse.json({ error: "未授权" }, { status: 401 })
  }

  const { userId } = await params
  const db = createDb()

  if (await isSpaceTargetForbidden(db, userId)) {
    return NextResponse.json({ error: SPACE_TARGET_FORBIDDEN_ERROR }, { status: 403 })
  }

  try {
    const user = await loadSpaceUser(db, userId)
    if (!user) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 })
    }

    const role = await getUserRoleName(db, userId)
    const limit = await resolveEmailLimit(db, getRequestContext().env.SITE_CONFIG, userId)

    const emailRows = await db
      .select({
        id: emails.id,
        address: emails.address,
        createdAt: emails.createdAt,
        expiresAt: emails.expiresAt,
      })
      .from(emails)
      .where(eq(emails.userId, userId))
      .orderBy(sql`${emails.createdAt} DESC`)

    // 消息数单独分组统计（相关子查询在 D1 上结果不可靠）
    const countRows = await db
      .select({ emailId: messages.emailId, count: sql<number>`count(*)` })
      .from(messages)
      .innerJoin(emails, eq(messages.emailId, emails.id))
      .where(eq(emails.userId, userId))
      .groupBy(messages.emailId)
    const countByEmailId = new Map(countRows.map((r) => [r.emailId, Number(r.count)]))

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role,
        emailLimit: user.emailLimit ?? null,
        effectiveLimit: Number.isFinite(limit) ? limit : null,
      },
      emails: emailRows.map((row) => ({
        id: row.id,
        address: row.address,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        messageCount: countByEmailId.get(row.id) ?? 0,
      })),
    })
  } catch (error) {
    console.error("Failed to load admin space:", error)
    return NextResponse.json({ error: "获取邮箱空间失败" }, { status: 500 })
  }
}

interface CreateEmailBody {
  name?: string
  domain?: string
  expiryTime?: number
}

/** 管理员为某用户新建邮箱：校验口径与 /api/emails/generate 一致，并按目标用户的上限限额 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  if (!(await isAdminAuthorized(request))) {
    return NextResponse.json({ error: "未授权" }, { status: 401 })
  }

  const { userId } = await params
  const db = createDb()

  if (await isSpaceTargetForbidden(db, userId)) {
    return NextResponse.json({ error: SPACE_TARGET_FORBIDDEN_ERROR }, { status: 403 })
  }
  const env = getRequestContext().env

  try {
    const user = await loadSpaceUser(db, userId)
    if (!user) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 })
    }

    const { name, domain, expiryTime } = (await request.json()) as CreateEmailBody

    if (expiryTime === undefined || !EXPIRY_OPTIONS.some((option) => option.value === expiryTime)) {
      return NextResponse.json({ error: "无效的过期时间" }, { status: 400 })
    }

    // 永久邮箱开关按目标用户的角色判定（与 generate 路由对请求者的判定同口径）
    if (expiryTime === 0) {
      const targetRole = await getUserRoleName(db, userId)
      if (targetRole !== ROLES.EMPEROR) {
        const allowPermanentEmail = parseConfigBool(
          await env.SITE_CONFIG.get("ALLOW_PERMANENT_EMAIL"),
          SITE_CONFIG_DEFAULTS.ALLOW_PERMANENT_EMAIL
        )
        if (!allowPermanentEmail) {
          return NextResponse.json({ error: "当前不允许创建永久邮箱" }, { status: 403 })
        }
      }
    }

    const domainString = await env.SITE_CONFIG.get("EMAIL_DOMAINS")
    const domains = domainString ? domainString.split(",") : ["moemail.app"]
    if (!domain || !domains.includes(domain)) {
      return NextResponse.json({ error: "无效的域名" }, { status: 400 })
    }

    const limit = await resolveEmailLimit(db, env.SITE_CONFIG, userId)
    if (Number.isFinite(limit)) {
      const activeCount = await countActiveEmails(db, userId)
      if (activeCount >= limit) {
        return NextResponse.json(
          { error: `已达到该用户的邮箱数量上限 (${limit})`, limit },
          { status: 403 }
        )
      }
    }

    const address = `${name || nanoid(8)}@${domain}`
    const existingEmail = await db.query.emails.findFirst({
      where: eq(sql`LOWER(${emails.address})`, address.toLowerCase()),
    })
    if (existingEmail) {
      return NextResponse.json({ error: "该邮箱地址已被使用" }, { status: 409 })
    }

    const now = new Date()
    const expires = expiryTime === 0
      ? new Date("9999-01-01T00:00:00.000Z")
      : new Date(now.getTime() + expiryTime)

    const result = await db
      .insert(emails)
      .values({
        address,
        createdAt: now,
        expiresAt: expires,
        userId,
      })
      .returning({ id: emails.id, address: emails.address })

    return NextResponse.json({
      id: result[0].id,
      email: result[0].address,
    })
  } catch (error) {
    console.error("Failed to create email in admin space:", error)
    return NextResponse.json({ error: "创建邮箱失败" }, { status: 500 })
  }
}
