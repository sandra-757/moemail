"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, RefreshCw, Trash2 } from "lucide-react"
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

interface MailStats {
  emailsTotal: number
  emailsExpired: number
  messagesTotal: number
  messagesReceived: number
  messagesSent: number
  messagesBytes: number
  orphansTotal: number
  orphansBytes: number
  orphansOlderThan30d: number
  oldestOrphanAt: number | null
  messagesOlderThan90d: number
}

type CleanupAction = "orphans-all" | "orphans-old" | "old-messages" | "expired-mailboxes"

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export function MailStatsPanel() {
  const t = useTranslations("profile.mailStats")
  const tCommon = useTranslations("common.actions")
  const { toast } = useToast()
  const [stats, setStats] = useState<MailStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingAction, setPendingAction] = useState<CleanupAction | null>(null)
  const [acting, setActing] = useState(false)

  const fetchStats = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/mail-stats")
      if (res.ok) setStats((await res.json()) as MailStats)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  const runCleanup = async () => {
    if (!pendingAction) return
    setActing(true)
    try {
      const res = await fetch("/api/admin/mail-cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: pendingAction }),
      })
      const data = (await res.json().catch(() => null)) as { deleted?: number; error?: string } | null
      if (!res.ok) throw new Error(data?.error || t("actionFailed"))
      toast({ title: t("actionSuccess", { count: data?.deleted ?? 0 }) })
      setPendingAction(null)
      await fetchStats()
    } catch (error) {
      toast({
        title: t("actionFailed"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      })
    } finally {
      setActing(false)
    }
  }

  const actions: Array<{
    key: CleanupAction
    label: string
    description: string
    count: number
  }> = stats
    ? [
        {
          key: "orphans-old",
          label: t("orphansOld"),
          description: t("orphansOldDescription"),
          count: stats.orphansOlderThan30d,
        },
        {
          key: "orphans-all",
          label: t("orphansAll"),
          description: t("orphansAllDescription"),
          count: stats.orphansTotal,
        },
        {
          key: "old-messages",
          label: t("oldMessages"),
          description: t("oldMessagesDescription"),
          count: stats.messagesOlderThan90d,
        },
        {
          key: "expired-mailboxes",
          label: t("expiredMailboxes"),
          description: t("expiredMailboxesDescription"),
          count: stats.emailsExpired,
        },
      ]
    : []

  const pending = actions.find((a) => a.key === pendingAction)

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={fetchStats} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="ml-1">{t("refresh")}</span>
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading && !stats ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t("loading")}
          </div>
        ) : stats ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="rounded-lg border p-3">
                <div className="text-2xl font-semibold">{stats.emailsTotal}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {t("totalEmails")} · {t("expiredEmails")} {stats.emailsExpired}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-2xl font-semibold">{stats.messagesTotal}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {t("totalMessages")} · {t("received")} {stats.messagesReceived} / {t("sent")}{" "}
                  {stats.messagesSent}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-2xl font-semibold">{formatBytes(stats.messagesBytes)}</div>
                <div className="text-xs text-muted-foreground mt-1">{t("totalSize")}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-2xl font-semibold">{stats.orphansTotal}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {t("orphans")} · {formatBytes(stats.orphansBytes)}
                  {stats.oldestOrphanAt
                    ? ` · ${t("oldestOrphan")} ${new Date(stats.oldestOrphanAt).toLocaleDateString()}`
                    : ""}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">{t("cleanupTitle")}</div>
              {actions.map((action) => (
                <div
                  key={action.key}
                  className="flex items-center gap-3 rounded-lg border p-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm">
                      {action.label}
                      <span className="text-muted-foreground"> · {action.count}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{action.description}</div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive shrink-0"
                    disabled={action.count === 0 || acting}
                    onClick={() => setPendingAction(action.key)}
                  >
                    <Trash2 className="w-4 h-4" />
                    <span className="ml-1">{tCommon("delete")}</span>
                  </Button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-sm text-muted-foreground">{t("loadFailed")}</div>
        )}
      </CardContent>

      <AlertDialog
        open={!!pendingAction}
        onOpenChange={(open) => {
          if (!open && !acting) setPendingAction(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending ? `${pending.label}（${pending.count}）— ${pending.description}` : ""}
              {t("confirmIrreversible")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              disabled={acting}
              onClick={(e) => {
                e.preventDefault()
                runCleanup()
              }}
            >
              {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : t("confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
