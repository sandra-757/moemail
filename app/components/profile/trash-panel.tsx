"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, RefreshCw, RotateCcw, Trash2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
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
import { useToast } from "@/components/ui/use-toast"

interface TrashedMailbox {
  id: string
  address: string
  userId: string | null
  owner: string | null
  deletedAt: string | null
  createdAt: string
  expiresAt: string
  messageCount: number
}

export function TrashPanel() {
  const t = useTranslations("profile.trash")
  const tCommon = useTranslations("common.actions")
  const { toast } = useToast()
  const [mailboxes, setMailboxes] = useState<TrashedMailbox[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingPurge, setPendingPurge] = useState<TrashedMailbox | null>(null)
  const [actingId, setActingId] = useState<string | null>(null)

  const fetchTrash = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/trash")
      if (res.ok) {
        const data = (await res.json()) as { mailboxes: TrashedMailbox[] }
        setMailboxes(data.mailboxes)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTrash()
  }, [fetchTrash])

  const restore = async (mailbox: TrashedMailbox) => {
    setActingId(mailbox.id)
    try {
      const res = await fetch(`/api/admin/trash/${mailbox.id}/restore`, { method: "POST" })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(data?.error || t("actionFailed"))
      toast({ title: t("restoreSuccess") })
      await fetchTrash()
    } catch (error) {
      toast({
        title: t("actionFailed"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      })
    } finally {
      setActingId(null)
    }
  }

  const purge = async () => {
    if (!pendingPurge) return
    setActingId(pendingPurge.id)
    try {
      const res = await fetch(`/api/admin/trash/${pendingPurge.id}`, { method: "DELETE" })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(data?.error || t("actionFailed"))
      toast({ title: t("purgeSuccess") })
      setPendingPurge(null)
      await fetchTrash()
    } catch (error) {
      toast({
        title: t("actionFailed"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      })
    } finally {
      setActingId(null)
    }
  }

  const formatTime = (value: string | null) =>
    value ? new Date(value).toLocaleString() : "-"

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={fetchTrash} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="ml-1">{t("refresh")}</span>
        </Button>
      </CardHeader>
      <CardContent>
        {loading && !mailboxes ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t("loading")}
          </div>
        ) : mailboxes ? (
          mailboxes.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">{t("empty")}</div>
          ) : (
            <div className="space-y-2">
              <div className="hidden md:grid grid-cols-[1fr_1fr_auto_auto_auto] gap-3 px-3 text-xs text-muted-foreground">
                <span>{t("address")}</span>
                <span>{t("owner")}</span>
                <span>{t("deletedAt")}</span>
                <span>{t("messageCount")}</span>
                <span>{t("actions")}</span>
              </div>
              {mailboxes.map((mailbox) => (
                <div
                  key={mailbox.id}
                  className="grid md:grid-cols-[1fr_1fr_auto_auto_auto] gap-3 items-center rounded-lg border p-3"
                >
                  <div className="text-sm font-medium break-all">{mailbox.address}</div>
                  <div className="text-sm text-muted-foreground break-all">
                    {mailbox.owner || mailbox.userId || "-"}
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatTime(mailbox.deletedAt)}
                  </div>
                  <div className="text-sm whitespace-nowrap">
                    {t("messageCountValue", { count: mailbox.messageCount })}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={actingId === mailbox.id}
                      onClick={() => restore(mailbox)}
                    >
                      {actingId === mailbox.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RotateCcw className="w-4 h-4" />
                      )}
                      <span className="ml-1">{t("restore")}</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={actingId === mailbox.id}
                      onClick={() => setPendingPurge(mailbox)}
                    >
                      <Trash2 className="w-4 h-4" />
                      <span className="ml-1">{tCommon("delete")}</span>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="text-sm text-muted-foreground">{t("loadFailed")}</div>
        )}
      </CardContent>

      <AlertDialog
        open={!!pendingPurge}
        onOpenChange={(open) => {
          if (!open && !actingId) setPendingPurge(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmPurgeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingPurge
                ? t("confirmPurgeDescription", {
                    address: pendingPurge.address,
                    count: pendingPurge.messageCount,
                  })
                : ""}
              {t("confirmIrreversible")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!actingId}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              disabled={!!actingId}
              onClick={(e) => {
                e.preventDefault()
                purge()
              }}
            >
              {actingId ? <Loader2 className="w-4 h-4 animate-spin" /> : t("confirmPurge")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
