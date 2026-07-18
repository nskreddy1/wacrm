// Client-side shape of an `ai_bots` row as returned by /api/ai/bots
// (snake_case, matches BOT_SELECT_COLUMNS — no secrets live on bots).

import type {
  BotTone,
  OutsideHoursBehavior,
  WorkingHours,
} from '@/lib/ai/types';

export interface BotRow {
  id: string;
  account_id: string;
  created_by: string | null;
  name: string;
  description: string | null;
  emoji: string | null;
  system_prompt: string;
  tone: BotTone;
  language: string;
  greeting_message: string | null;
  temperature: number | null;
  model_override: string | null;
  auto_reply_max_per_conversation: number | null;
  handoff_agent_id: string | null;
  working_hours: WorkingHours | null;
  outside_hours_behavior: OutsideHoursBehavior;
  away_message: string | null;
  use_knowledge_base: boolean;
  is_active: boolean;
  template_key: string | null;
  created_at: string;
  updated_at: string;
}

export const TONE_LABEL: Record<BotTone, string> = {
  professional: 'Professional',
  friendly: 'Friendly',
  casual: 'Casual',
  formal: 'Formal',
  playful: 'Playful',
};
