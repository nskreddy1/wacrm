-- Conversation language (multilingual support, ADR-002 §12).
--
-- `ai_language` records the customer's detected language as a lowercase
-- BCP-47-ish tag, classified by the model in the same [[META]] tail that
-- already carries sentiment — so detection costs zero extra tokens.
--
-- Script matters as much as language for our market, so romanized
-- code-switching gets its own subtags rather than being collapsed into
-- the base language:
--   'hi'       Hindi (Devanagari)      'hi-latn'  Hinglish (romanized)
--   'ta'       Tamil                   'ta-latn'  Tanglish (romanized)
--   'kn'       Kannada                 'ml'       Malayalam
--   'en'       English                 ... any other tag the model emits
--
-- Nullable on purpose: NULL means "not classified yet" (pre-migration
-- rows, or a model that ignored the instruction), never "English".
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_language TEXT;

-- Reporting: "conversations by language over time" and agent routing
-- ("who speaks Tamil?") both filter accounts first, then language.
CREATE INDEX IF NOT EXISTS idx_conversations_ai_language
  ON public.conversations (account_id, ai_language)
  WHERE ai_language IS NOT NULL;

COMMENT ON COLUMN public.conversations.ai_language IS
  'Customer language classified by the AI in the [[META]] tail (lowercase BCP-47-ish, e.g. hi, hi-latn, ta, en). NULL = not yet classified.';
