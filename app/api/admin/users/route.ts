import { createDb } from "@/lib/db"
import { users } from "@/lib/schema"
import { eq } from "drizzle-orm"
import { checkPermission, register, assignRoleToUser } from "@/lib/auth"
import { PERMISSIONS, ROLES } from "@/lib/permissions"
import { authSchema } from "@/lib/validation"
import { findOrCreateRoleByName, isAssignableRole } from "@/lib/admin-users"
import { isValidUserEmailLimit, ROLE_LIMIT_MIN, ROLE_LIMIT_MAX } from "@/lib/email-limit"

export const runtime = "edge"

interface CreateUserBody {
  username?: unknown
  password?: unknown
  role?: unknown
  emailLimit?: unknown
}

/** 管理员新建用户（皇帝，PROMOTE_USER）：可指定角色（非皇帝）与个人邮箱上限 */
export async function POST(request: Request) {
  const canManage = await checkPermission(PERMISSIONS.PROMOTE_USER)
  if (!canManage) {
    return Response.json({ error: "权限不足" }, { status: 403 })
  }

  try {
    const body = (await request.json()) as CreateUserBody

    const parsed = authSchema.safeParse({
      username: body.username,
      password: body.password,
    })
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || "输入格式不正确" },
        { status: 400 }
      )
    }

    const roleName = body.role === undefined ? ROLES.CIVILIAN : body.role
    if (!isAssignableRole(roleName)) {
      return Response.json({ error: "角色不合法（只能创建公爵/骑士/平民）" }, { status: 400 })
    }

    if (body.emailLimit !== undefined && !isValidUserEmailLimit(body.emailLimit)) {
      return Response.json(
        { error: `邮箱上限必须是 ${ROLE_LIMIT_MIN}–${ROLE_LIMIT_MAX} 的整数或不设置` },
        { status: 400 }
      )
    }
    // 平民没有邮箱权限，不支持个人上限
    const emailLimit = roleName === ROLES.CIVILIAN ? null : ((body.emailLimit ?? null) as number | null)

    let user: typeof users.$inferSelect
    try {
      user = await register(parsed.data.username, parsed.data.password)
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "创建用户失败" },
        { status: 400 }
      )
    }

    const db = createDb()
    const role = await findOrCreateRoleByName(db, roleName)
    await assignRoleToUser(db, user.id, role.id)

    if (emailLimit !== null) {
      await db.update(users).set({ emailLimit }).where(eq(users.id, user.id))
    }

    return Response.json({
      user: {
        id: user.id,
        username: user.username,
        role: roleName,
        emailLimit,
      },
    })
  } catch (error) {
    console.error("Failed to create user:", error)
    return Response.json({ error: "创建用户失败" }, { status: 500 })
  }
}
