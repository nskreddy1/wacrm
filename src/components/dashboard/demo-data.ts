/**
 * Dashboard overview types + hardcoded demo data.
 *
 * TEMPORARY: this module drives the redesigned dashboard while the
 * design is being finalized. Once approved, the same `DashboardOverview`
 * shape will be produced by /api/v1/dashboard (Supabase repository) and
 * this file's DEMO_OVERVIEW will only back the mock runtime.
 */

export type Channel = "whatsapp" | "sms"

export type DashboardOverview = {
  kpis: {
    openConversations: number
    openConversationsDelta: number // vs previous 7d, percent
    unassigned: number
    newContacts30d: number
    newContactsDelta: number
    pipelineValue: number
    pipelineCurrency: string
    activeDeals: number
    messages7d: number
    messagesDelta: number
    responseRatePct: number
  }
  channels: Array<{
    channel: Channel
    openConversations: number
    messages7d: number
    inbound7d: number
    outbound7d: number
  }>
  /** 14 days of message volume, oldest first */
  volume: Array<{ day: string; whatsapp: number; sms: number }>
  broadcasts: {
    totals: { sent: number; delivered: number; read: number; replied: number; failed: number }
    whatsappEnabled: boolean
    recent: Array<{
      id: string
      name: string
      channel: Channel
      status: "sent" | "sending" | "scheduled" | "failed"
      totalRecipients: number
      sent: number
      delivered: number
      read: number
      failed: number
      createdAt: string
    }>
  }
  pipeline: {
    stages: Array<{ name: string; count: number; value: number }>
    wonValue30d: number
    wonCount30d: number
    lostCount30d: number
  }
  team: Array<{ userId: string; name: string; open: number; resolved7d: number }>
  /** 30 days, oldest first */
  contactsGrowth: Array<{ day: string; total: number; added: number }>
  activity: Array<{
    id: string
    title: string
    time: string
    type: "message" | "broadcast" | "deal" | "contact" | "booking"
    href: string
  }>
  /** next scheduled bookings, soonest first */
  bookings: Array<{
    id: string
    contact: string
    service: string
    /** e.g. "Today · 2:30 PM" */
    when: string
    channel: Channel
  }>
}

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

const VOLUME_WA = [42, 51, 38, 64, 58, 31, 24, 55, 69, 61, 74, 66, 43, 82]
const VOLUME_SMS = [28, 24, 31, 35, 29, 18, 14, 33, 38, 41, 36, 44, 27, 49]

const GROWTH_ADDED = [
  4, 6, 3, 8, 5, 2, 1, 7, 9, 6, 11, 8, 4, 3, 10, 12, 7, 5, 2, 9, 14, 11, 8, 6, 4, 13, 16, 10, 7, 12,
]

let runningTotal = 1240

export const DEMO_OVERVIEW: DashboardOverview = {
  kpis: {
    openConversations: 47,
    openConversationsDelta: 12,
    unassigned: 9,
    newContacts30d: 238,
    newContactsDelta: 18,
    pipelineValue: 128400,
    pipelineCurrency: "USD",
    activeDeals: 34,
    messages7d: 1493,
    messagesDelta: 9,
    responseRatePct: 92,
  },
  channels: [
    { channel: "whatsapp", openConversations: 31, messages7d: 918, inbound7d: 512, outbound7d: 406 },
    { channel: "sms", openConversations: 16, messages7d: 575, inbound7d: 301, outbound7d: 274 },
  ],
  volume: VOLUME_WA.map((wa, i) => ({
    day: daysAgo(13 - i),
    whatsapp: wa,
    sms: VOLUME_SMS[i],
  })),
  broadcasts: {
    totals: { sent: 4820, delivered: 4633, read: 3187, replied: 642, failed: 187 },
    whatsappEnabled: false,
    recent: [
      {
        id: "b1",
        name: "March promo — 20% off",
        channel: "sms",
        status: "sent",
        totalRecipients: 1850,
        sent: 1850,
        delivered: 1792,
        read: 1315,
        failed: 58,
        createdAt: daysAgo(1),
      },
      {
        id: "b2",
        name: "Appointment reminders",
        channel: "sms",
        status: "sent",
        totalRecipients: 640,
        sent: 640,
        delivered: 622,
        read: 505,
        failed: 18,
        createdAt: daysAgo(3),
      },
      {
        id: "b3",
        name: "Payment follow-up",
        channel: "sms",
        status: "sending",
        totalRecipients: 1200,
        sent: 830,
        delivered: 781,
        read: 402,
        failed: 49,
        createdAt: daysAgo(0),
      },
      {
        id: "b4",
        name: "New arrivals catalog",
        channel: "sms",
        status: "scheduled",
        totalRecipients: 2100,
        sent: 0,
        delivered: 0,
        read: 0,
        failed: 0,
        createdAt: daysAgo(0),
      },
    ],
  },
  pipeline: {
    stages: [
      { name: "New lead", count: 21, value: 48200 },
      { name: "Qualified", count: 14, value: 39600 },
      { name: "Proposal", count: 9, value: 26800 },
      { name: "Negotiation", count: 6, value: 13800 },
    ],
    wonValue30d: 42600,
    wonCount30d: 11,
    lostCount30d: 4,
  },
  team: [
    { userId: "u1", name: "Priya Sharma", open: 14, resolved7d: 52 },
    { userId: "u2", name: "Arjun Reddy", open: 11, resolved7d: 47 },
    { userId: "u3", name: "Sara Khan", open: 9, resolved7d: 38 },
    { userId: "u4", name: "David Chen", open: 4, resolved7d: 29 },
  ],
  contactsGrowth: GROWTH_ADDED.map((added, i) => {
    runningTotal += added
    return { day: daysAgo(29 - i), total: runningTotal, added }
  }),
  activity: [
    { id: "a1", title: "New reply from Ravi Kumar", time: "2m ago", type: "message", href: "/inbox" },
    { id: "a2", title: "Broadcast 'Payment follow-up' is sending", time: "18m ago", type: "broadcast", href: "/broadcasts" },
    { id: "a3", title: "Deal 'Acme retainer' moved to Negotiation", time: "1h ago", type: "deal", href: "/pipeline" },
    { id: "a4", title: "12 new contacts imported from CSV", time: "3h ago", type: "contact", href: "/contacts" },
    { id: "a5", title: "Booking confirmed with Meera Patel", time: "5h ago", type: "booking", href: "/bookings" },
    { id: "a6", title: "New SMS conversation from +1 415 555 0132", time: "6h ago", type: "message", href: "/inbox" },
    { id: "a7", title: "Deal 'Studio branding' marked as won", time: "8h ago", type: "deal", href: "/pipeline" },
    { id: "a8", title: "Broadcast 'Appointment reminders' completed", time: "1d ago", type: "broadcast", href: "/broadcasts" },
    { id: "a9", title: "5 contacts added via web form", time: "1d ago", type: "contact", href: "/contacts" },
  ],
  bookings: [
    { id: "bk1", contact: "Meera Patel", service: "Product demo", when: "Today · 2:30 PM", channel: "whatsapp" },
    { id: "bk2", contact: "James Wilson", service: "Onboarding call", when: "Today · 4:00 PM", channel: "sms" },
    { id: "bk3", contact: "Ananya Iyer", service: "Consultation", when: "Tomorrow · 10:15 AM", channel: "whatsapp" },
    { id: "bk4", contact: "Carlos Ruiz", service: "Follow-up review", when: "Tomorrow · 3:45 PM", channel: "sms" },
  ],
}
