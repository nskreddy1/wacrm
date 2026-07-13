const segment = (value: string) => encodeURIComponent(value)

export const routes = {
  home: "/",
  auth: {
    login: "/login",
    signup: "/signup",
    forgotPassword: "/forgot-password",
    resetPassword: "/reset-password",
    callback: "/auth/callback",
  },
  app: {
    dashboard: "/dashboard",
    account: (accountId: string) => `/accounts/${segment(accountId)}`,
    contacts: (accountId: string) => `/accounts/${segment(accountId)}/contacts`,
    contact: (accountId: string, contactId: string) =>
      `/accounts/${segment(accountId)}/contacts/${segment(contactId)}`,
    pipelines: (accountId: string) => `/accounts/${segment(accountId)}/pipelines`,
    pipeline: (accountId: string, pipelineId: string) =>
      `/accounts/${segment(accountId)}/pipelines/${segment(pipelineId)}`,
    invite: (token: string) => `/join/${segment(token)}`,
  },
  api: {
    service: (path: string) => `/api/service/${path.replace(/^\/+/, "")}`,
  },
} as const

export const authRouteSet = new Set<string>([
  routes.auth.login,
  routes.auth.signup,
  routes.auth.forgotPassword,
  routes.auth.resetPassword,
])
