import { getRequestContext } from "@cloudflare/next-on-pages"
import { checkPermission } from "./auth"
import { PERMISSIONS } from "./permissions"

/**
 * 管理员特殊访问密钥：KV 只存密钥原文的 SHA-256 hex（不加盐），
 * 请求方通过 x-admin-access-key 头携带原文，服务端哈希后常量时间比较。
 */
export const ADMIN_ACCESS_KEY_HASH_KV = "ADMIN_ACCESS_KEY_HASH"
export const ADMIN_ACCESS_HEADER = "x-admin-access-key"
export const ADMIN_ACCESS_KEY_MIN_LENGTH = 12

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/** 常量时间字符串比较（长度不一致时仍跑完较长者的循环，避免时序泄漏） */
export function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

/**
 * Space API 鉴权：皇帝会话（PROMOTE_USER 权限）或有效的特殊访问密钥，二者其一即可。
 */
export async function isAdminAuthorized(request: Request): Promise<boolean> {
  if (await checkPermission(PERMISSIONS.PROMOTE_USER)) {
    return true
  }

  const key = request.headers.get(ADMIN_ACCESS_HEADER)
  if (!key) return false

  const storedHash = await getRequestContext().env.SITE_CONFIG.get(ADMIN_ACCESS_KEY_HASH_KV)
  if (!storedHash) return false

  const candidateHash = await sha256Hex(key)
  return timingSafeEqual(candidateHash, storedHash.toLowerCase())
}
