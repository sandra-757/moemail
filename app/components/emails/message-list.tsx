"use client"

import { useState, useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import {Mail, Calendar, RefreshCw, Search, Trash2, Share2, X} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useThrottle } from "@/hooks/use-throttle"
import { useDebounce } from "@/hooks/use-debounce"
import { MESSAGE_SORTS, type MessageSort } from "@/lib/search"
import { EMAIL_CONFIG } from "@/config"
import { useConfig } from "@/hooks/use-config"
import { useToast } from "@/components/ui/use-toast"
import { ShareMessageDialog } from "./share-message-dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";

interface Message {
  id: string
  from_address?: string
  to_address?: string
  subject: string
  received_at?: number
  sent_at?: number
  content?: string
  html?: string
}

interface MessageListProps {
  email: {
    id: string
    address: string
  }
  messageType: 'received' | 'sent'
  onMessageSelect: (messageId: string | null, messageType?: 'received' | 'sent') => void
  selectedMessageId?: string | null
  refreshTrigger?: number
}

interface MessageResponse {
  messages: Message[]
  nextCursor: string | null
  total: number
}

export function MessageList({ email, messageType, onMessageSelect, selectedMessageId, refreshTrigger }: MessageListProps) {
  const t = useTranslations("emails.messages")
  const tList = useTranslations("emails.list")
  const tCommon = useTranslations("common.actions")
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const pollTimeoutRef = useRef<Timer>(null)
  const messagesRef = useRef<Message[]>([]) // 添加 ref 来追踪最新的消息列表
  const [total, setTotal] = useState(0)
  const [messageToDelete, setMessageToDelete] = useState<Message | null>(null)
  // 搜索 + 排序：输入防抖 300ms 后才请求；搜索期间暂停轮询，避免新邮件冲掉搜索结果
  const [searchInput, setSearchInput] = useState("")
  const [sort, setSort] = useState<MessageSort>("date_desc")
  const debouncedSearch = useDebounce(searchInput.trim(), 300)
  const searchRef = useRef(debouncedSearch)
  searchRef.current = debouncedSearch
  const sortRef = useRef(sort)
  sortRef.current = sort
  const isSearching = debouncedSearch.length > 0
  const sortLabels: Record<MessageSort, string> = {
    date_desc: t("sortDateDesc"),
    date_asc: t("sortDateAsc"),
    subject_asc: t("sortSubjectAsc"),
    subject_desc: t("sortSubjectDesc"),
    from_asc: t("sortFromAsc"),
    from_desc: t("sortFromDesc"),
  }
  const { toast } = useToast()
  const { config } = useConfig()
  // 轮询间隔：优先用管理员配置（秒），配置未加载时回退 EMAIL_CONFIG.POLL_INTERVAL（毫秒）
  const pollIntervalMs = config ? config.pollIntervalSeconds * 1000 : EMAIL_CONFIG.POLL_INTERVAL
  const pollIntervalRef = useRef(pollIntervalMs)
  pollIntervalRef.current = pollIntervalMs

  // 当 messages 改变时更新 ref
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const fetchMessages = async (cursor?: string, reset = false) => {
    try {
      const url = new URL(`/api/emails/${email.id}`, window.location.origin)
      if (messageType === 'sent') {
        url.searchParams.set('type', 'sent')
      }
      if (cursor) {
        url.searchParams.set('cursor', cursor)
      }
      if (searchRef.current) url.searchParams.set('q', searchRef.current)
      url.searchParams.set('sort', sortRef.current)
      const response = await fetch(url)
      // 同 email-list：接口报错时不碰 data.messages，避免整页白屏崩溃。
      if (!response.ok) throw new Error(`messages request failed: ${response.status}`)
      const data = await response.json() as MessageResponse
      const list = Array.isArray(data.messages) ? data.messages : []

      if (!cursor) {
        if (reset) {
          setMessages(list)
          setNextCursor(data.nextCursor)
          setTotal(data.total)
          return
        }
        const newMessages = list
        const oldMessages = messagesRef.current

        const lastDuplicateIndex = newMessages.findIndex(
          newMsg => oldMessages.some(oldMsg => oldMsg.id === newMsg.id)
        )

        if (lastDuplicateIndex === -1) {
          setMessages(newMessages)
          setNextCursor(data.nextCursor)
          setTotal(data.total)
          return
        }
        const uniqueNewMessages = newMessages.slice(0, lastDuplicateIndex)
        setMessages([...uniqueNewMessages, ...oldMessages])
        setTotal(data.total)
        return
      }
      setMessages(prev => [...prev, ...list])
      setNextCursor(data.nextCursor)
      setTotal(data.total)
    } catch (error) {
      console.error("Failed to fetch messages:", error)
    } finally {
      setLoading(false)
      setRefreshing(false)
      setLoadingMore(false)
    }
  }

  const startPolling = () => {
    stopPolling()
    // 搜索中不轮询：轮询的合并逻辑会把新邮件插到搜索结果前，冲掉当前搜索视图
    if (searchRef.current) return
    pollTimeoutRef.current = setInterval(() => {
      if (!refreshing && !loadingMore) {
        fetchMessages()
      }
    }, pollIntervalRef.current)
  }

  const stopPolling = () => {
    if (pollTimeoutRef.current) {
      clearInterval(pollTimeoutRef.current)
      pollTimeoutRef.current = null
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchMessages(undefined, true)
  }

  const handleScroll = useThrottle((e: React.UIEvent<HTMLDivElement>) => {
    if (loadingMore) return

    const { scrollHeight, scrollTop, clientHeight } = e.currentTarget
    const threshold = clientHeight * 1.5
    const remainingScroll = scrollHeight - scrollTop

    if (remainingScroll <= threshold && nextCursor) {
      setLoadingMore(true)
      fetchMessages(nextCursor)
    }
  }, 200)

  const handleDelete = async (message: Message) => {
    try {
      const response = await fetch(`/api/emails/${email.id}/${message.id}${messageType === 'sent' ? '?type=sent' : ''}`, {
        method: "DELETE"
      })

      if (!response.ok) {
        const data = await response.json()
        toast({
          title: tList("error"),
          description: (data as { error: string }).error,
          variant: "destructive"
        })
        return
      }

      setMessages(prev => prev.filter(e => e.id !== message.id))
      setTotal(prev => prev - 1)

      toast({
        title: tList("success"),
        description: tList("deleteSuccess")
      })

      if (selectedMessageId === message.id) {
        onMessageSelect(null)
      }
    } catch {
      toast({
        title: tList("error"),
        description: tList("deleteFailed"),
        variant: "destructive"
      })
    } finally {
      setMessageToDelete(null)
    }
  }

  // 邮箱 / 收发 Tab / 搜索词 / 排序变化时从头拉取（旧游标与当前 q/sort 不匹配）
  useEffect(() => {
    if (!email.id) {
      return
    }
    setLoading(true)
    setNextCursor(null)
    fetchMessages(undefined, true)
    startPolling()

    return () => {
      stopPolling()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email.id, messageType, debouncedSearch, sort])

  // 配置加载/变更导致轮询间隔变化时，重启轮询以应用新间隔
  const appliedPollIntervalRef = useRef<number>(EMAIL_CONFIG.POLL_INTERVAL)
  useEffect(() => {
    if (!email.id) return
    if (pollIntervalMs === appliedPollIntervalRef.current) return
    appliedPollIntervalRef.current = pollIntervalMs
    startPolling()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollIntervalMs, email.id])

  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      setRefreshing(true)
      fetchMessages()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger])

  return (
  <>
    <div className="h-full flex flex-col">
      <div className="p-2 flex justify-between items-center border-b border-primary/20">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRefresh}
          disabled={refreshing}
          className={cn("h-8 w-8", refreshing && "animate-spin")}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
        <span className="text-xs text-gray-500">
          {total > 0 ? `${total} ${t("messageCount")}` : t("noMessages")}
        </span>
      </div>
      <div className="p-2 flex gap-2 border-b border-primary/20">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="pl-8 pr-8 h-8"
          />
          {searchInput && (
            <button
              type="button"
              aria-label={tCommon("clear")}
              onClick={() => setSearchInput("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Select value={sort} onValueChange={(value) => setSort(value as MessageSort)}>
          <SelectTrigger className="h-8 w-[152px] shrink-0 text-xs">
            <SelectValue className="truncate" />
          </SelectTrigger>
          <SelectContent>
            {MESSAGE_SORTS.map((value) => (
              <SelectItem key={value} value={value}>
                {sortLabels[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-auto" onScroll={handleScroll}>
        {loading ? (
          <div className="p-4 text-center text-sm text-gray-500">{t("loading")}</div>
        ) : messages.length > 0 ? (
          <div className="divide-y divide-primary/10">
            {messages.map(message => (
              <div
                key={message.id}
                onClick={() => onMessageSelect(message.id, messageType)}
                className={cn(
                  "p-3 hover:bg-primary/5 cursor-pointer group",
                  selectedMessageId === message.id && "bg-primary/10"
                )}
              >
                <div className="flex items-start gap-3">
                  <Mail className="w-4 h-4 text-primary/60 mt-1" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{message.subject}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                      <span className="truncate">
                        {message.from_address || message.to_address || ''}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(message.received_at || message.sent_at || 0).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  {/* 同 email-list：触屏无 hover，lg 以下单栏常显操作按钮，选中行常显 */}
                  <div
                    className={cn(
                      "flex gap-1",
                      selectedMessageId === message.id
                        ? "opacity-100"
                        : "opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ShareMessageDialog
                      emailId={email.id}
                      messageId={message.id}
                      messageSubject={message.subject}
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                        >
                          <Share2 className="h-4 w-4" />
                        </Button>
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation()
                        setMessageToDelete(message)
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            {loadingMore && (
              <div className="text-center text-sm text-gray-500 py-2">
                {t("loadingMore")}
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 text-center text-sm text-gray-500">
            {isSearching ? t("searchNoResults") : t("noMessages")}
          </div>
        )}
      </div>
    </div>
    <AlertDialog open={!!messageToDelete} onOpenChange={() => setMessageToDelete(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{tList("deleteConfirm")}</AlertDialogTitle>
          <AlertDialogDescription>
            {tList("deleteDescription", { email: messageToDelete?.subject || "" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
          <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => messageToDelete && handleDelete(messageToDelete)}
          >
            {tCommon("delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
  )
} 