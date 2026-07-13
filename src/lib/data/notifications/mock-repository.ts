import "server-only"

import type { Notification } from "@/types"

const now = Date.now()
const notifications: Notification[] = [
  {
    id: "notification-1",
    account_id: "demo-workspace",
    user_id: "demo-user",
    type: "conversation_assigned",
    title: "Mia Chen was assigned to you",
    body: "Customer care rollout needs a reply.",
    conversation_id: "conversation-1",
    read_at: null,
    created_at: new Date(now - 4 * 60_000).toISOString(),
  },
  {
    id: "notification-2",
    account_id: "demo-workspace",
    user_id: "demo-user",
    type: "conversation_assigned",
    title: "Priya Shah was assigned to you",
    body: "Follow up on the regional sales workspace.",
    conversation_id: "conversation-2",
    read_at: new Date(now - 35 * 60_000).toISOString(),
    created_at: new Date(now - 40 * 60_000).toISOString(),
  },
]

export function listMockNotifications() {
  return notifications.map((notification) => ({ ...notification }))
}

export function markMockNotificationsRead(ids?: string[]) {
  const selected = ids ? new Set(ids) : null
  const readAt = new Date().toISOString()
  for (const notification of notifications) {
    if (!selected || selected.has(notification.id)) notification.read_at = readAt
  }
  return listMockNotifications()
}
