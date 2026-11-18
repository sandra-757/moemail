import { createDb } from "@/lib/db"
import { users } from "@/lib/schema"
import { eq } from "drizzle-orm"
import { checkPermission, assignRoleToUser } from "@/lib/auth"
import { getUserId } from "@/lib/apiKey"
import { PERMISSIONS, ROLES, type Role } from "@/lib/permissions"
import { authSchema } from "@/lib/validation"
import { hashPassword } from "@/lib/utils"
import { findOrCreateRoleByName, isAssignableRole } from "@/lib/admin-users"
import { getUserRoleName, isValidUserEmailLimit, ROLE_LIMIT_MIN, ROLE_LIMIT_MAX } from "@/lib/email-limit"

export const runtime = "edge"

interface UpdateUserBody {
  username?: unknown
  password?: unknown
  role?: unknown
  emailLimit?: unknown
}

/** 管理员编辑用户（皇帝，PROMOTE_USER）：用户名/密码/角色/个人邮箱上限；皇帝不可被修改 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const canManage = await checkPermission(PERMISSIONS.PROMOTE_USER)
  if (!canManage) {
    return Response.json({ error: "权限不足" }, { status: 403 })
  }

  try {
    const { id } = await params
    const db = createDb()

    const target = await db.query.users.findFirst({
      where: eq(users.id, id),
    })
    if (!target) {
      return Response.json({ error: "用户不存在" }, { status: 404 })
    }

    const targetRole = await getUserRoleName(db, id)
    if (targetRole === ROLES.EMPEROR) {
      return Response.json({ error: "不能修改皇帝" }, { status: 400 })
    }

    const body = (await request.json()) as UpdateUserBody
    const updates: Partial<Pick<typeof users.$inferInsert, "username" | "password" | "emailLimit">> = {}

    if (body.username !== undefined) {
      const parsedUsername = authSchema.shape.username.safeParse(body.username)
      if (!parsedUsername.success) {
        return Response.json(
          { error: parsedUsername.error.issues[0]?.message || "用户名格式不正确" },
          { status: 400 }
        )
      }
      if (parsedUsername.data !== target.username) {
        const existing = await db.query.users.findFirst({
          where: eq(users.username, parsedUsername.data),
        })
        if (existing) {
          return Response.json({ error: "用户名已存在" }, { status: 409 })
        }
        updates.username = parsedUsername.data
      }
    }

    if (body.password !== undefined && body.password !== "") {
      const parsedPassword = authSchema.shape.password.safeParse(body.password)
      if (!parsedPassword.success) {
        return Response.json(
          { error: parsedPassword.error.issues[0]?.message || "密码格式不正确" },
          { status: 400 }
        )
      }
      updates.password = await hashPassword(parsedPassword.data)
    }

    let newRole: Role | undefined
    if (body.role !== undefined) {
      if (!isAssignableRole(body.role)) {
        return Response.json({ error: "角色不合法（只能设为公爵/骑士/平民）" }, { status: 400 })
      }
      const currentUserId = await getUserId()
      if (id === currentUserId) {
        return Response.json({ error: "不能修改自己的角色" }, { status: 400 })
      }
      newRole = body.role
    }

    // 平民没有邮箱权限，不支持个人上限：最终角色为平民时强制清空（降级时一并清掉存量值）
    const finalRole = newRole ?? targetRole
    if (finalRole === ROLES.CIVILIAN) {
      updates.emailLimit = null
    } else if (body.emailLimit !== undefined) {
      if (!isValidUserEmailLimit(body.emailLimit)) {
        return Response.json(
          { error: `邮箱上限必须是 ${ROLE_LIMIT_MIN}–${ROLE_LIMIT_MAX} 的整数或 null（清除）` },
          { status: 400 }
        )
      }
      updates.emailLimit = body.emailLimit
    }

    if (Object.keys(updates).length > 0) {
      await db.update(users).set(updates).where(eq(users.id, id))
    }

    if (newRole) {
      const role = await findOrCreateRoleByName(db, newRole)
      await assignRoleToUser(db, id, role.id)
    }

    const updated = await db.query.users.findFirst({
      where: eq(users.id, id),
    })
    const updatedRole = await getUserRoleName(db, id)

    return Response.json({
      user: {
        id,
        username: updated?.username ?? null,
        role: updatedRole,
        emailLimit: updated?.emailLimit ?? null,
      },
    })
  } catch (error) {
    console.error("Failed to update user:", error)
    return Response.json({ error: "更新用户失败" }, { status: 500 })
  }
}
