"use client"

import { use, useCallback, useEffect, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import {
  ArrowLeft,
  Loader2,
  Trash2,
  KeyRound,
  MailPlus,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { EXPIRY_OPTIONS } from "@/types/email"

const ACCESS_KEY_STORAGE = "moemail-admin-access-key"

interface SpaceUser {
  id: string
  username: string | null
  name: string | null
  email: string | null
  role: string | null
  emailLimit: number | null
  effectiveLimit: number | null
}

interface SpaceEmail {
  id: string
  address: string
  createdAt: string | number
  expiresAt: string | number
  messageCount: number
}

interface SpaceMessage {
  id: string
  subject: string
  fromAddress: string | null
  toAddress: string | null
  receivedAt: string | number
  type: string | null
}

interface SpaceMessageDetail extends SpaceMessage {
  content: string
  html: string | null
  sentAt: string | number
}

const MESSAGE_PAGE_SIZE = 20

export default function AdminSpacePage({
  params,
}: {
  params: Promise<{ locale: string; userId: string }>
}) {
  const { userId } = use(params)
  const t = useTranslations("profile.space")
  const tCreate = useTranslations("emails.create")
  const tPromote = useTranslations("profile.promote")
  const locale = useLocale()
  const router = useRouter()
  const { toast } = useToast()

  const [accessKey, setAccessKey] = useState<string>("")
  const [keyInput, setKeyInput] = useState("")
  const [needsKey, setNeedsKey] = useState(false)
  const [loading, setLoading] = useState(true)
  const [spaceUser, setSpaceUser] = useState<SpaceUser | null>(null)
  const [spaceEmails, setSpaceEmails] = useState<SpaceEmail[]>([])

  const [domains, setDomains] = useState<string[]>([])
  const [newName, setNewName] = useState("")
  const [newDomain, setNewDomain] = useState("")
  const [newExpiry, setNewExpiry] = useState<string>(EXPIRY_OPTIONS[1].value.toString())
  const [creating, setCreating] = useState(false)

  const [selectedEmail, setSelectedEmail] = useState<SpaceEmail | null>(null)
  const [messages, setMessages] = useState<SpaceMessage[]>([])
  const [messagesTotal, setMessagesTotal] = useState(0)
  const [messagesPage, setMessagesPage] = useState(1)
  const [messagesLoading, setMessagesLoading] = useState(false)

  const [messageDetail, setMessageDetail] = useState<SpaceMessageDetail | null>(null)
  const [emailToDelete, setEmailToDelete] = useState<SpaceEmail | null>(null)
  const [messageToDelete, setMessageToDelete] = useState<SpaceMessage | null>(null)
  const [deleting, setDeleting] = useState(false)

  const authHeaders = useCallback(
    (key: string): Record<string, string> =>
      key ? { "x-admin-access-key": key } : {},
    []
  )

  const fetchSpace = useCallback(
    async (key: string) => {
      setLoading(true)
      try {
        const res = await fetch(`/api/admin/space/${userId}`, {
          headers: authHeaders(key),
        })
        if (res.status === 401 || res.status === 403) {
          setNeedsKey(true)
          return
        }
        if (!res.ok) throw new Error("Failed")
        const data = (await res.json()) as { user: SpaceUser; emails: SpaceEmail[] }
        setSpaceUser(data.user)
        setSpaceEmails(data.emails)
        setNeedsKey(false)
      } catch {
        toast({ title: t("loadFailed"), variant: "destructive" })
      } finally {
        setLoading(false)
      }
    },
    [userId, authHeaders, t, toast]
  )

  useEffect(() => {
    const stored = sessionStorage.getItem(ACCESS_KEY_STORAGE) || ""
    setAccessKey(stored)
    fetchSpace(stored)
  }, [fetchSpace])

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch("/api/config")
        if (!res.ok) return
        const data = (await res.json()) as { emailDomains?: string }
        const list = (data.emailDomains || "moemail.app")
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean)
        setDomains(list)
        if (list.length > 0) setNewDomain((prev) => prev || list[0])
      } catch {
        // 域名列表加载失败时保持默认
      }
    })()
  }, [])

  const handleKeySubmit = async () => {
    const key = keyInput.trim()
    if (!key) return
    sessionStorage.setItem(ACCESS_KEY_STORAGE, key)
    setAccessKey(key)
    await fetchSpace(key)
  }

  const handleCreateEmail = async () => {
    setCreating(true)
    try {
      const res = await fetch(`/api/admin/space/${userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(accessKey) },
        body: JSON.stringify({
          name: newName,
          domain: newDomain,
          expiryTime: Number(newExpiry),
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(data?.error || tCreate("failed"))
      }
      toast({ title: tCreate("success") })
      setNewName("")
      await fetchSpace(accessKey)
    } catch (error) {
      toast({
        title: tCreate("failed"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      })
    } finally {
      setCreating(false)
    }
  }

  const fetchMessages = useCallback(
    async (email: SpaceEmail, page: number, key: string) => {
      setMessagesLoading(true)
      try {
        const params = new URLSearchParams({
          page: page.toString(),
          pageSize: MESSAGE_PAGE_SIZE.toString(),
        })
        const res = await fetch(
          `/api/admin/space/${userId}/emails/${email.id}/messages?${params}`,
          { headers: authHeaders(key) }
        )
        if (!res.ok) throw new Error("Failed")
        const data = (await res.json()) as {
          messages: SpaceMessage[]
          total: number
        }
        setMessages(data.messages)
        setMessagesTotal(data.total)
        setMessagesPage(page)
      } catch {
        toast({ title: t("loadFailed"), variant: "destructive" })
      } finally {
        setMessagesLoading(false)
      }
    },
    [userId, authHeaders, t, toast]
  )

  const openEmail = (email: SpaceEmail) => {
    setSelectedEmail(email)
    setMessages([])
    setMessagesTotal(0)
    fetchMessages(email, 1, accessKey)
  }

  const openMessage = async (message: SpaceMessage) => {
    if (!selectedEmail) return
    try {
      const res = await fetch(
        `/api/admin/space/${userId}/emails/${selectedEmail.id}/messages/${message.id}`,
        { headers: authHeaders(accessKey) }
      )
      if (!res.ok) throw new Error("Failed")
      const data = (await res.json()) as { message: SpaceMessageDetail }
      setMessageDetail(data.message)
    } catch {
      toast({ title: t("loadFailed"), variant: "destructive" })
    }
  }

  const handleDeleteEmail = async (email: SpaceEmail) => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/space/${userId}/emails/${email.id}`, {
        method: "DELETE",
        headers: authHeaders(accessKey),
      })
      if (!res.ok) throw new Error("Failed")
      toast({ title: t("deleteEmailSuccess") })
      setEmailToDelete(null)
      if (selectedEmail?.id === email.id) {
        setSelectedEmail(null)
        setMessages([])
      }
      await fetchSpace(accessKey)
    } catch {
      toast({ title: t("deleteFailed"), variant: "destructive" })
    } finally {
      setDeleting(false)
    }
  }

  const handleDeleteMessage = async (message: SpaceMessage) => {
    if (!selectedEmail) return
    setDeleting(true)
    try {
      const res = await fetch(
        `/api/admin/space/${userId}/emails/${selectedEmail.id}/messages/${message.id}`,
        { method: "DELETE", headers: authHeaders(accessKey) }
      )
      if (!res.ok) throw new Error("Failed")
      toast({ title: t("deleteMessageSuccess") })
      setMessageToDelete(null)
      if (messageDetail?.id === message.id) setMessageDetail(null)
      await fetchMessages(selectedEmail, messagesPage, accessKey)
      await fetchSpace(accessKey)
    } catch {
      toast({ title: t("deleteFailed"), variant: "destructive" })
    } finally {
      setDeleting(false)
    }
  }

  const formatDate = (value: string | number) =>
    new Date(value).toLocaleString(locale === "zh-CN" ? "zh-CN" : undefined)

  const isPermanent = (expiresAt: string | number) =>
    new Date(expiresAt).getFullYear() >= 9999

  const expiryLabels = [
    tCreate("oneHour"),
    tCreate("oneDay"),
    tCreate("threeDays"),
    tCreate("permanent"),
  ]

  const messagesTotalPages = Math.max(1, Math.ceil(messagesTotal / MESSAGE_PAGE_SIZE))

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 lg:px-8 max-w-[1200px]">
        <main className="pt-10 pb-10 max-w-4xl mx-auto space-y-6">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => router.push(`/${locale}/profile`)}
            >
              <ArrowLeft className="w-4 h-4" />
              {t("backToProfile")}
            </Button>
            <h1 className="text-lg font-semibold">{t("title")}</h1>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <span className="ml-2 text-muted-foreground">{tPromote("loading")}</span>
            </div>
          ) : needsKey ? (
            <div className="bg-background rounded-lg border-2 border-primary/20 p-6 space-y-4">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-primary" />
                <h2 className="font-semibold">{t("keyRequired")}</h2>
              </div>
              <p className="text-sm text-muted-foreground">{t("keyDescription")}</p>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder={t("keyPlaceholder")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleKeySubmit()
                  }}
                />
                <Button onClick={handleKeySubmit}>{t("keySubmit")}</Button>
              </div>
            </div>
          ) : (
            <>
              {spaceUser && (
                <div className="bg-background rounded-lg border-2 border-primary/20 p-6">
                  <div className="font-medium">
                    {spaceUser.username || spaceUser.name || "—"}
                    {spaceUser.role && (
                      <span className="ml-2 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                        {spaceUser.role}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {t("emailUsage", {
                      count: spaceEmails.length,
                      limit: spaceUser.effectiveLimit ?? t("unlimited"),
                    })}
                  </div>
                </div>
              )}

              {/* 新建邮箱 */}
              <div className="bg-background rounded-lg border-2 border-primary/20 p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <MailPlus className="w-5 h-5 text-primary" />
                  <h2 className="font-semibold">{t("createEmail")}</h2>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>{tCreate("name")}</Label>
                    <Input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder={tCreate("namePlaceholder")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{tCreate("domain")}</Label>
                    <Select value={newDomain} onValueChange={setNewDomain}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {domains.map((domain) => (
                          <SelectItem key={domain} value={domain}>
                            {domain}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{tCreate("expiryTime")}</Label>
                    <Select value={newExpiry} onValueChange={setNewExpiry}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EXPIRY_OPTIONS.map((option, index) => (
                          <SelectItem key={option.value} value={option.value.toString()}>
                            {expiryLabels[index]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button onClick={handleCreateEmail} disabled={creating}>
                  {creating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    tCreate("create")
                  )}
                </Button>
              </div>

              {/* 邮箱列表 + 消息列表 */}
              <div className="grid gap-6 md:grid-cols-2 items-start">
                <div className="bg-background rounded-lg border-2 border-primary/20 p-6">
                  <h2 className="font-semibold mb-4">{t("emails")}</h2>
                  {spaceEmails.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      {t("noEmails")}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {spaceEmails.map((email) => (
                        <div
                          key={email.id}
                          className={`flex items-center gap-2 p-3 rounded-lg border transition-colors cursor-pointer ${
                            selectedEmail?.id === email.id
                              ? "border-primary bg-primary/5"
                              : "border-border hover:bg-accent/50"
                          }`}
                          onClick={() => openEmail(email)}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{email.address}</div>
                            <div className="text-xs text-muted-foreground">
                              {t("messageCount", { count: email.messageCount })} ·{" "}
                              {isPermanent(email.expiresAt)
                                ? tCreate("permanent")
                                : `${t("expiresAt")}: ${formatDate(email.expiresAt)}`}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                            onClick={(e) => {
                              e.stopPropagation()
                              setEmailToDelete(email)
                            }}
                            title={t("deleteEmail")}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-background rounded-lg border-2 border-primary/20 p-6">
                  <h2 className="font-semibold mb-4">{t("messages")}</h2>
                  {!selectedEmail ? (
                    <div className="text-center py-8 text-muted-foreground">
                      {t("selectEmailFirst")}
                    </div>
                  ) : messagesLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin text-primary" />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      {t("noMessages")}
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        {messages.map((message) => (
                          <div
                            key={message.id}
                            className="flex items-center gap-2 p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors cursor-pointer"
                            onClick={() => openMessage(message)}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate">
                                {message.subject || t("noSubject")}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {message.fromAddress || "—"} · {formatDate(message.receivedAt)}
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                              onClick={(e) => {
                                e.stopPropagation()
                                setMessageToDelete(message)
                              }}
                              title={t("deleteMessage")}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                      {messagesTotalPages > 1 && (
                        <div className="flex items-center justify-between mt-4 pt-4 border-t">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={messagesPage <= 1}
                            onClick={() =>
                              selectedEmail &&
                              fetchMessages(selectedEmail, messagesPage - 1, accessKey)
                            }
                          >
                            <ChevronLeft className="w-4 h-4 mr-1" />
                            {tPromote("prevPage")}
                          </Button>
                          <span className="text-sm text-muted-foreground">
                            {tPromote("pageInfo", {
                              current: messagesPage,
                              total: messagesTotalPages,
                            })}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={messagesPage >= messagesTotalPages}
                            onClick={() =>
                              selectedEmail &&
                              fetchMessages(selectedEmail, messagesPage + 1, accessKey)
                            }
                          >
                            {tPromote("nextPage")}
                            <ChevronRight className="w-4 h-4 ml-1" />
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {/* 消息全文 */}
          <Dialog
            open={!!messageDetail}
            onOpenChange={(open) => {
              if (!open) setMessageDetail(null)
            }}
          >
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="pr-6 break-all">
                  {messageDetail?.subject || t("noSubject")}
                </DialogTitle>
              </DialogHeader>
              {messageDetail && (
                <div className="space-y-3">
                  <div className="text-sm text-muted-foreground space-y-1">
                    <div>
                      {t("from")}: {messageDetail.fromAddress || "—"}
                    </div>
                    <div>
                      {t("to")}: {messageDetail.toAddress || "—"}
                    </div>
                    <div>
                      {t("date")}: {formatDate(messageDetail.receivedAt)}
                    </div>
                  </div>
                  {messageDetail.html ? (
                    <div
                      className="prose prose-sm max-w-none dark:prose-invert border rounded-md p-4 overflow-x-auto"
                      dangerouslySetInnerHTML={{ __html: messageDetail.html }}
                    />
                  ) : (
                    <pre className="whitespace-pre-wrap break-words border rounded-md p-4 text-sm">
                      {messageDetail.content}
                    </pre>
                  )}
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* 删除邮箱确认 */}
          <AlertDialog
            open={!!emailToDelete}
            onOpenChange={(open) => {
              if (!open && !deleting) setEmailToDelete(null)
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("deleteEmail")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("deleteEmailConfirm", { address: emailToDelete?.address || "" })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>
                  {tPromote("cancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={deleting}
                  onClick={(e) => {
                    e.preventDefault()
                    if (emailToDelete) handleDeleteEmail(emailToDelete)
                  }}
                >
                  {deleting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    tPromote("deleteConfirmButton")
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* 删除消息确认 */}
          <AlertDialog
            open={!!messageToDelete}
            onOpenChange={(open) => {
              if (!open && !deleting) setMessageToDelete(null)
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("deleteMessage")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("deleteMessageConfirm", {
                    subject: messageToDelete?.subject || "",
                  })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>
                  {tPromote("cancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={deleting}
                  onClick={(e) => {
                    e.preventDefault()
                    if (messageToDelete) handleDeleteMessage(messageToDelete)
                  }}
                >
                  {deleting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    tPromote("deleteConfirmButton")
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </main>
      </div>
    </div>
  )
}
