import { sql, type SQL, type AnyColumn } from "drizzle-orm"

/**
 * 搜索 + 排序共用 helper（邮箱列表 / 单邮箱邮件列表 / 全局搜索）。
 *
 * 约定：
 * - q 为空 / 超长截断后为空 = 不过滤；前端只在 q >= 2 字符时才调全局搜索，
 *   列表内搜索允许 1 字符（邮箱地址前缀很短时也有用）。
 * - LIKE 通配符 %, _ 与转义符 \ 一律转义，查询走 `LIKE ... ESCAPE '\'`，
 *   用户输入的 % 不会变成通配符。
 * - 排序参数非法时回退默认值，绝不 400（列表页 URL 手改也不应炸页）。
 */

export const MAX_SEARCH_QUERY_LENGTH = 100

export function parseSearchQuery(raw: string | null | undefined): string | null {
  if (!raw) return null
  const q = raw.trim().slice(0, MAX_SEARCH_QUERY_LENGTH).trim()
  return q.length > 0 ? q : null
}

/** 把用户输入转义为 LIKE 安全的子串（不含两侧 %）。 */
export function escapeLikeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
}

export function likePattern(query: string): string {
  return `%${escapeLikeValue(query)}%`
}

/**
 * 对一列做转义后的 LIKE 匹配。SQLite 的 LIKE 对 ASCII 本身不区分大小写，
 * 再包一层 LOWER 以覆盖带大小写的地址/主题比较。
 */
export function likeColumn(column: AnyColumn, query: string): SQL {
  return sql`LOWER(${column}) LIKE LOWER(${likePattern(query)}) ESCAPE '\'`
}

/** 邮箱列表排序模式：custom = 现有手动拖拽顺序（默认）。 */
export const MAILBOX_SORTS = [
  "custom",
  "created_desc",
  "created_asc",
  "expires_asc",
  "expires_desc",
  "address_asc",
  "address_desc",
] as const
export type MailboxSort = (typeof MAILBOX_SORTS)[number]

export function parseMailboxSort(raw: string | null | undefined): MailboxSort {
  if (raw && (MAILBOX_SORTS as readonly string[]).includes(raw)) {
    return raw as MailboxSort
  }
  return "custom"
}

/** 单邮箱邮件列表排序模式：date_desc = 现有默认（最新在前）。 */
export const MESSAGE_SORTS = [
  "date_desc",
  "date_asc",
  "subject_asc",
  "subject_desc",
  "from_asc",
  "from_desc",
] as const
export type MessageSort = (typeof MESSAGE_SORTS)[number]

export function parseMessageSort(raw: string | null | undefined): MessageSort {
  if (raw && (MESSAGE_SORTS as readonly string[]).includes(raw)) {
    return raw as MessageSort
  }
  return "date_desc"
}

/** 全局搜索结果里截一段正文摘要：命中词前后各留一点上下文，并去掉 HTML 标签。 */
export function makeSnippet(content: string | null | undefined, query: string, radius = 40): string {
  if (!content) return ""
  const plain = content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
  if (!plain) return ""
  const idx = plain.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return plain.slice(0, 120)
  const start = Math.max(0, idx - radius)
  const end = Math.min(plain.length, idx + query.length + radius)
  const prefix = start > 0 ? "…" : ""
  const suffix = end < plain.length ? "…" : ""
  return `${prefix}${plain.slice(start, end)}${suffix}`
}
