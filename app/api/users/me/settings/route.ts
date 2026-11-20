import { auth } from "@/lib/auth"
import { createDb } from "@/lib/db"
import { users } from "@/lib/schema"
import { eq } from "drizzle-orm"

export const runtime = "edge"

/** 本人设置读取：expiredToTrash 为 null 表示未单独设置（跟随站点默认） */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const db = createDb()
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { expiredToTrash: true },
  })

  return Response.json({ expiredToTrash: user?.expiredToTrash ?? null })
}

/** 本人设置保存：expiredToTrash 必须是布尔值或 null（null = 恢复跟随站点默认） */
export async function PATCH(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { expiredToTrash?: unknown } | null
  const value = body?.expiredToTrash
  if (value !== null && typeof value !== "boolean") {
    return Response.json({ error: "expiredToTrash 必须是布尔值或 null" }, { status: 400 })
  }

  const db = createDb()
  await db
    .update(users)
    .set({ expiredToTrash: value })
    .where(eq(users.id, session.user.id))

  return Response.json({ success: true, expiredToTrash: value })
}
