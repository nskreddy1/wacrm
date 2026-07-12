export type DemoDeal = {
  id: string
  title: string
  contact: string
  company: string
  value: number
  stageId: string
  owner: string
  due: string
  activity: string
}

export type DemoStage = {
  id: string
  name: string
  color: "blue" | "amber" | "cyan" | "green" | "red"
  description: string
}

export const demoStages: DemoStage[] = [
  { id: "qualification", name: "Qualification", color: "blue", description: "New opportunities being validated" },
  { id: "analysis", name: "Needs analysis", color: "cyan", description: "Understanding scope and priorities" },
  { id: "proposal", name: "Proposal / pricing", color: "amber", description: "Commercial offer shared" },
  { id: "negotiation", name: "Negotiation", color: "blue", description: "Terms and stakeholders aligned" },
  { id: "won", name: "Closed won", color: "green", description: "Successfully converted" },
  { id: "lost", name: "Closed lost", color: "red", description: "Not moving forward" },
]

export const demoDeals: DemoDeal[] = [
  { id: "d1", title: "Annual support plan", contact: "Aarav Mehta", company: "Northstar Labs", value: 12800, stageId: "qualification", owner: "Sam", due: "Jul 14", activity: "Reply due today" },
  { id: "d2", title: "Customer care rollout", contact: "Mia Chen", company: "Acme Retail", value: 24600, stageId: "analysis", owner: "Nora", due: "Jul 16", activity: "Call booked" },
  { id: "d3", title: "WhatsApp commerce pilot", contact: "Leo Martin", company: "Fable Goods", value: 8400, stageId: "proposal", owner: "Sam", due: "Jul 18", activity: "Proposal viewed" },
  { id: "d4", title: "Regional sales workspace", contact: "Priya Shah", company: "Brightline", value: 31900, stageId: "negotiation", owner: "Ravi", due: "Jul 12", activity: "Legal review" },
  { id: "d5", title: "Concierge automation", contact: "Owen Brooks", company: "Staywell", value: 17200, stageId: "won", owner: "Nora", due: "Jul 08", activity: "Handoff ready" },
  { id: "d6", title: "Lead routing setup", contact: "Sofia Reyes", company: "Juniper Co", value: 6200, stageId: "qualification", owner: "Ravi", due: "Jul 20", activity: "New message" },
]

export const dashboardData = {
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
}

export const demoSession = {
  user: { id: "demo-user", email: "sam@acme.example" },
  profile: { id: "demo-profile", full_name: "Sam Silva", email: "sam@acme.example", avatar_url: null, role: "owner", beta_features: [], account_id: "demo-workspace", account_role: "owner" as const },
  account: { id: "demo-workspace", name: "Acme Support", default_currency: "USD" },
}
