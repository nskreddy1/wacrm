import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import {
  BUILT_IN_BOT_TEMPLATES,
  isBotTone,
  type BotTemplate,
} from '@/lib/ai/bot-templates'

/**
 * GET /api/ai/bots/templates
 *
 * The full template catalog: built-in templates shipped in code merged
 * with published `ai_bot_templates` rows (admin-managed, RLS lets any
 * authenticated user read published rows). A DB row with the same key
 * as a built-in overrides it — lets platform operators hotfix a
 * shipped template without a deploy.
 */
export async function GET() {
  try {
    const { supabase } = await getCurrentAccount()

    const { data, error } = await supabase
      .from('ai_bot_templates')
      .select(
        'key, name, description, emoji, category, system_prompt, tone, greeting_message, sort_order',
      )
      .eq('is_published', true)
      .order('sort_order', { ascending: true })

    if (error) {
      // Catalog rows are a bonus — the built-ins always work.
      console.error('[ai/bots/templates GET] fetch error:', error)
    }

    const catalog: BotTemplate[] = (data ?? []).map((row) => ({
      key: row.key,
      name: row.name,
      emoji: row.emoji ?? '🤖',
      category: row.category ?? 'other',
      description: row.description ?? '',
      systemPrompt: row.system_prompt,
      tone: isBotTone(row.tone) ? row.tone : 'friendly',
      greetingMessage: row.greeting_message ?? null,
      source: 'catalog' as const,
    }))

    const catalogKeys = new Set(catalog.map((t) => t.key))
    const templates = [
      ...BUILT_IN_BOT_TEMPLATES.filter((t) => !catalogKeys.has(t.key)),
      ...catalog,
    ]

    return NextResponse.json({ templates })
  } catch (err) {
    return toErrorResponse(err)
  }
}
