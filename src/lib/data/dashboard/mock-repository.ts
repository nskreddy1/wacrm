import "server-only"

export type DashboardData = {
  metrics: Array<{ label: string; value: string; change: string; detail: string }>
  workload: Array<{ name: string; open: number; status: string }>
  activity: Array<{ title: string; time: string; type: string }>
  volume: number[]
}

const dashboard: DashboardData = {
  metrics: [
    { label: "Open conversations", value: "128", change: "+14%", detail: "18 need a reply" },
    { label: "New contacts", value: "42", change: "+8%", detail: "Last 30 days" },
    { label: "Pipeline value", value: "$83.1k", change: "+21%", detail: "24 active deals" },
    { label: "Median response", value: "4m 12s", change: "-32s", detail: "Across all agents" },
  ],
  workload: [
    { name: "Nora James", open: 22, status: "Online" },
    { name: "Sam Silva", open: 18, status: "Online" },
    { name: "Ravi Patel", open: 14, status: "Away" },
  ],
  activity: [
    { title: "Mia Chen replied to Customer care rollout", time: "4 min ago", type: "Message" },
    { title: "Priya Shah moved to Negotiation", time: "18 min ago", type: "Deal" },
    { title: "Summer follow-up campaign completed", time: "1 hr ago", type: "Broadcast" },
    { title: "Aarav Mehta booked a discovery call", time: "2 hrs ago", type: "Booking" },
  ],
  volume: [42, 58, 48, 74, 62, 86, 70, 92, 78, 108, 94, 118, 102, 126],
}

export function getMockDashboard(): DashboardData {
  return dashboard
}
