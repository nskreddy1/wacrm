/**
 * Diagnostic: where does an assistant turn actually spend its time?
 *
 * Times the configured provider directly for a trivial "hi" so model
 * latency can be separated from our own app work, and reports how much
 * of the response is reasoning vs. visible text.
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

const MODEL = cfg.model;
const URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

async function timeCall(label, body) {
  const started = Date.now();
  let firstChunk = null;
  let reasoning = '';
  let text = '';

  const r = await fetch(URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, stream: true, ...body }),
  });

  if (!r.ok) {
    console.log(`[v0] ${label}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
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
      if (d.reasoning_content) reasoning += d.reasoning_content;
      if (d.content) {
        if (firstChunk === null) firstChunk = Date.now() - started;
        text += d.content;
      }
    }
  }

  console.log(
    `[v0] ${label}: total=${Date.now() - started}ms first_visible_token=${firstChunk}ms reasoning_chars=${reasoning.length} text=${JSON.stringify(text.slice(0, 80))}`
  );
}

const messages = [
  { role: 'system', content: 'You are Mira, a concise CRM copilot.' },
  { role: 'user', content: 'hi' },
];

console.log(`[v0] model=${MODEL}`);
await timeCall('thinking DISABLED (enable_thinking:false)', {
  messages,
  max_tokens: 800,
  chat_template_kwargs: { enable_thinking: false },
});
