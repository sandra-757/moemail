"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { CreateDialog } from "./create-dialog"
import { ShareDialog } from "./share-dialog"
import { Clock, GripVertical, Loader2, Mail, RefreshCw, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useThrottle } from "@/hooks/use-throttle"
import { EMAIL_CONFIG } from "@/config"
import { useToast } from "@/components/ui/use-toast"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useConfig } from "@/hooks/use-config"
import { EXPIRY_OPTIONS } from "@/types/email"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface Email {
  id: string
  address: string
  createdAt: number
  expiresAt: number
}

interface EmailListProps {
  onEmailSelect: (email: Email | null) => void
  selectedEmailId?: string
}

interface EmailResponse {
  emails: Email[]
  nextCursor: string | null
  total: number
  // 与建邮箱同一口径的生效上限（个人上限 → 分组上限 → 皇帝不限 → 全局上限），
  // null 表示不限量；字段缺失时（旧部署）前端回退到全站 maxEmails。
  effectiveLimit?: number | null
}

export function EmailList({ onEmailSelect, selectedEmailId }: EmailListProps) {
  const { data: session } = useSession()
  const { config } = useConfig()
  const t = useTranslations("emails.list")
  const tCommon = useTranslations("common.actions")
  const [emails, setEmails] = useState<Email[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [total, setTotal] = useState(0)
  // undefined = 尚未拿到接口返回值，null = 不限量，数字 = 生效上限
  const [effectiveLimit, setEffectiveLimit] = useState<number | null | undefined>(undefined)
  const [emailToDelete, setEmailToDelete] = useState<Email | null>(null)
  const { toast } = useToast()
  const tCreate = useTranslations("emails.create")
  const [expiryEmail, setExpiryEmail] = useState<Email | null>(null)
  const [expiryValue, setExpiryValue] = useState<string>(EXPIRY_OPTIONS[1].value.toString())
  const [savingExpiry, setSavingExpiry] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [loadingAll, setLoadingAll] = useState(false)

  const allowPermanentEmail = config?.allowPermanentEmail ?? true
  const trashEnabled = config?.mailboxTrashEnabled ?? false
  const expiryLabels = [tCreate("oneHour"), tCreate("oneDay"), tCreate("threeDays"), tCreate("permanent")]
  const visibleExpiryOptions = EXPIRY_OPTIONS
    .map((option, index) => ({ option, label: expiryLabels[index] }))
    .filter(({ option }) => allowPermanentEmail || option.value !== 0)

  const allLoaded = !nextCursor

  const ensureAllLoaded = async () => {
    if (!nextCursor || loadingAll) return
    setLoadingAll(true)
    try {
      let cursor: string | null = nextCursor
      const collected: Email[] = []
      while (cursor) {
        const url = new URL("/api/emails", window.location.origin)
        url.searchParams.set("cursor", cursor)
        const response = await fetch(url)
        const data = (await response.json()) as EmailResponse
        collected.push(...data.emails)
        cursor = data.nextCursor
      }
      setEmails((prev) => [...prev, ...collected])
      setNextCursor(null)
    } catch {
      // 加载失败保持现状，仍可稍后重试
    } finally {
      setLoadingAll(false)
    }
  }

  const handleSaveExpiry = async () => {
    if (!expiryEmail) return
    setSavingExpiry(true)
    try {
      const response = await fetch(`/api/emails/${expiryEmail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiryTime: Number(expiryValue) }),
      })
      const data = (await response.json().catch(() => null)) as { error?: string; expiresAt?: number } | null
      if (!response.ok) throw new Error(data?.error || t("expiryUpdateFailed"))
      setEmails((prev) =>
        prev.map((e) => (e.id === expiryEmail.id ? { ...e, expiresAt: data?.expiresAt ?? e.expiresAt } : e))
      )
      toast({ title: t("expiryUpdated") })
      setExpiryEmail(null)
    } catch (error) {
      toast({
        title: t("expiryUpdateFailed"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      })
    } finally {
      setSavingExpiry(false)
    }
  }

  const handleDrop = async (targetId: string) => {
    const sourceId = dragId
    setDragId(null)
    setOverId(null)
    if (!sourceId || sourceId === targetId) return
    const from = emails.findIndex((e) => e.id === sourceId)
    const to = emails.findIndex((e) => e.id === targetId)
    if (from === -1 || to === -1) return
    const reordered = [...emails]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    setEmails(reordered)
    try {
      const response = await fetch("/api/emails/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: reordered.map((e) => e.id) }),
      })
      if (!response.ok) throw new Error("reorder failed")
    } catch {
      toast({ title: t("reorderFailed"), variant: "destructive" })
      fetchEmails()
    }
  }

  const fetchEmails = async (cursor?: string) => {
    try {
      const url = new URL("/api/emails", window.location.origin)
      if (cursor) {
        url.searchParams.set('cursor', cursor)
      }
      const response = await fetch(url)
      const data = await response.json() as EmailResponse
      if (data.effectiveLimit !== undefined) {
        setEffectiveLimit(data.effectiveLimit)
      }
      
      if (!cursor) {
        const newEmails = data.emails
        const oldEmails = emails

        const lastDuplicateIndex = newEmails.findIndex(
          newEmail => oldEmails.some(oldEmail => oldEmail.id === newEmail.id)
        )

        if (lastDuplicateIndex === -1) {
          setEmails(newEmails)
          setNextCursor(data.nextCursor)
          setTotal(data.total)
          return
        }
        const uniqueNewEmails = newEmails.slice(0, lastDuplicateIndex)
        setEmails([...uniqueNewEmails, ...oldEmails])
        setTotal(data.total)
        return
      }
      setEmails(prev => [...prev, ...data.emails])
      setNextCursor(data.nextCursor)
      setTotal(data.total)
    } catch (error) {
      console.error("Failed to fetch emails:", error)
    } finally {
      setLoading(false)
      setRefreshing(false)
      setLoadingMore(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchEmails()
  }

  const handleScroll = useThrottle((e: React.UIEvent<HTMLDivElement>) => {
    if (loadingMore) return

    const { scrollHeight, scrollTop, clientHeight } = e.currentTarget
    const threshold = clientHeight * 1.5
    const remainingScroll = scrollHeight - scrollTop

    if (remainingScroll <= threshold && nextCursor) {
      setLoadingMore(true)
      fetchEmails(nextCursor)
    }
  }, 200)

  useEffect(() => {
    if (session) fetchEmails()
  }, [session])

  const handleDelete = async (email: Email, toTrash = true) => {
    try {
      const response = await fetch(`/api/emails/${email.id}?toTrash=${toTrash}`, {
        method: "DELETE"
      })

      if (!response.ok) {
        const data = await response.json()
        toast({
          title: t("error"),
          description: (data as { error: string }).error,
          variant: "destructive"
        })
        return
      }

      setEmails(prev => prev.filter(e => e.id !== email.id))
      setTotal(prev => prev - 1)

      toast({
        title: t("success"),
        description: toTrash && trashEnabled ? t("trashSuccess") : t("deleteSuccess")
      })
      
      if (selectedEmailId === email.id) {
        onEmailSelect(null)
      }
    } catch {
      toast({
        title: t("error"),
        description: t("deleteFailed"),
        variant: "destructive"
      })
    } finally {
      setEmailToDelete(null)
    }
  }

  if (!session) return null

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="p-2 flex justify-between items-center border-b border-primary/20">
          <div className="flex items-center gap-2">
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
              {effectiveLimit === null ? (
                t("emailCountUnlimited", { count: total })
              ) : (
                t("emailCount", { count: total, max: effectiveLimit ?? (config?.maxEmails || EMAIL_CONFIG.MAX_ACTIVE_EMAILS) })
              )}
            </span>
          </div>
          <CreateDialog onEmailCreated={handleRefresh} />
        </div>
        
        <div className="flex-1 overflow-auto p-2" onScroll={handleScroll}>
          {loading ? (
            <div className="text-center text-sm text-gray-500">{t("loading")}</div>
          ) : emails.length > 0 ? (
            <div className="space-y-1">
              {emails.map(email => (
                <div
                  key={email.id}
                  draggable={allLoaded}
                  onDragStart={(e) => {
                    setDragId(email.id)
                    e.dataTransfer.effectAllowed = "move"
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    if (overId !== email.id) setOverId(email.id)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    handleDrop(email.id)
                  }}
                  onDragEnd={() => {
                    setDragId(null)
                    setOverId(null)
                  }}
                  className={cn("flex items-center gap-2 p-2 rounded cursor-pointer text-sm group",
                    "hover:bg-primary/5",
                    selectedEmailId === email.id && "bg-primary/10",
                    dragId === email.id && "opacity-50",
                    overId === email.id && dragId && dragId !== email.id && "ring-1 ring-primary/50"
                  )}
                  onClick={() => onEmailSelect(email)}
                >
                  <span
                    className={cn("shrink-0 text-gray-300 group-hover:text-gray-400", allLoaded ? "cursor-grab" : "cursor-pointer")}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!allLoaded) ensureAllLoaded()
                    }}
                  >
                    {loadingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <GripVertical className="h-4 w-4" />}
                  </span>
                  <Mail className="h-4 w-4 text-primary/60" />
                  <div className="truncate flex-1">
                    <div className="font-medium truncate">{email.address}</div>
                    <div className="text-xs text-gray-500">
                      {new Date(email.expiresAt).getFullYear() === 9999 ? (
                        t("permanent")
                      ) : (
                        `${t("expiresAt")}: ${new Date(email.expiresAt).toLocaleString()}`
                      )}
                    </div>
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 flex gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title={t("modifyExpiry")}
                      onClick={(e) => {
                        e.stopPropagation()
                        setExpiryValue(EXPIRY_OPTIONS[1].value.toString())
                        setExpiryEmail(email)
                      }}
                    >
                      <Clock className="h-4 w-4" />
                    </Button>
                    <ShareDialog emailId={email.id} emailAddress={email.address} />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEmailToDelete(email)
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
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
            <div className="text-center text-sm text-gray-500">
              {t("noEmails")}
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!expiryEmail} onOpenChange={(open) => { if (!open) setExpiryEmail(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("modifyExpiry")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground truncate">{expiryEmail?.address}</div>
            <div className="space-y-2">
              <Label>{tCreate("expiryTime")}</Label>
              <Select value={expiryValue} onValueChange={setExpiryValue}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {visibleExpiryOptions.map(({ option, label }) => (
                    <SelectItem key={option.value} value={option.value.toString()}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExpiryEmail(null)}>
              {tCommon("cancel")}
            </Button>
            <Button onClick={handleSaveExpiry} disabled={savingExpiry}>
              {savingExpiry ? <Loader2 className="w-4 h-4 animate-spin" /> : tCommon("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!emailToDelete} onOpenChange={() => setEmailToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              {trashEnabled
                ? t("deleteDescriptionTrash", {
                    email: emailToDelete?.address || "",
                    days: config?.trashRetentionDays ?? 30,
                  })
                : t("deleteDescription", { email: emailToDelete?.address || "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            {trashEnabled ? (
              <>
                <AlertDialogAction
                  className="bg-destructive hover:bg-destructive/90"
                  onClick={() => emailToDelete && handleDelete(emailToDelete, false)}
                >
                  {t("permanentDelete")}
                </AlertDialogAction>
                <AlertDialogAction
                  onClick={() => emailToDelete && handleDelete(emailToDelete, true)}
                >
                  {t("moveToTrash")}
                </AlertDialogAction>
              </>
            ) : (
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90"
                onClick={() => emailToDelete && handleDelete(emailToDelete)}
              >
                {tCommon("delete")}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
} 