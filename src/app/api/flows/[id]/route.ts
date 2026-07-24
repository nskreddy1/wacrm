import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, toErrorResponse } from '@/features/auth/lib/account'
import { supabaseAdmin } from '@/features/flows/lib/admin-client'
import { validateFlowForActivation } from '@/features/flows/lib/validate'

/**
 * GET   /api/flows/[id]  — fetch one flow with its nodes.
 * PUT   /api/flows/[id]  — replace name/trigger/entry/fallback + the
 *                          full node graph (delete-then-insert under
 *                          the hood; not atomic, but the runner is
 *                          resilient to mid-edit reads — node_not_found
 *                          gracefully ends the run).
 * DELETE /api/flows/[id] — hard delete (RLS+CASCADE clean up nodes,
 *                          runs, events).
 *
 * All three require a signed-in caller who owns the flow. Flows is in
 * soft-GA — the beta gate that previously 404'd non-beta accounts is
 * gone; the "Beta" label in the UI is the only remaining signal.
 */

async function requireOwnership(
  flowId: string,
): Promise<
  | {
      ok: true
      userId: string
      supabase: Awaited<ReturnType<typeof createClient>>
    }
  | { ok: false; status: number; body: { error: string } }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, status: 401, body: { error: 'Unauthorized' } }
  }
  // RLS scopes this to the caller — a flow owned by another user
  // returns null (404 below).
  const { data: flow } = await supabase
    .from('flows')
    .select('id')
    .eq('id', flowId)
    .maybeSingle()
  if (!flow) {
    return { ok: false, status: 404, body: { error: 'Not found' } }
  }
  return { ok: true, userId: user.id, supabase }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const guard = await requireOwnership(id)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })
  const { supabase } = guard

  const [{ data: flow }, { data: nodes }] = await Promise.all([
    supabase.from('flows').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('flow_nodes')
      .select('*')
      .eq('flow_id', id)
      .order('created_at', { ascending: true }),
  ])
  if (!flow) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({ flow, nodes: nodes ?? [] })
}

interface PutBody {
  name?: string
  description?: string | null
  trigger_type?: 'keyword' | 'first_inbound_message' | 'manual'
  trigger_config?: Record<string, unknown>
  entry_node_id?: string | null
  fallback_policy?: Record<string, unknown>
  nodes?: Array<{
    node_key: string
    node_type: string
    config: Record<string, unknown>
    position_x?: number
    position_y?: number
  }>
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  // Writes require at least `agent`. Retain the account id because the
  // atomic RPC uses the service role and must independently scope itself.
  let accountId: string
  try {
    accountId = (await requireRole('agent')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const guard = await requireOwnership(id)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const body = (await request.json().catch(() => null)) as PutBody | null
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (body.name !== undefined && !body.name.trim()) {
    return NextResponse.json(
      { error: 'name cannot be empty' },
      { status: 400 },
    )
  }

  const admin = supabaseAdmin()
  const [{ data: existingFlow }, { data: existingNodes }] = await Promise.all([
    admin
      .from('flows')
      .select('name, status, trigger_type, trigger_config, entry_node_id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle(),
    admin.from('flow_nodes').select('node_key, node_type, config').eq('flow_id', id),
  ])
  if (!existingFlow) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const flowPatch: Record<string, unknown> = {}
  if (body.name !== undefined) flowPatch.name = body.name.trim()
  if (body.description !== undefined) flowPatch.description = body.description
  if (body.trigger_type !== undefined) flowPatch.trigger_type = body.trigger_type
  if (body.trigger_config !== undefined) flowPatch.trigger_config = body.trigger_config
  if (body.entry_node_id !== undefined) flowPatch.entry_node_id = body.entry_node_id
  if (body.fallback_policy !== undefined) flowPatch.fallback_policy = body.fallback_policy

  // Active flows must remain executable after every edit. Drafts remain
  // intentionally permissive so incomplete work can still be saved.
  if (existingFlow.status === 'active') {
    const effectiveFlow = {
      name: (body.name ?? existingFlow.name) as string,
      trigger_type: (body.trigger_type ?? existingFlow.trigger_type) as PutBody['trigger_type'] & string,
      trigger_config: (body.trigger_config ?? existingFlow.trigger_config) as Record<string, unknown>,
      entry_node_id: body.entry_node_id !== undefined ? body.entry_node_id : existingFlow.entry_node_id,
    }
    const effectiveNodes = body.nodes ?? existingNodes ?? []
    const issues = validateFlowForActivation(effectiveFlow, effectiveNodes)
    if (issues.some((issue) => issue.severity === 'error')) {
      return NextResponse.json(
        { error: 'Cannot keep an active flow with invalid configuration', issues },
        { status: 422 },
      )
    }
  }

  const normalizedNodes = body.nodes?.map((node) => ({
    node_key: node.node_key,
    node_type: node.node_type,
    config: node.config,
    position_x: node.position_x ?? 0,
    position_y: node.position_y ?? 0,
  }))
  const { error: saveError } = await admin.rpc('save_flow_graph_atomic', {
    p_flow_id: id,
    p_account_id: accountId,
    p_patch: flowPatch,
    p_nodes: normalizedNodes ?? null,
  })
  if (saveError) {
    return NextResponse.json({ error: saveError.message }, { status: 500 })
  }

  // Re-fetch and return the new state — the editor uses the response
  // to reconcile its local form state.
  const [{ data: flow }, { data: nodes }] = await Promise.all([
    admin.from('flows').select('*').eq('id', id).maybeSingle(),
    admin
      .from('flow_nodes')
      .select('*')
      .eq('flow_id', id)
      .order('created_at', { ascending: true }),
  ])
  return NextResponse.json({ flow, nodes: nodes ?? [] })
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  // Writes require at least `agent` — see the PUT handler note. The
  // service-role client below bypasses the agent-gated flows_delete RLS.
  try {
    await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const guard = await requireOwnership(id)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  // CASCADE on flow_nodes / flow_runs / flow_run_events handles the
  // children. Active runs end abruptly — there's no graceful "drain"
  // mechanism in v1, but that's intentional: deleting a flow is a
  // deliberate destructive action and the partial unique index will
  // free up the contact for new triggers immediately.
  const { error } = await supabaseAdmin().from('flows').delete().eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

