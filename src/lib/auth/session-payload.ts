import "server-only";

import { getCurrentAccount } from "@/lib/auth/account";
import type { AccountRole } from "@/lib/auth/roles";
import { getDataSource } from "@/lib/data/runtime";

export type SessionProfile = {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  role: string | null;
  beta_features: string[];
  account_id: string;
  account_role: AccountRole;
  is_super_admin: boolean;
};

export type SessionAccount = {
  id: string;
  name: string;
  default_currency: string | null;
};

export type SessionUser = {
  id: string;
  email: string | null;
  created_at: string | null;
};

export type SessionPayload = {
  data: {
    user: SessionUser;
    profile: SessionProfile;
    account: SessionAccount;
  };
  meta: { source: "mock" | "supabase" };
};

/**
 * Builds the viewer's full session payload (user + profile + account)
 * in a single place so BOTH the `/api/v1/session` route handler and
 * the dashboard server layout return the exact same shape.
 *
 * PERF: the dashboard layout calls this on the server and hands the
 * result to the client `AuthProvider` as SWR fallbackData — so the
 * very first paint after login already renders the real account name,
 * avatar, and role-gated UI instead of "Account" placeholders that
 * pop in once a client-side fetch resolves. `getCurrentAccount()` is
 * request-cached, so the layout's role resolution and this payload
 * share the same underlying auth work.
 *
 * Throws (UnauthorizedError / ForbiddenError / query errors) exactly
 * like the previous inline route logic — callers decide whether to
 * convert to an HTTP response (route) or a null fallback (layout).
 */
export async function getSessionPayload(): Promise<SessionPayload> {
  const source = getDataSource();
  const context = await getCurrentAccount();

  const [profileResult, accountResult] = await Promise.all([
    context.supabase
      .from("profiles")
      .select(
        "user_id, full_name, email, avatar_url, role, beta_features, account_id, account_role, is_super_admin, created_at",
      )
      .eq("user_id", context.userId)
      .single(),
    context.supabase
      .from("accounts")
      .select("id, name, default_currency")
      .eq("id", context.accountId)
      .single(),
  ]);

  const { data: profile, error: profileError } = profileResult;
  if (profileError) throw profileError;

  const { data: account, error: accountError } = accountResult;
  if (accountError) throw accountError;

  return {
    data: {
      user: {
        id: context.userId,
        email: profile.email,
        created_at: profile.created_at,
      },
      profile: { ...profile, id: profile.user_id },
      account,
    },
    meta: { source },
  };
}
