import { NextResponse } from "next/server"
import { nanoid } from "nanoid"
import { createDb } from "@/lib/db"
import { emails } from "@/lib/schema"
import { eq, sql } from "drizzle-orm"
import { EXPIRY_OPTIONS } from "@/types/email"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { getUserId } from "@/lib/apiKey"
import { getUserRole } from "@/lib/auth"
import { ROLES } from "@/lib/permissions"
import { parseConfigBool, SITE_CONFIG_DEFAULTS } from "@/lib/site-config"
import { resolveEmailLimit, countActiveEmails } from "@/lib/email-limit"
import { nextSortOrder } from "@/lib/email-expiry"

export const runtime = "edge"

export async function POST(request: Request) {
  const db = createDb()
  const env = getRequestContext().env

  const userId = await getUserId()
  const userRole = await getUserRole(userId!)

  try {
    if (userRole !== ROLES.EMPEROR) {
      const maintenanceMode = parseConfigBool(
        await env.SITE_CONFIG.get("MAINTENANCE_MODE"),
        SITE_CONFIG_DEFAULTS.MAINTENANCE_MODE
      )
      if (maintenanceMode) {
        const maintenanceMessage = await env.SITE_CONFIG.get("MAINTENANCE_MESSAGE")
        return NextResponse.json(
          { error: maintenanceMessage?.trim() || "系统维护中，请稍后再试" },
          { status: 503 }
        )
      }
    }

    // 邮箱上限统一解析：个人上限 → 分组上限 → 皇帝不限 → 全局上限
    // （皇帝在设了个人/分组上限时同样受限）
    const emailLimit = await resolveEmailLimit(db, env.SITE_CONFIG, userId!)
    if (Number.isFinite(emailLimit)) {
      const activeEmailsCount = await countActiveEmails(db, userId!)
      if (activeEmailsCount >= emailLimit) {
        return NextResponse.json(
          { error: `已达到最大邮箱数量限制 (${emailLimit})` },
          { status: 403 }
        )
      }
    }

    const { name, expiryTime, domain } = await request.json<{ 
      name: string
      expiryTime: number
      domain: string
    }>()

    if (!EXPIRY_OPTIONS.some(option => option.value === expiryTime)) {
      return NextResponse.json(
        { error: "无效的过期时间" },
        { status: 400 }
      )
    }

    if (expiryTime === 0 && userRole !== ROLES.EMPEROR) {
      const allowPermanentEmail = parseConfigBool(
        await env.SITE_CONFIG.get("ALLOW_PERMANENT_EMAIL"),
        SITE_CONFIG_DEFAULTS.ALLOW_PERMANENT_EMAIL
      )
      if (!allowPermanentEmail) {
        return NextResponse.json(
          { error: "当前不允许创建永久邮箱" },
          { status: 403 }
        )
      }
    }

    const domainString = await env.SITE_CONFIG.get("EMAIL_DOMAINS")
    const domains = domainString ? domainString.split(',') : ["moemail.app"]

    if (!domains || !domains.includes(domain)) {
      return NextResponse.json(
        { error: "无效的域名" },
        { status: 400 }
      )
    }

    const address = `${name || nanoid(8)}@${domain}`
    const existingEmail = await db.query.emails.findFirst({
      where: eq(sql`LOWER(${emails.address})`, address.toLowerCase())
    })

    if (existingEmail) {
      return NextResponse.json(
        { error: "该邮箱地址已被使用" },
        { status: 409 }
      )
    }

    const now = new Date()
    const expires = expiryTime === 0 
      ? new Date('9999-01-01T00:00:00.000Z')
      : new Date(now.getTime() + expiryTime)

    const minRows = await db
      .select({ min: sql<number | null>`min(${emails.sortOrder})` })
      .from(emails)
      .where(eq(emails.userId, userId!))
    const sortOrder = nextSortOrder(minRows[0]?.min)
    
    const emailData: typeof emails.$inferInsert = {
      address,
      createdAt: now,
      expiresAt: expires,
      sortOrder,
      userId: userId!
    }
    
    const result = await db.insert(emails)
      .values(emailData)
      .returning({ id: emails.id, address: emails.address })
    
    return NextResponse.json({ 
      id: result[0].id,
      email: result[0].address 
    })
  } catch (error) {
    console.error('Failed to generate email:', error)
    return NextResponse.json(
      { error: "创建邮箱失败" },
      { status: 500 }
    )
  }
} 