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
  priority: "Hot" | "Warm" | "Normal"
  probability: number
  createdAt: string
  source: string
  nextStep: string
  description: string
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
  { id: "d1", title: "Annual support plan", contact: "Ted Watson", company: "Northstar Labs", value: 12800, stageId: "qualification", owner: "Sam Silva", due: "2026-07-14", activity: "Reply due today", priority: "Hot", probability: 20, createdAt: "2026-07-02", source: "Website", nextStep: "Confirm discovery call", description: "Annual WhatsApp support and service workspace." },
  { id: "d2", title: "Customer care rollout", contact: "Mia Chen", company: "Acme Retail", value: 24600, stageId: "analysis", owner: "Nora James", due: "2026-07-16", activity: "Call booked", priority: "Warm", probability: 40, createdAt: "2026-07-04", source: "Referral", nextStep: "Map support queues", description: "Multi-team customer care rollout across retail locations." },
  { id: "d3", title: "WhatsApp commerce pilot", contact: "Leo Martin", company: "Fable Goods", value: 8400, stageId: "proposal", owner: "Sam Silva", due: "2026-07-18", activity: "Proposal viewed", priority: "Normal", probability: 60, createdAt: "2026-07-05", source: "Campaign", nextStep: "Review proposal", description: "Pilot commerce workflows for the digital sales team." },
  { id: "d4", title: "Regional sales workspace", contact: "Priya Shah", company: "Brightline", value: 31900, stageId: "negotiation", owner: "Ravi Patel", due: "2026-07-12", activity: "Legal review", priority: "Hot", probability: 80, createdAt: "2026-06-28", source: "Partner", nextStep: "Approve terms", description: "Enterprise regional pipeline with role-based access." },
  { id: "d5", title: "Concierge automation", contact: "Owen Brooks", company: "Staywell", value: 17200, stageId: "won", owner: "Nora James", due: "2026-07-08", activity: "Handoff ready", priority: "Warm", probability: 100, createdAt: "2026-06-22", source: "Upsell", nextStep: "Customer handoff", description: "Automated concierge journeys and booking follow-up." },
  { id: "d6", title: "Lead routing setup", contact: "Sofia Baker", company: "Orbit Works", value: 6200, stageId: "qualification", owner: "Ravi Patel", due: "2026-07-20", activity: "New message", priority: "Normal", probability: 20, createdAt: "2026-07-10", source: "Website", nextStep: "Qualify requirements", description: "Lead routing and round-robin assignment setup." },
  { id: "d7", title: "Healthcare intake expansion", contact: "Sophia Patel", company: "Evergreen Health", value: 42800, stageId: "analysis", owner: "Sam Silva", due: "2026-07-24", activity: "Security review", priority: "Hot", probability: 45, createdAt: "2026-07-08", source: "Referral", nextStep: "Complete security review", description: "Secure intake and appointment workflows for five clinics." },
  { id: "d8", title: "Renewal messaging program", contact: "Ava Rodriguez", company: "Acme Retail", value: 14600, stageId: "proposal", owner: "Nora James", due: "2026-07-29", activity: "Pricing requested", priority: "Warm", probability: 65, createdAt: "2026-07-09", source: "Renewal", nextStep: "Send revised pricing", description: "Renewal reminders and customer retention automations." },
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
