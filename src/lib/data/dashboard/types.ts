export type DashboardData = {
  metrics: Array<{ label: string; value: string; change: string; detail: string }>
  workload: Array<{ name: string; open: number; status: string }>
  activity: Array<{ title: string; time: string; type: string }>
  volume: number[]
}
