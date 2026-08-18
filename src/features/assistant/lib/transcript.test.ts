import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import {
  MAX_TOOL_OUTPUT_CHARS,
  MAX_TRANSCRIPT_CHARS,
  MODEL_HISTORY_MESSAGES,
  prepareModelTranscript,
} from './transcript';

/**
 * The repair half of these tests guards a bug that broke a thread
 * permanently rather than once: a tool call with no result makes every
 * provider reject the request, so one interrupted stream meant every
 * later message in that conversation failed too.
 */

function text(role: UIMessage['role'], body: string, id = crypto.randomUUID()) {
  return {
    id,
    role,
    parts: [{ type: 'text' as const, text: body }],
  } as UIMessage;
}

function toolPart(state: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'tool-get_pipeline_summary',
    toolCallId: 'call-1',
    state,
    input: {},
    ...extra,
  } as unknown as UIMessage['parts'][number];
}

function assistantWithTool(
  state: string,
  extra: Record<string, unknown> = {},
  body?: string
) {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    parts: [
      toolPart(state, extra),
      ...(body ? [{ type: 'text' as const, text: body }] : []),
    ],
  } as UIMessage;
}

function toolParts(message: UIMessage) {
  return message.parts.filter((p) => p.type.startsWith('tool-'));
}

describe('prepareModelTranscript — repair', () => {
  it('drops a tool call left unresolved by an interrupted stream', () => {
    // The exact shape of a stream that died after the call went out:
    // `input-available` with no output. Sent as-is, the provider sees a
    // tool call with no matching result and rejects the whole request.
    const messages = [
      text('user', 'Summarize my pipeline'),
      assistantWithTool('input-available'),
      text('user', 'hi'),
    ];

    const out = prepareModelTranscript(messages);

    expect(out.flatMap(toolParts)).toEqual([]);
    // The user's own words survive on both turns.
    expect(out.map((m) => m.role)).toEqual(['user', 'user']);
  });

  it('drops a write approval the user never answered', () => {
    const messages = [
      text('user', 'Add a contact'),
      assistantWithTool('approval-requested', {
        approval: { id: 'a1', isAutomatic: false },
      }),
      text('user', 'never mind, how many contacts do I have?'),
    ];

    expect(prepareModelTranscript(messages).flatMap(toolParts)).toEqual([]);
  });

  it('drops an approval that was answered but never executed', () => {
    // `approval-responded` on an OLD turn means the user said yes and
    // the run still didn't finish — dangling exactly like the others.
    const messages = [
      text('user', 'Add a contact'),
      assistantWithTool('approval-responded', {
        approval: { id: 'a1', isAutomatic: false, approved: true },
      }),
      text('user', 'and my pipeline?'),
    ];

    expect(prepareModelTranscript(messages).flatMap(toolParts)).toEqual([]);
  });

  it('keeps the final message byte-exact so a live approval still runs', () => {
    // The approval resend puts the assistant message LAST. Repairing it
    // would strip the response that authorises the write.
    const pending = assistantWithTool('approval-responded', {
      approval: { id: 'a1', isAutomatic: false, approved: true },
    });
    const out = prepareModelTranscript([text('user', 'Add a contact'), pending]);

    expect(out[out.length - 1]).toBe(pending);
    expect(toolParts(out[out.length - 1])).toHaveLength(1);
  });

  it('keeps resolved tool calls, including errors and denials', () => {
    for (const state of ['output-available', 'output-error', 'output-denied']) {
      const out = prepareModelTranscript([
        text('user', 'go'),
        assistantWithTool(state, { output: { ok: true }, errorText: 'boom' }),
        text('user', 'thanks'),
      ]);
      expect(out.flatMap(toolParts), state).toHaveLength(1);
    }
  });

  it('removes a message that was nothing but an unresolved call', () => {
    const out = prepareModelTranscript([
      text('user', 'go'),
      assistantWithTool('input-streaming'),
      text('user', 'still there?'),
    ]);

    expect(out).toHaveLength(2);
    expect(out.every((m) => m.parts.length > 0)).toBe(true);
  });

  it('keeps the assistant text when only its tool call is dropped', () => {
    const out = prepareModelTranscript([
      text('user', 'go'),
      assistantWithTool('input-available', {}, 'Let me look that up.'),
      text('user', 'well?'),
    ]);

    expect(out).toHaveLength(3);
    expect(out[1].parts).toEqual([
      { type: 'text', text: 'Let me look that up.' },
    ]);
  });

  it('leaves a clean transcript untouched', () => {
    const messages = [text('user', 'hi'), text('assistant', 'Hello.')];
    expect(prepareModelTranscript(messages)).toEqual(messages);
  });

  it('handles an empty transcript', () => {
    expect(prepareModelTranscript([])).toEqual([]);
  });
});

describe('prepareModelTranscript — budget', () => {
  it('sends only the most recent window', () => {
    const messages = Array.from({ length: 30 }, (_, i) =>
      text(i % 2 === 0 ? 'user' : 'assistant', `m${i}`, `id-${i}`)
    );

    const out = prepareModelTranscript(messages);

    expect(out).toHaveLength(MODEL_HISTORY_MESSAGES);
    expect(out[out.length - 1].id).toBe('id-29');
  });

  it('truncates a bulky old tool result but not the current turn', () => {
    const big = { rows: 'x'.repeat(MAX_TOOL_OUTPUT_CHARS * 3) };
    const messages = [
      assistantWithTool('output-available', { output: big }),
      text('user', 'and then?'),
      assistantWithTool('output-available', { output: big }),
      text('user', 'now what?'),
    ];

    const out = prepareModelTranscript(messages);
    const oldest = toolParts(out[0])[0] as { output: string };
    const recent = toolParts(out[2])[0] as { output: unknown };

    expect(typeof oldest.output).toBe('string');
    expect(oldest.output).toContain('older result truncated');
    expect(oldest.output.length).toBeLessThan(MAX_TOOL_OUTPUT_CHARS + 100);
    // Second-to-last message keeps its output verbatim — the final step
    // of this turn may still need to read it.
    expect(recent.output).toEqual(big);
  });

  it('drops the oldest messages when the transcript blows the char budget', () => {
    const huge = 'y'.repeat(MAX_TRANSCRIPT_CHARS / 2);
    const messages = [
      text('user', huge, 'old-1'),
      text('assistant', huge, 'old-2'),
      text('user', huge, 'old-3'),
      text('user', 'what did I just ask?', 'latest'),
    ];

    const out = prepareModelTranscript(messages);

    expect(out[out.length - 1].id).toBe('latest');
    expect(out.length).toBeLessThan(messages.length);
  });

  it('never drops the message the user just sent, however long', () => {
    const out = prepareModelTranscript([
      text('user', 'z'.repeat(MAX_TRANSCRIPT_CHARS * 2), 'only'),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('only');
  });

  it('does not mutate the caller\u2019s messages', () => {
    const big = { rows: 'x'.repeat(MAX_TOOL_OUTPUT_CHARS * 3) };
    const original = assistantWithTool('output-available', { output: big });
    const messages = [original, text('user', 'a'), text('user', 'b')];

    prepareModelTranscript(messages);

    expect((toolParts(original)[0] as { output: unknown }).output).toEqual(big);
  });
});
