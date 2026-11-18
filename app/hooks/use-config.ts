"use client"

import { create } from "zustand"
import { Role, ROLES } from "@/lib/permissions"
import { EMAIL_CONFIG } from "@/config"
import { EXPIRY_OPTIONS } from "@/types/email"
import { SITE_CONFIG_DEFAULTS } from "@/lib/site-config"
import { useEffect } from "react"

interface Config {
  defaultRole: Exclude<Role, typeof ROLES.EMPEROR>
  emailDomains: string
  emailDomainsArray: string[]
  adminContact: string
  maxEmails: number
  siteName: string
  announcementEnabled: boolean
  announcementText: string
  allowRegistration: boolean
  maintenanceMode: boolean
  maintenanceMessage: string
  defaultExpiry: number
  allowPermanentEmail: boolean
  pollIntervalSeconds: number
  roleLimits: Record<"emperor" | "duke" | "knight", string>
}

/** /api/config GET 的原始返回（字段可能缺失，逐项兜底） */
interface ConfigApiResponse {
  defaultRole?: Config["defaultRole"]
  emailDomains?: string
  adminContact?: string
  maxEmails?: string | number
  siteName?: string
  announcementEnabled?: boolean
  announcementText?: string
  allowRegistration?: boolean
  maintenanceMode?: boolean
  maintenanceMessage?: string
  defaultExpiry?: number
  allowPermanentEmail?: boolean
  pollIntervalSeconds?: number
  roleLimits?: Partial<Record<"emperor" | "duke" | "knight", string>>
}

interface ConfigStore {
  config: Config | null
  loading: boolean
  error: string | null
  fetch: () => Promise<void>
}

const useConfigStore = create<ConfigStore>((set) => ({
  config: null,
  loading: false,
  error: null,
  fetch: async () => {
    try {
      set({ loading: true, error: null })
      const res = await fetch("/api/config")
      if (!res.ok) throw new Error("获取配置失败")
      const data = await res.json() as ConfigApiResponse
      const emailDomains = data.emailDomains || "moemail.app"
      const defaultExpiry = EXPIRY_OPTIONS.some((option) => option.value === data.defaultExpiry)
        ? (data.defaultExpiry as number)
        : SITE_CONFIG_DEFAULTS.DEFAULT_EXPIRY_MS
      const pollIntervalSeconds =
        typeof data.pollIntervalSeconds === "number" &&
        Number.isInteger(data.pollIntervalSeconds) &&
        data.pollIntervalSeconds >= 3 &&
        data.pollIntervalSeconds <= 120
          ? data.pollIntervalSeconds
          : SITE_CONFIG_DEFAULTS.POLL_INTERVAL_SECONDS
      set({
        config: {
          defaultRole: data.defaultRole || ROLES.CIVILIAN,
          emailDomains,
          emailDomainsArray: emailDomains.split(','),
          adminContact: data.adminContact || "",
          maxEmails: Number(data.maxEmails) || EMAIL_CONFIG.MAX_ACTIVE_EMAILS,
          siteName: data.siteName?.trim() || SITE_CONFIG_DEFAULTS.SITE_NAME,
          announcementEnabled: data.announcementEnabled ?? SITE_CONFIG_DEFAULTS.ANNOUNCEMENT_ENABLED,
          announcementText: data.announcementText || "",
          allowRegistration: data.allowRegistration ?? SITE_CONFIG_DEFAULTS.ALLOW_REGISTRATION,
          maintenanceMode: data.maintenanceMode ?? SITE_CONFIG_DEFAULTS.MAINTENANCE_MODE,
          maintenanceMessage: data.maintenanceMessage || "",
          defaultExpiry,
          allowPermanentEmail: data.allowPermanentEmail ?? SITE_CONFIG_DEFAULTS.ALLOW_PERMANENT_EMAIL,
          pollIntervalSeconds,
          roleLimits: {
            emperor: data.roleLimits?.emperor ?? "",
            duke: data.roleLimits?.duke ?? "",
            knight: data.roleLimits?.knight ?? "",
          }
        },
        loading: false
      })
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "获取配置失败",
        loading: false
      })
    }
  }
}))

export function useConfig() {
  const store = useConfigStore()

  useEffect(() => {
    if (!store.config && !store.loading) {
      store.fetch()
    }
  }, [store.config, store.loading])

  return store
}
