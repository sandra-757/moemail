import { and, eq, isNotNull } from "drizzle-orm"
import { PERMISSIONS } from "@/lib/permissions"
import { checkPermission } from "@/lib/auth"
import { createDb } from "@/lib/db"
import { emails } from "@/lib/schema"

export const runtime = "edge"

/** 管理员恢复回收站中的邮箱：清 deleted_at，有效期原样保留（哪怕已过期） */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ emailId: string }> }
) {
  const canAccess = await checkPermission(PERMISSIONS.MANAGE_CONFIG)
  if (!canAccess) {
    return Response.json({ error: "权限不足" }, { status: 403 })
  }

  const { emailId } = await params
  const db = createDb()

  const email = await db.query.emails.findFirst({
    where: and(eq(emails.id, emailId), isNotNull(emails.deletedAt)),
  })
  if (!email) {
    return Response.json({ error: "回收站中不存在该邮箱" }, { status: 404 })
  }

  await db
    .update(emails)
    .set({ deletedAt: null })
    .where(eq(emails.id, emailId))

  return Response.json({ success: true })
}
