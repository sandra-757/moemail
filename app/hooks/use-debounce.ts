import { useEffect, useState } from "react"

/** 输入防抖：值变化后 delay 毫秒无新变化才返回新值，用于搜索框避免每敲一键就请求。 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
