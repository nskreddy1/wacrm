/**
 * Diagnostic: is the ~90s wait on "hi" caused by us or by the model?
 *
 * Measures time-to-FIRST-VISIBLE-TOKEN on the cheapest possible turn —
 * no tools, minimal prompt — against the configured model and a few
 * alternatives on the same endpoint and key. TTFT is the number that
 * matters: time spent before the first token cannot be reduced by
 * capping output length or lowering temperature, because none of that
 * applies until generation has already started.
 *
 * Throwaway script — safe to delete.
 */
import pg from 'pg';

const base = process.env.POSTGRES_URL_NON_POOLING.replace(
  /[?&]sslmode=[^&]*/g,
  ''
);
const client = new pg.Client({
  connectionString:
    base + (base.includes('?') ? '&' : '?') + 'sslmode=no-verify',
});
await client.connect();
const res = await client.query(
  'select value from platform_settings where key = $1',
  ['assistant_config']
);
await client.end();
const cfg = res.rows[0]?.value ?? {};

// Reuse the app's own decrypt so we hit the real key.
const { decrypt } = await import('../src/features/whatsapp/lib/encryption.ts');
const apiKey = decrypt(cfg.api_key);

const URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

const MESSAGES = [
  { role: 'system', content: 'You are Mira, a concise CRM copilot.' },
  { role: 'user', content: 'hi' },
];

async function timeModel(model, extra = {}) {
  const started = Date.now();
  let firstChunk = null;
  let reasoning = 0;
  let text = '';

  try {
    const r = await fetch(URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: MESSAGES,
        max_tokens: 256,
        stream: true,
        ...extra,
      }),
    });

    if (!r.ok) {
      console.log(
        `[v0] ${model.padEnd(36)} HTTP ${r.status} ${(await r.text()).slice(0, 90)}`
      );
      return;
    }

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;
        let json;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        const d = json.choices?.[0]?.delta ?? {};
        // Reasoning tokens cost wall time but never reach the user.
        if (d.reasoning_content) reasoning += d.reasoning_content.length;
        if (d.content) {
          if (firstChunk === null) firstChunk = Date.now() - started;
          text += d.content;
        }
      }
    }

    console.log(
      `[v0] ${model.padEnd(36)} ttft=${String(firstChunk ?? -1).padStart(6)}ms ` +
        `total=${String(Date.now() - started).padStart(6)}ms ` +
        `reasoning=${String(reasoning).padStart(5)}ch "${text.slice(0, 40).replace(/\n/g, ' ')}"`
    );
  } catch (err) {
    console.log(`[v0] ${model.padEnd(36)} FAILED ${err.message}`);
  }
}

console.log(`[v0] configured model = ${cfg.model}`);
console.log('[v0] cheapest turn ("hi"), no tools\n');

// The configured model under the most favourable conditions it can get:
// reasoning pass explicitly disabled.
await timeModel(cfg.model, { chat_template_kwargs: { enable_thinking: false } });

// Same endpoint, same key, same prompt — only the model differs.
await timeModel('meta/llama-3.3-70b-instruct');
await timeModel('openai/gpt-oss-120b');
await timeModel('mistralai/mistral-small-24b-instruct');
