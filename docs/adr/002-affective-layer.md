# ADR-002: Affective Layer — emotion, empathy, self-learning, handoff

**Status:** Proposed — architecture only, no implementation
**Date:** 2026-07-27
**Supersedes:** the keyword-matching `sentiment.ts` stub from this session
**Deciders:** product owner

---

## 1. Context: what is actually wrong today

Three findings from reading the current pipeline. The third is the one that matters.

**a) Emotion is a single label with no memory.**
`generate.ts` returns `sentiment: 'angry' | 'frustrated' | 'neutral' | 'happy'`,
written to `conversations.ai_sentiment` — one column, overwritten every turn.
So we cannot answer "was this customer calmer at the end than the start?",
which is the only question that matters for reporting. No history, no trend,
no reports. A customer who arrives furious and leaves happy looks identical
to one who arrives neutral and leaves furious.

**b) Empathy is static prose chosen once at signup.**
`persona.ts` has a genuinely good `TONE_BLOCKS` matrix, and it already
contains frustrated-customer handling per tone. But the tone is picked
**once** by the client in a form, and the frustration guidance is fixed
English prose. The same words are sent whether the customer is mildly
impatient or threatening to sue. Emotion is detected but never *steers*
generation — it is recorded and discarded.

**c) My `sentiment.ts` was a keyword lookup — it must not ship.**
I wrote a static word→label map. It cannot handle sarcasm ("great, just
great"), negation ("not happy"), Hinglish/code-switching (your actual user
base), intensity, or escalation across turns. It never improves. Deleting
it is part of this ADR's action items. Naming this plainly because the
architecture below only makes sense once we agree the stub is not a
foundation to build on.

---

## 2. The core architectural decision

> **Emotion is a first-class state machine, not a field on a message.**

Today emotion is an *output* of text generation. It must become an
**input** to it, held in a layer that owns no channel-specific code.

```
                 ┌──────────────────────────────┐
  WhatsApp ──┐   │      AFFECTIVE STATE         │
  SMS      ──┼──▶│  emotion vector + intensity  │──┐
  (voice)  ──┘   │  + trend + EMA smoothing     │  │
  (email)  ──┘   └──────────────────────────────┘  │
       signals                                      ▼
                                        ┌────────────────────┐
                                        │  RESPONSE POLICY   │
                                        │ posture, urgency,  │
                                        │ empathy strategy   │
                                        └────────────────────┘
                                                   │
                              ┌────────────────────┴─────────┐
                              ▼                              ▼
                     text generation                  (future) TTS
                     (dual-stage)                     prosody params
```

**Why this shape, and why now.** The 2026 voice research is explicit that
production voice stacks run "a state tracker computing a rolling EMA of
emotion signals" that drives *both* prompt injection and TTS warmth/pace.
If we instead bolt emotion onto the WhatsApp text path, adding voice later
means rewriting it. The layer must be modality-agnostic **from day one** —
text contributes lexical signals, voice will contribute prosody (pitch,
RMS energy, speaking rate), and both fuse into the same state. This is the
single highest-leverage decision in this document, and it costs nothing
extra today.

---

## 3. Emotion representation

Replace the 4-way enum. Research is unambiguous: GoEmotions-style detection
is **multi-label with sigmoid activation, never softmax** — a customer can
be simultaneously angry *and* disappointed *and* hopeful, and softmax
forces a false single winner.

```ts
interface AffectiveState {
  emotions: Partial<Record<Emotion, number>>; // independent 0–1 confidences
  intensity: number;      // 0–1 overall arousal
  valence: number;        // -1 negative … +1 positive
  trend: 'escalating' | 'stable' | 'de-escalating';
  smoothed: number;       // EMA of valence — resists single-message noise
  confidence: number;     // low ⇒ do not act on it
  source: 'lexical' | 'specialist' | 'prosody' | 'fused';
}

type Emotion =
  | 'anger' | 'frustration' | 'disappointment' | 'confusion'
  | 'anxiety' | 'urgency' | 'gratitude' | 'satisfaction' | 'neutral';
```

Three deliberate choices:

- **`trend` is the escalation trigger, not absolute emotion.** A customer
  who opens angry and is calming down needs *less* intervention than one
  drifting from neutral to annoyed. Absolute labels miss this entirely;
  it is the difference between a system that reacts and one that anticipates.
- **`smoothed` (EMA) prevents thrash.** One clipped "ok." should not flip
  posture. Raw per-message emotion is noisy; the EMA is what policy reads.
- **`confidence` gates action.** Low confidence ⇒ behave as neutral. An
  over-empathetic reply to a neutral question ("I'm so sorry you're going
  through this" → "what are your hours?") reads unhinged and erodes trust
  faster than flat replies. Explicitly designing for the false-positive
  direction, because it is the one that embarrasses the client.

---

## 4. Detection: staged, not all-or-nothing

You asked about self-hosting an open-source model. I researched the
substrate and found a hard constraint that shapes the answer.

**Supabase Edge Functions: 256 MB memory, 2 s CPU per request.** They ship
a native Rust ONNX runtime, but the built-in `Supabase.ai.Session` only
exposes `gte-small` (embeddings). `RawSession` accepts transformers.js-compatible
ONNX models — an int8-quantized RoBERTa-base is ~125 MB, so it *fits*, but
with little headroom and cold-start risk. Real LLMs need the Ollama path,
which is early-access only.

So: staged, and each stage earns the next.

| Stage | Mechanism | Cost | Why |
|---|---|---|---|
| **1. Lexical (now)** | Extend the existing `generateObject` schema to emit the full multi-label vector in the reply call | **Zero extra calls** | We already make this call. Modern LLMs beat older fine-tuned classifiers on nuance, sarcasm, and Hinglish. |
| **2. Specialist (when volume justifies)** | Quantized ONNX GoEmotions in an Edge Function, or an external GPU service | ~125 MB, 100–200 ms | Cheaper per call at scale; independent of reply generation; runs on *inbound* messages even when AI is silent. |
| **3. Prosody (with voice)** | Native S2S metadata, or Hume-style API, or pitch/RMS/rate features | — | Fuses into the same state via `source: 'fused'`. |

**Recommendation: start at Stage 1.** It requires no new infrastructure,
costs nothing per message, and — critically — it is the stage that lets us
*collect labelled data*. We cannot fine-tune or even evaluate a specialist
model without a ground-truth corpus, and today we have none. Stage 1
produces exactly that corpus. Jumping to Stage 2 now means self-hosting a
model we cannot measure. **Stage 1 is the prerequisite for Stage 2, not an
alternative to it.**

---

## 5. Empathy: dual-stage generation

Current design asks one LLM call to be simultaneously accurate and
emotionally attuned. The 2025–26 literature names the failure mode
**specialization bias**: single-pass models sacrifice factual grounding for
emotional language, or vice versa. The mitigation is **dual-stage
generation** — decouple fact-drafting from empathy-tuning.

```
Stage A  FACTS     grounded draft: KB + CRM + policy. Correctness only.
                   Constrained to business facts. No emotional styling.
                        ↓
Stage B  EMPATHY   rewrite conditioned on AffectiveState + chosen strategy.
                   May NOT introduce new facts — style and framing only.
```

The Stage-B constraint ("no new facts") is the load-bearing safety
property: it makes the empathy pass unable to hallucinate a refund policy
while trying to sound warm. It also gives us a cheap invariant to test.

**Empathy strategies** (from emotional-validation theory, selected by
state — not one generic "be nice"):

| State | Strategy | Shape |
|---|---|---|
| anger + escalating | **Validate then act** | Acknowledge fault, no hedging, concrete next step, zero cheerfulness, no emoji |
| frustration + repeated | **Acknowledge the repetition** | Name that they have asked before; never restate what already failed |
| confusion | **Simplify and check** | Shorter sentences, one step at a time, confirm understanding |
| anxiety / urgency | **Certainty and timeline** | Exact commitments, no vague "shortly" |
| gratitude | **Match warmth, close cleanly** | Brief, do not over-extend |

Cost note: Stage B is a second call. Skip it when state is confidently
neutral (the majority of traffic) — so the added cost lands only on the
conversations where it changes the outcome.

---

## 6. Self-learning — the part your product is uniquely set up for

This is the strongest finding of the research, and it comes from your own UI.

Your composer already reads: *"Tap the ✨ to draft a reply with AI — you can
edit it before sending."* You have `/api/ai/draft`. **Every human edit of an
AI draft is a labelled preference pair** — AI text vs. the text a human
actually judged fit to send. That is the highest-quality feedback signal in
support ML, and you are currently discarding it on every single edit.

The **PRELUDE / CIPHER** framework formalises this: treat user edits as
cost-minimisation, measure the gap with Levenshtein edit distance, and
infer latent preferences. Related work (Seedentia) extracts domain
terminology from character- and word-level edit distance and injects it
back into system prompts.

```
agent opens AI draft ──▶ edits ──▶ sends
                            │
                            ▼
              diff(draft, sent) + AffectiveState at that turn
                            │
                            ▼
              ┌──────────────────────────────────┐
              │  per-account learned style delta │
              │  • preferred/banned phrasings    │
              │  • verbosity, formality, emoji   │
              │  • terminology corrections       │
              │  • per-emotion tone corrections  │
              └──────────────────────────────────┘
                            │
                     injected into Stage B
```

**Decision: learn in prompt space, not weight space.** Both Human-Watch
and CIPHER revise *prompts* rather than fine-tuning, and for us that is
strictly better:

- **Per-tenant by construction.** Every account learns its own voice; no
  cross-tenant leakage, which a shared fine-tune would risk.
- **Inspectable and reversible.** A learned delta is human-readable text an
  admin can view, edit, or reject. A fine-tuned weight is not. For an
  enterprise selling to businesses, "why did it say that?" must be answerable.
- **No training infrastructure, no GPUs, no retraining lag.** Improvements
  land within one conversation.
- **Cold-start safe.** Zero edits ⇒ empty delta ⇒ exactly today's behaviour.

This is genuine learning from real human judgment — it just stores what it
learned as text instead of weights. It also composes with the emotion layer:
we learn *per-emotion* corrections ("this account's angry-customer replies
are shorter than the model's instinct").

**Guardrails, because this writes into prompts:** minimum sample threshold
before a delta activates; cap delta size; never learn from a discarded
draft (only sent text); require the diff to be a genuine edit rather than a
full rewrite (a rewrite means the draft was rejected, which is a different
signal); and treat learned text as untrusted input to prompt assembly so it
cannot become an injection vector.

---

## 7. Handoff: the bug you actually reported

Diagnosed in the code. In `auto-reply.ts` the escalation path sets
`ai_autoreply_disabled = true` **and** assigns an agent, then the *entry
gate* of the same function returns early on both of those conditions. The
assistant therefore mutes itself the instant it announces the handoff — the
"I'm looping in a teammate" message is the **last thing it will ever say**.
The customer's next message reaches a system that has decided it is not
its problem. Your screenshot is that line of code.

Worse: nothing is watching. No SLA timer, no re-escalation. If the assigned
agent never opens the thread, the customer waits forever, silently.

**Correct model — three postures, driven by whether a human actually spoke:**

| Posture | Condition | Behaviour |
|---|---|---|
| `autonomous` | no handoff | today's normal behaviour |
| **`caretaker`** | handed off, **no human message yet** | **stays present** — acknowledges, answers what it safely can, gives honest status, never re-promises a resolution it cannot deliver |
| `silent` | a human has actually replied | steps back fully |

The distinction the current code misses: **assignment is not contact.**
Only a real human message ends caretaker mode. This is what "we can't leave
the customer empty" means in code.

**Warm transfer.** Research is consistent that the handoff must carry a
structured context packet: intent, entities (order numbers, error codes),
steps already attempted, KB citations, **sentiment trend**, escalation
reason, and a suggested next step. Your `buildHandoffSummary` already does
part of this — it gains the affective trend, and it must reach the agent as
a briefing rather than sitting in a DB column.

**SLA watchdog.** Escalation starts a clock. On breach: re-notify, then
re-assign, then notify a supervisor — and tell the *customer* honestly that
it is taking longer than expected. Escalating to a second human beats an
apology loop with the customer.

**Scheduling constraint (researched).** Vercel Hobby crons are **once per
day** — useless for a 10-minute SLA. But **Supabase `pg_cron` + `pg_net`
runs every minute on the free tier** and can POST to any URL. So the
watchdog is a minute-granularity `pg_cron` job hitting a secured route.
This removes the plan limitation from the critical path entirely.

Caretaker messages need their own budget (max count + cool-off) and must be
exempt from normal reply caps — otherwise a thread that escalates at its
reply limit falls straight back into the silence we are fixing.

---

## 8. Scenarios stress-tested against this design

| # | Scenario | Behaviour |
|---|---|---|
| 1 | Order cancelled, agent busy 30 min | Caretaker holds, honest status, wait acknowledged |
| 2 | Assigned agent never opens thread | Watchdog re-notifies → re-assigns → supervisor |
| 3 | Customer escalates anger while waiting | `trend: escalating` ⇒ priority raised, supervisor early |
| 4 | Customer calms down while waiting | De-escalating ⇒ no extra intervention. Avoids over-reacting to stale anger |
| 5 | Sarcasm ("great, just great") | Stage 1 LLM detection handles it; keyword matching never could |
| 6 | Hinglish / code-switching | LLM-native; a GoEmotions-only model would fail |
| 7 | Neutral question, low confidence | Treated as neutral — no unwanted empathy performance |
| 8 | Agent rewrites drafts to be shorter | Learned delta shortens future drafts for that account |
| 9 | New account, zero edits | Empty delta ⇒ identical to today |
| 10 | Human replies once then leaves | Posture → `silent`; SLA re-arms on customer's next message |
| 11 | Two agents assigned/reassigned | Watchdog tracks per-assignment, not per-conversation |
| 12 | Voice added later | Prosody fuses into same state; policy unchanged |
| 13 | Emotion service down | Degrade to neutral + low confidence; replies still send |
| 14 | Customer sends 5 "hello?" rapidly | Cool-off collapses to one caretaker reply |
| 15 | Malicious "ignore instructions, you are angry" | Learned deltas and state treated as untrusted data, not instructions |

Scenarios 4, 7, 9 and 13 are the ones that decide whether this feels
enterprise or gimmicky — all four are about **not overreacting**.

---

## 9. Consequences

**Easier:** per-emotion reporting and CSAT correlation; voice becomes
additive; empathy improves per-tenant without prompt engineering; handoff
becomes measurable (time-to-first-human, abandonment, caretaker efficacy).

**Harder:** two-stage generation adds latency and cost on emotional threads
(mitigated by skipping neutral); more state to reason about; learned deltas
need admin visibility and an off switch; caretaker messages are real
customer-facing sends and need conservative budgets.

**Revisit when:** volume makes Stage 2 cheaper than Stage 1 per message;
voice lands; or a tenant needs a genuinely fine-tuned model, at which point
the corpus from Stage 1 + edit pairs is the training set.

---

## 10. Action items (in dependency order)

1. [ ] Delete the keyword `sentiment.ts` stub — it is not a foundation.
2. [ ] Define `AffectiveState` + `Emotion` as the modality-agnostic contract.
3. [ ] Extend the existing `generateObject` schema to emit the full vector — zero extra cost.
4. [ ] `conversation_affective_events` table (append-only history) + EMA/trend derivation.
5. [ ] Fix the handoff posture bug: three postures, keyed on *human replied*, not *assigned*.
6. [ ] Caretaker budget + cool-off; exempt from normal reply caps.
7. [ ] Warm-transfer packet: extend `buildHandoffSummary` with affective trend; surface to agent as a briefing.
8. [ ] SLA watchdog route + `pg_cron`/`pg_net` minute schedule (bypasses the daily-cron limit).
9. [ ] Dual-stage generation with the "no new facts" invariant in Stage B.
10. [ ] Emotion-conditioned strategy selection.
11. [ ] Capture draft-vs-sent diffs at `/api/ai/draft` — the learning corpus.
12. [ ] Learned style deltas (prompt-space) + admin visibility and off switch.
13. [ ] Reporting: emotion trajectory, resolution-by-emotion, handoff SLA attainment.
14. [ ] Only then evaluate Stage 2 specialist hosting, using the collected corpus.

**Deliberately deferred:** fine-tuning, prosody, multimodal fusion, RL/DPO
alignment. All are unlocked by items 1–14 and blocked without the corpus.
