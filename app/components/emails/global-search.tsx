"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Mail, Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useDebounce } from "@/hooks/use-debounce"
import { cn } from "@/lib/utils"

interface SearchedEmail {
  id: string
  address: string
  createdAt: number
  expiresAt: number
}

interface SearchedMessage {
  id: string
  emailId: string
  emailAddress: string
  subject: string
  fromAddress?: string
  toAddress?: string
  type: "received" | "sent"
  receivedAt?: number
  sentAt?: number
  snippet: string
}

interface SearchResponse {
  emails: SearchedEmail[]
  messages: SearchedMessage[]
}

interface GlobalSearchProps {
  /** 选中邮箱（仅邮箱结果时 messageId 为空）；选中邮件时同时选中其邮箱并打开该邮件 */
  onSelect: (
    email: { id: string; address: string },
    messageId?: string | null,
    messageType?: "received" | "sent"
  ) => void
}

const MIN_QUERY_LENGTH = 2

export function GlobalSearch({ onSelect }: GlobalSearchProps) {
  const t = useTranslations("emails.search")
  const [input, setInput] = useState("")
  const [results, setResults] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounced = useDebounce(input.trim(), 300)
  const containerRef = useRef<HTMLDivElement>(null)
  const hasResults =
    results !== null && (results.emails.length > 0 || results.messages.length > 0)

  useEffect(() => {
    if (debounced.length < MIN_QUERY_LENGTH) {
      setResults(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetch(`/api/search?q=${encodeURIComponent(debounced)}`)
      .then((res) => (res.ok ? (res.json() as Promise<SearchResponse>) : null))
      .then((data) => {
        if (cancelled || !data) return
        setResults(data)
        setOpen(true)
      })
      .catch(() => {
        if (!cancelled) setResults(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced])

  // 点面板外关闭下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const clear = () => {
    setInput("")
    setResults(null)
    setOpen(false)
  }

  const selectEmail = (email: SearchedEmail) => {
    clear()
    onSelect({ id: email.id, address: email.address })
  }

  const selectMessage = (message: SearchedMessage) => {
    clear()
    onSelect(
      { id: message.emailId, address: message.emailAddress },
      message.id,
      message.type
    )
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        value={input}
        onChange={(e) => {
          setInput(e.target.value)
          setOpen(true)
        }}
        onFocus={() => {
          if (hasResults) setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") clear()
        }}
        placeholder={t("placeholder")}
        className="pl-8 pr-8 h-9 bg-background"
      />
      <span className="absolute right-2 top-1/2 -translate-y-1/2">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : input ? (
          <button type="button" aria-label={t("clear")} onClick={clear} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </span>

      {open && debounced.length >= MIN_QUERY_LENGTH && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-primary/20 bg-background shadow-lg max-h-[60vh] overflow-auto">
          {loading && !hasResults ? (
            <div className="p-3 text-center text-sm text-gray-500">{t("loading")}</div>
          ) : !hasResults ? (
            <div className="p-3 text-center text-sm text-gray-500">{t("noResults")}</div>
          ) : (
            <>
              {results.emails.length > 0 && (
                <div>
                  <div className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                    {t("emails")}
                  </div>
                  {results.emails.map((email) => (
                    <button
                      key={email.id}
                      type="button"
                      onClick={() => selectEmail(email)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-primary/5"
                    >
                      <Mail className="h-4 w-4 shrink-0 text-primary/60" />
                      <span className="truncate">{email.address}</span>
                    </button>
                  ))}
                </div>
              )}
              {results.messages.length > 0 && (
                <div>
                  <div className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                    {t("messages")}
                  </div>
                  {results.messages.map((message) => (
                    <button
                      key={message.id}
                      type="button"
                      onClick={() => selectMessage(message)}
                      className="block w-full px-3 py-2 text-left hover:bg-primary/5"
                    >
                      <div className="truncate text-sm font-medium">{message.subject}</div>
                      <div className="mt-0.5 truncate text-xs text-gray-500">
                        {message.fromAddress || message.toAddress || message.emailAddress}
                        {" · "}
                        {new Date(message.receivedAt || message.sentAt || 0).toLocaleString()}
                      </div>
                      {message.snippet && (
                        <div className={cn("mt-0.5 truncate text-xs text-muted-foreground")}>
                          {message.snippet}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
