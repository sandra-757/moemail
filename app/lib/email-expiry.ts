import { EXPIRY_OPTIONS } from "@/types/email"
import { ROLES, type Role } from "./permissions"
import { parseConfigBool, SITE_CONFIG_DEFAULTS } from "./site-config"

export interface ExpiryKv {
  get(key: string): Promise<string | null>
}

export type ComputeExpiresAtResult =
  | { ok: true; expiresAt: Date }
  | { ok: false; error: string; status: number }

/**
 * 修改已有邮箱有效期的统一口径（与创建邮箱一致）：
 * - expiryTime 必须是 EXPIRY_OPTIONS 之一（相对时长，毫秒；0 = 永久）
 * - 新的过期时间从「现在」起算；永久 = 9999-01-01
 * - 永久仅皇帝可直接设置；其他角色需站点配置 ALLOW_PERMANENT_EMAIL 允许
 */
export async function computeExpiresAt(
  kv: ExpiryKv,
  actorRole: Role | null,
  expiryTime: unknown
): Promise<ComputeExpiresAtResult> {
  if (
    typeof expiryTime !== "number" ||
    !EXPIRY_OPTIONS.some((option) => option.value === expiryTime)
  ) {
    return { ok: false, error: "无效的过期时间", status: 400 }
  }

  if (expiryTime === 0 && actorRole !== ROLES.EMPEROR) {
    const allowPermanentEmail = parseConfigBool(
      await kv.get("ALLOW_PERMANENT_EMAIL"),
      SITE_CONFIG_DEFAULTS.ALLOW_PERMANENT_EMAIL
    )
    if (!allowPermanentEmail) {
      return { ok: false, error: "当前不允许设置永久邮箱", status: 403 }
    }
  }

  const expiresAt =
    expiryTime === 0
      ? new Date("9999-01-01T00:00:00.000Z")
      : new Date(Date.now() + expiryTime)
  return { ok: true, expiresAt }
}

/** 新建邮箱的排序值：取当前最小值 -1，保证新邮箱排在最前（与「最新在前」的既有观感一致） */
export function nextSortOrder(currentMin: number | null | undefined): number {
  return (currentMin ?? 0) - 1
}
