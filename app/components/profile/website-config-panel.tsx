"use client"

import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Settings } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { useState, useEffect, type ReactNode } from "react"
import { Role, ROLES } from "@/lib/permissions"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Eye, EyeOff } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EMAIL_CONFIG } from "@/config"
import { EXPIRY_OPTIONS } from "@/types/email"
import { SITE_CONFIG_DEFAULTS } from "@/lib/site-config"

function ConfigSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-4 rounded-lg border border-dashed border-primary/40 p-4">
      <h3 className="text-sm font-semibold text-primary">{title}</h3>
      {children}
    </div>
  )
}

function SwitchRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
}: {
  id: string
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-1">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

export function WebsiteConfigPanel() {
  const t = useTranslations("profile.website")
  const tCard = useTranslations("profile.card")
  const tExpiry = useTranslations("emails.create")
  // 站点信息
  const [siteName, setSiteName] = useState<string>(SITE_CONFIG_DEFAULTS.SITE_NAME)
  const [adminContact, setAdminContact] = useState<string>("")
  const [announcementEnabled, setAnnouncementEnabled] = useState(false)
  const [announcementText, setAnnouncementText] = useState("")
  // 注册与维护
  const [defaultRole, setDefaultRole] = useState<string>("")
  const [allowRegistration, setAllowRegistration] = useState(true)
  const [maintenanceMode, setMaintenanceMode] = useState(false)
  const [maintenanceMessage, setMaintenanceMessage] = useState("")
  // 邮箱策略
  const [emailDomains, setEmailDomains] = useState<string>("")
  const [maxEmails, setMaxEmails] = useState<string>(EMAIL_CONFIG.MAX_ACTIVE_EMAILS.toString())
  const [defaultExpiry, setDefaultExpiry] = useState<string>(SITE_CONFIG_DEFAULTS.DEFAULT_EXPIRY_MS.toString())
  const [allowPermanentEmail, setAllowPermanentEmail] = useState(true)
  const [saveOrphanMails, setSaveOrphanMails] = useState(false)
  const [keepMailsOnDelete, setKeepMailsOnDelete] = useState(false)
  const [mailboxTrashEnabled, setMailboxTrashEnabled] = useState(false)
  const [trashRetentionDays, setTrashRetentionDays] = useState<string>(SITE_CONFIG_DEFAULTS.TRASH_RETENTION_DAYS.toString())
  const [expiredTrashDefault, setExpiredTrashDefault] = useState(false)
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState<string>(SITE_CONFIG_DEFAULTS.POLL_INTERVAL_SECONDS.toString())
  const [roleLimits, setRoleLimits] = useState<Record<string, string>>({
    emperor: "",
    duke: "",
    knight: "",
  })
  // 人机验证
  const [turnstileEnabled, setTurnstileEnabled] = useState(false)
  const [turnstileSiteKey, setTurnstileSiteKey] = useState("")
  const [turnstileSecretKey, setTurnstileSecretKey] = useState("")
  const [showSecretKey, setShowSecretKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    fetchConfig()
  }, [])

  const fetchConfig = async () => {
    const res = await fetch("/api/config")
    if (res.ok) {
      const data = await res.json() as {
        defaultRole: Exclude<Role, typeof ROLES.EMPEROR>,
        emailDomains: string,
        adminContact: string,
        maxEmails: string,
        siteName?: string,
        announcementEnabled?: boolean,
        announcementText?: string,
        allowRegistration?: boolean,
        maintenanceMode?: boolean,
        maintenanceMessage?: string,
        defaultExpiry?: number,
        allowPermanentEmail?: boolean,
        pollIntervalSeconds?: number,
        saveOrphanMails?: boolean,
        keepMailsOnDelete?: boolean,
        mailboxTrashEnabled?: boolean,
        trashRetentionDays?: number,
        expiredTrashDefault?: boolean,
        roleLimits?: Record<string, string>,
        turnstile?: {
          enabled: boolean,
          siteKey: string,
          secretKey?: string
        }
      }
      setDefaultRole(data.defaultRole)
      setEmailDomains(data.emailDomains)
      setAdminContact(data.adminContact)
      setMaxEmails(data.maxEmails || EMAIL_CONFIG.MAX_ACTIVE_EMAILS.toString())
      setSiteName(data.siteName || SITE_CONFIG_DEFAULTS.SITE_NAME)
      setAnnouncementEnabled(Boolean(data.announcementEnabled))
      setAnnouncementText(data.announcementText ?? "")
      setAllowRegistration(data.allowRegistration ?? true)
      setMaintenanceMode(Boolean(data.maintenanceMode))
      setMaintenanceMessage(data.maintenanceMessage ?? "")
      setDefaultExpiry((data.defaultExpiry ?? SITE_CONFIG_DEFAULTS.DEFAULT_EXPIRY_MS).toString())
      setAllowPermanentEmail(data.allowPermanentEmail ?? true)
      setSaveOrphanMails(data.saveOrphanMails ?? false)
      setKeepMailsOnDelete(data.keepMailsOnDelete ?? false)
      setMailboxTrashEnabled(data.mailboxTrashEnabled ?? false)
      setTrashRetentionDays((data.trashRetentionDays ?? SITE_CONFIG_DEFAULTS.TRASH_RETENTION_DAYS).toString())
      setExpiredTrashDefault(data.expiredTrashDefault ?? false)
      setPollIntervalSeconds((data.pollIntervalSeconds ?? SITE_CONFIG_DEFAULTS.POLL_INTERVAL_SECONDS).toString())
      setRoleLimits({
        emperor: data.roleLimits?.emperor ?? "",
        duke: data.roleLimits?.duke ?? "",
        knight: data.roleLimits?.knight ?? "",
      })
      setTurnstileEnabled(Boolean(data.turnstile?.enabled))
      setTurnstileSiteKey(data.turnstile?.siteKey ?? "")
      setTurnstileSecretKey(data.turnstile?.secretKey ?? "")
    }
  }

  const handleSave = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultRole,
          emailDomains,
          adminContact,
          maxEmails: maxEmails || EMAIL_CONFIG.MAX_ACTIVE_EMAILS.toString(),
          siteName,
          announcementEnabled,
          announcementText,
          allowRegistration,
          maintenanceMode,
          maintenanceMessage,
          defaultExpiry: Number(defaultExpiry),
          allowPermanentEmail,
          pollIntervalSeconds: Number(pollIntervalSeconds),
          saveOrphanMails,
          keepMailsOnDelete,
          mailboxTrashEnabled,
          trashRetentionDays: Number(trashRetentionDays),
          expiredTrashDefault,
          roleLimits,
          turnstile: {
            enabled: turnstileEnabled,
            siteKey: turnstileSiteKey,
            secretKey: turnstileSecretKey
          }
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(data?.error || t("saveFailed"))
      }

      toast({
        title: t("saveSuccess"),
        description: t("saveSuccess"),
      })
    } catch (error) {
      toast({
        title: t("saveFailed"),
        description: error instanceof Error ? error.message : t("saveFailed"),
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const expiryLabels = [tExpiry("oneHour"), tExpiry("oneDay"), tExpiry("threeDays"), tExpiry("permanent")]

  return (
    <div className="bg-background rounded-lg border-2 border-primary/20 p-6">
      <div className="flex items-center gap-2 mb-6">
        <Settings className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">{t("title")}</h2>
      </div>

      <div className="space-y-4">
        <ConfigSection title={t("sections.site")}>
          <div className="flex items-center gap-4">
            <span className="text-sm shrink-0">{t("siteName")}:</span>
            <div className="flex-1">
              <Input
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                placeholder={t("siteNamePlaceholder")}
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-sm shrink-0">{t("adminContact")}:</span>
            <div className="flex-1">
              <Input
                value={adminContact}
                onChange={(e) => setAdminContact(e.target.value)}
                placeholder={t("adminContactPlaceholder")}
              />
            </div>
          </div>

          <SwitchRow
            id="announcement-enabled"
            label={t("announcementEnabled")}
            description={t("announcementEnabledDescription")}
            checked={announcementEnabled}
            onCheckedChange={setAnnouncementEnabled}
          />

          <div className="space-y-2">
            <Label htmlFor="announcement-text" className="text-sm font-medium">
              {t("announcementText")}
            </Label>
            <Input
              id="announcement-text"
              value={announcementText}
              onChange={(e) => setAnnouncementText(e.target.value)}
              placeholder={t("announcementTextPlaceholder")}
            />
          </div>
        </ConfigSection>

        <ConfigSection title={t("sections.registration")}>
          <div className="flex items-center gap-4">
            <span className="text-sm shrink-0">{t("defaultRole")}:</span>
            <Select value={defaultRole} onValueChange={setDefaultRole}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ROLES.DUKE}>{tCard("roles.DUKE")}</SelectItem>
                <SelectItem value={ROLES.KNIGHT}>{tCard("roles.KNIGHT")}</SelectItem>
                <SelectItem value={ROLES.CIVILIAN}>{tCard("roles.CIVILIAN")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <SwitchRow
            id="allow-registration"
            label={t("allowRegistration")}
            description={t("allowRegistrationDescription")}
            checked={allowRegistration}
            onCheckedChange={setAllowRegistration}
          />

          <SwitchRow
            id="maintenance-mode"
            label={t("maintenanceMode")}
            description={t("maintenanceModeDescription")}
            checked={maintenanceMode}
            onCheckedChange={setMaintenanceMode}
          />

          <div className="space-y-2">
            <Label htmlFor="maintenance-message" className="text-sm font-medium">
              {t("maintenanceMessage")}
            </Label>
            <Input
              id="maintenance-message"
              value={maintenanceMessage}
              onChange={(e) => setMaintenanceMessage(e.target.value)}
              placeholder={t("maintenanceMessagePlaceholder")}
            />
          </div>
        </ConfigSection>

        <ConfigSection title={t("sections.emailPolicy")}>
          <div className="flex items-center gap-4">
            <span className="text-sm shrink-0">{t("emailDomains")}:</span>
            <div className="flex-1">
              <Input
                value={emailDomains}
                onChange={(e) => setEmailDomains(e.target.value)}
                placeholder={t("emailDomainsPlaceholder")}
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-sm shrink-0">{t("maxEmails")}:</span>
            <div className="flex-1">
              <Input
                type="number"
                min="1"
                max="10000"
                value={maxEmails}
                onChange={(e) => setMaxEmails(e.target.value)}
                placeholder={`${EMAIL_CONFIG.MAX_ACTIVE_EMAILS}`}
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-sm shrink-0">{t("defaultExpiry")}:</span>
            <Select value={defaultExpiry} onValueChange={setDefaultExpiry}>
              <SelectTrigger className="w-32">
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

          <SwitchRow
            id="allow-permanent-email"
            label={t("allowPermanentEmail")}
            description={t("allowPermanentEmailDescription")}
            checked={allowPermanentEmail}
            onCheckedChange={setAllowPermanentEmail}
          />

          <SwitchRow
            id="save-orphan-mails"
            label={t("saveOrphanMails")}
            description={t("saveOrphanMailsDescription")}
            checked={saveOrphanMails}
            onCheckedChange={setSaveOrphanMails}
          />

          <SwitchRow
            id="keep-mails-on-delete"
            label={t("keepMailsOnDelete")}
            description={t("keepMailsOnDeleteDescription")}
            checked={keepMailsOnDelete}
            onCheckedChange={setKeepMailsOnDelete}
          />

          <SwitchRow
            id="mailbox-trash-enabled"
            label={t("mailboxTrashEnabled")}
            description={t("mailboxTrashEnabledDescription")}
            checked={mailboxTrashEnabled}
            onCheckedChange={setMailboxTrashEnabled}
          />

          <div className="flex items-center gap-4">
            <span className="text-sm shrink-0">{t("trashRetentionDays")}:</span>
            <div className="flex-1">
              <Input
                type="number"
                min="1"
                max="3650"
                value={trashRetentionDays}
                onChange={(e) => setTrashRetentionDays(e.target.value)}
                placeholder={`${SITE_CONFIG_DEFAULTS.TRASH_RETENTION_DAYS}`}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("trashRetentionDaysDescription")}
              </p>
            </div>
          </div>

          <SwitchRow
            id="expired-trash-default"
            label={t("expiredTrashDefault")}
            description={t("expiredTrashDefaultDescription")}
            checked={expiredTrashDefault}
            onCheckedChange={setExpiredTrashDefault}
          />

          <div className="flex items-center gap-4">
            <span className="text-sm shrink-0">{t("pollIntervalSeconds")}:</span>
            <div className="flex-1">
              <Input
                type="number"
                min="3"
                max="120"
                value={pollIntervalSeconds}
                onChange={(e) => setPollIntervalSeconds(e.target.value)}
                placeholder={`${SITE_CONFIG_DEFAULTS.POLL_INTERVAL_SECONDS}`}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("pollIntervalSecondsDescription")}
              </p>
            </div>
          </div>
        </ConfigSection>

        <ConfigSection title={t("sections.roleLimits")}>
          <p className="text-xs text-muted-foreground">
            {t("roleLimitsDescription")}
          </p>
          {(
            [
              ["emperor", tCard("roles.EMPEROR")],
              ["duke", tCard("roles.DUKE")],
              ["knight", tCard("roles.KNIGHT")],
            ] as const
          ).map(([field, label]) => (
            <div key={field} className="flex items-center gap-4">
              <span className="text-sm shrink-0">{label}:</span>
              <div className="flex-1">
                <Input
                  type="number"
                  min="1"
                  max="100000"
                  value={roleLimits[field]}
                  onChange={(e) =>
                    setRoleLimits((prev) => ({ ...prev, [field]: e.target.value }))
                  }
                  placeholder={t("roleLimitPlaceholder")}
                />
              </div>
            </div>
          ))}
        </ConfigSection>

        <ConfigSection title={t("sections.turnstile")}>
          <SwitchRow
            id="turnstile-enabled"
            label={t("turnstile.enable")}
            description={t("turnstile.enableDescription")}
            checked={turnstileEnabled}
            onCheckedChange={setTurnstileEnabled}
          />

          <div className="space-y-2">
            <Label htmlFor="turnstile-site-key" className="text-sm font-medium">
              {t("turnstile.siteKey")}
            </Label>
            <Input
              id="turnstile-site-key"
              value={turnstileSiteKey}
              onChange={(e) => setTurnstileSiteKey(e.target.value)}
              placeholder={t("turnstile.siteKeyPlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="turnstile-secret-key" className="text-sm font-medium">
              {t("turnstile.secretKey")}
            </Label>
            <div className="relative">
              <Input
                id="turnstile-secret-key"
                type={showSecretKey ? "text" : "password"}
                value={turnstileSecretKey}
                onChange={(e) => setTurnstileSecretKey(e.target.value)}
                placeholder={t("turnstile.secretKeyPlaceholder")}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowSecretKey((prev) => !prev)}
              >
                {showSecretKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("turnstile.secretKeyDescription")}
            </p>
          </div>
        </ConfigSection>

        <Button
          onClick={handleSave}
          disabled={loading}
          className="w-full"
        >
          {t("save")}
        </Button>
      </div>
    </div>
  )
}
