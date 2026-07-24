const segment = (value: string) => encodeURIComponent(value);

export const routes = {
  home: '/',
  auth: {
    login: '/login',
    signup: '/signup',
    forgotPassword: '/forgot-password',
    resetPassword: '/reset-password',
    callback: '/auth/callback',
  },
  app: {
    dashboard: '/dashboard',
    inbox: '/inbox',
    smsInbox: '/inbox/sms',
    contacts: '/contacts',
    contact: (contactId: string) => `/contacts?contact=${segment(contactId)}`,
    pipelines: '/pipelines',
    pipeline: (
      pipelineId: string,
      view: 'board' | 'list' | 'sheet' = 'board'
    ) => {
      const params = new URLSearchParams({ pipeline: pipelineId });
      if (view !== 'board') params.set('view', view);
      return `/pipelines?${params.toString()}`;
    },
    appointments: '/appointments',
    catalog: '/catalog',
    broadcasts: '/broadcasts',
    templates: '/templates',
    newBroadcast: '/broadcasts/new',
    broadcast: (broadcastId: string) => `/broadcasts/${segment(broadcastId)}`,
    automations: '/automations',
    newAutomation: '/automations/new',
    automation: (automationId: string) =>
      `/automations/${segment(automationId)}`,
    automationLogs: (automationId: string) =>
      `/automations/${segment(automationId)}/logs`,
    flows: '/flows',
    newFlow: '/flows?create=1',
    flow: (flowId: string) => `/flows/${segment(flowId)}`,
    flowRuns: (flowId: string) => `/flows/${segment(flowId)}/runs`,
    agents: '/agents',
    notifications: '/notifications',
    settings: '/settings',
    invite: (token: string) => `/join/${segment(token)}`,
  },
  api: {
    // Same-origin Next.js Route Handlers are the production API boundary.
    // Express (server/) is legacy/local-only: the old `/api/service/...`
    // proxy hop was removed so requests go browser -> Next.js -> Supabase
    // with no extra network hop. `account` maps to `/api/account`, etc.
    service: (path: string) => `/api/${path.replace(/^\/+/, '')}`,
  },
} as const;

export const canonicalAppRoutes = [
  routes.app.dashboard,
  routes.app.inbox,
  routes.app.contacts,
  routes.app.pipelines,
  routes.app.appointments,
  routes.app.catalog,
  routes.app.broadcasts,
  routes.app.templates,
  routes.app.newBroadcast,
  routes.app.automations,
  routes.app.newAutomation,
  routes.app.flows,
  routes.app.agents,
  routes.app.notifications,
  routes.app.settings,
] as const;

export const authRouteSet = new Set<string>([
  routes.auth.login,
  routes.auth.signup,
  routes.auth.forgotPassword,
  routes.auth.resetPassword,
]);

export function isCanonicalAppPath(pathname: string) {
  return canonicalAppRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}
