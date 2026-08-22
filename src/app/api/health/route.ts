// LIVENESS ONLY (plan Task 5, ADR-INFRA-001 §6, NFR-002).
// Answers "is the Worker alive?" — never calls Supabase/Redis/anything.
// Uptime monitors point HERE; dependency degradation must not read as
// "application dead". Dependency health lives at /api/health/dependencies.
// The promotion workflow (Task 7) polls this route post-deploy; release
// identity (RELEASE_VERSION / GIT_SHA) is injected at deploy time (NFR-006).
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({
    ok: true,
    release: process.env.RELEASE_VERSION ?? 'dev',
    git_sha: process.env.GIT_SHA ?? 'dev',
  });
}
