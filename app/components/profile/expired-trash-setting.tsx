"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Trash2 } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { useConfig } from "@/hooks/use-config"

/**
 * 用户级设置：我的邮箱到期后是否自动进回收站。
 * 展示值 = 个人设置（user.expired_to_trash）?? 站点默认（EXPIRED_TRASH_DEFAULT）；
 * 仅在站点回收站开启时有实际作用，也仅此时展示。
 */
export function ExpiredTrashSetting() {
  const t = useTranslations("profile.expiredTrash")
  const { config } = useConfig()
  const { toast } = useToast()
  const [userValue, setUserValue] = useState<boolean | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  const fetchSetting = useCallback(async () => {
    try {
      const res = await fetch("/api/users/me/settings")
      if (res.ok) {
        const data = (await res.json()) as { expiredToTrash: boolean | null }
        setUserValue(data.expiredToTrash ?? null)
      }
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    fetchSetting()
  }, [fetchSetting])

  const save = async (value: boolean | null) => {
    setSaving(true)
    try {
      const res = await fetch("/api/users/me/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiredToTrash: value }),
      })
      if (!res.ok) throw new Error()
      setUserValue(value)
      toast({ title: t("saveSuccess") })
    } catch {
      toast({ title: t("saveFailed"), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  if (!config?.mailboxTrashEnabled || !loaded) {
    return null
  }

  const siteDefault = config.expiredTrashDefault
  const effective = userValue ?? siteDefault

  return (
    <div className="bg-background rounded-lg border-2 border-primary/20 p-6">
      <div className="flex items-center gap-2 mb-4">
        <Trash2 className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">{t("title")}</h2>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="expired-to-trash" className="text-sm font-medium">
            {t("label")}
          </Label>
          <p className="text-xs text-muted-foreground">{t("description")}</p>
          <p className="text-xs text-muted-foreground">
            {userValue === null
              ? t("followingDefault", { state: siteDefault ? t("stateOn") : t("stateOff") })
              : t("customSet")}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          <Switch
            id="expired-to-trash"
            checked={effective}
            disabled={saving}
            onCheckedChange={(checked) => save(checked)}
          />
        </div>
      </div>
      {userValue !== null && (
        <Button
          variant="link"
          size="sm"
          className="px-0 mt-2"
          disabled={saving}
          onClick={() => save(null)}
        >
          {t("resetToDefault")}
        </Button>
      )}
    </div>
  )
}
