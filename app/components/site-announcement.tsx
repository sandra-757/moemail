"use client"

import { Megaphone } from "lucide-react"
import { useConfig } from "@/hooks/use-config"

/**
 * 站点公告横幅：管理员在控制台开启 ANNOUNCEMENT_ENABLED 且填写文本时显示。
 */
export function SiteAnnouncement() {
  const { config } = useConfig()

  if (!config?.announcementEnabled) return null
  const text = config.announcementText?.trim()
  if (!text) return null

  return (
    <div className="w-full bg-primary/10 border-b border-primary/20 text-primary">
      <div className="container mx-auto px-4 lg:px-8 max-w-[1600px] py-2 flex items-center justify-center gap-2 text-sm">
        <Megaphone className="w-4 h-4 shrink-0" />
        <span className="truncate">{text}</span>
      </div>
    </div>
  )
}
