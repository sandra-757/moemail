import { eq } from "drizzle-orm"
import type { Db } from "./db"
import { roles } from "./schema"
import { ROLES, type Role } from "./permissions"

/** 管理员可分配的角色（不允许创建/设置为皇帝） */
export const ASSIGNABLE_ROLES: Role[] = [ROLES.DUKE, ROLES.KNIGHT, ROLES.CIVILIAN]

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  [ROLES.EMPEROR]: "皇帝（网站所有者）",
  [ROLES.DUKE]: "公爵（超级用户）",
  [ROLES.KNIGHT]: "骑士（高级用户）",
  [ROLES.CIVILIAN]: "平民（普通用户）",
}

export function isAssignableRole(value: unknown): value is Role {
  return typeof value === "string" && (ASSIGNABLE_ROLES as string[]).includes(value)
}

/** 查找角色行，不存在则按内置描述创建（与 auth.ts 的 findOrCreateRole 同口径） */
export async function findOrCreateRoleByName(db: Db, roleName: Role) {
  const existing = await db.query.roles.findFirst({
    where: eq(roles.name, roleName),
  })
  if (existing) return existing

  const [created] = await db
    .insert(roles)
    .values({
      name: roleName,
      description: ROLE_DESCRIPTIONS[roleName],
    })
    .returning()
  return created
}
