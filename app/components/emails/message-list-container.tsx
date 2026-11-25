"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Send, Inbox } from "lucide-react"
import { Tabs, SlidingTabsList, SlidingTabsTrigger, TabsContent } from "@/components/ui/tabs"
import { MessageList } from "./message-list"
import { useSendPermission } from "@/hooks/use-send-permission"

interface MessageListContainerProps {
  email: {
    id: string
    address: string
  }
  onMessageSelect: (messageId: string | null, messageType?: 'received' | 'sent') => void
  selectedMessageId?: string | null
  /** 全局搜索命中已发送邮件时，外部把 Tab 切到 sent（否则中栏仍停留在收件箱） */
  selectedMessageType?: 'received' | 'sent'
  refreshTrigger?: number
}

export function MessageListContainer({ email, onMessageSelect, selectedMessageId, selectedMessageType, refreshTrigger }: MessageListContainerProps) {
  const t = useTranslations("emails.messages")
  const [activeTab, setActiveTab] = useState<'received' | 'sent'>('received')
  const { canSend: canSendEmails } = useSendPermission()

  useEffect(() => {
    if (selectedMessageType && selectedMessageType !== activeTab) {
      setActiveTab(selectedMessageType)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMessageType, selectedMessageId])

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId as 'received' | 'sent')
    onMessageSelect(null)
  }

  return (
    <div className="h-full flex flex-col">
      {canSendEmails ? (
        <Tabs value={activeTab} onValueChange={handleTabChange} className="h-full flex flex-col">
          <div className="p-2 border-b border-primary/20">
            <SlidingTabsList>
              <SlidingTabsTrigger value="received">
                <Inbox className="h-4 w-4" />
                {t("received")}
              </SlidingTabsTrigger>
              <SlidingTabsTrigger value="sent">
                <Send className="h-4 w-4" />
                {t("sent")}
              </SlidingTabsTrigger>
            </SlidingTabsList>
          </div>
          
          <TabsContent value="received" className="flex-1 overflow-hidden m-0">
            <MessageList
              email={email}
              messageType="received"
              onMessageSelect={onMessageSelect}
              selectedMessageId={selectedMessageId}
            />
          </TabsContent>
          
          <TabsContent value="sent" className="flex-1 overflow-hidden m-0">
            <MessageList
              email={email}
              messageType="sent"
              onMessageSelect={onMessageSelect}
              selectedMessageId={selectedMessageId}
              refreshTrigger={refreshTrigger}
            />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="flex-1 overflow-hidden">
          <MessageList
            email={email}
            messageType="received"
            onMessageSelect={onMessageSelect}
            selectedMessageId={selectedMessageId}
          />
        </div>
      )}
    </div>
  )
} 