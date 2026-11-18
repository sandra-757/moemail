import { getRequestContext } from "@cloudflare/next-on-pages"
import { checkPermission } from "@/lib/auth"
import { PERMISSIONS } from "@/lib/permissions"
import {
  ADMIN_ACCESS_KEY_HASH_KV,
  ADMIN_ACCESS_KEY_MIN_LENGTH,
  sha256Hex,
} from "@/lib/admin-access"

export const runtime = "edge"

/** 特殊访问密钥管理（仅皇帝会话）：只存/删 SHA-256 hash，GET 只报是否已配置 */
export async function GET() {
  const canManage = await checkPermission(PERMISSIONS.PROMOTE_USER)
  if (!canManage) {
    return Response.json({ error: "权限不足" }, { status: 403 })
  }

  const stored = await getRequestContext().env.SITE_CONFIG.get(ADMIN_ACCESS_KEY_HASH_KV)
  return Response.json({ configured: Boolean(stored) })
}

export async function POST(request: Request) {
  const canManage = await checkPermission(PERMISSIONS.PROMOTE_USER)
  if (!canManage) {
    return Response.json({ error: "权限不足" }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as { key?: unknown } | null
  const key = body?.key
  if (typeof key !== "string" || key.length < ADMIN_ACCESS_KEY_MIN_LENGTH) {
    return Response.json(
      { error: `密钥长度至少为 ${ADMIN_ACCESS_KEY_MIN_LENGTH} 个字符` },
      { status: 400 }
    )
  }

  const hash = await sha256Hex(key)
  await getRequestContext().env.SITE_CONFIG.put(ADMIN_ACCESS_KEY_HASH_KV, hash)
  return Response.json({ success: true })
}

export async function DELETE() {
  const canManage = await checkPermission(PERMISSIONS.PROMOTE_USER)
  if (!canManage) {
    return Response.json({ error: "权限不足" }, { status: 403 })
  }

  await getRequestContext().env.SITE_CONFIG.delete(ADMIN_ACCESS_KEY_HASH_KV)
  return Response.json({ success: true })
}
