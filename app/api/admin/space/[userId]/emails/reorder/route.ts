import { NextResponse } from "next/server"
import { createDb } from "@/lib/db"
import { emails } from "@/lib/schema"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { isAdminAuthorized } from "@/lib/admin-access"
import { isSpaceTargetForbidden, SPACE_TARGET_FORBIDDEN_ERROR } from "@/lib/admin-space"

export const runtime = "edge"

/** 管理员保存某用户邮箱的手动排序：ids 为目标顺序，依次写入 sortOrder = 1..N */
export async function PUT(
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

  let ids: unknown
  try {
    ids = ((await request.json()) as { ids?: unknown })?.ids
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400 })
  }
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    !ids.every((item) => typeof item === "string")
  ) {
    return NextResponse.json({ error: "请求无效" }, { status: 400 })
  }

  const uniqueIds = [...new Set(ids as string[])]

  try {
    const owned = await db.query.emails.findMany({
      where: and(eq(emails.userId, userId), inArray(emails.id, uniqueIds), isNull(emails.deletedAt)),
      columns: { id: true },
    })
    if (owned.length !== uniqueIds.length) {
      return NextResponse.json(
        { error: "包含不存在或不属于该用户的邮箱" },
        { status: 400 }
      )
    }

    for (const [index, id] of uniqueIds.entries()) {
      await db
        .update(emails)
        .set({ sortOrder: index + 1 })
        .where(eq(emails.id, id))
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to reorder space emails:", error)
    return NextResponse.json({ error: "保存排序失败" }, { status: 500 })
  }
}
