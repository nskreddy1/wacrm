import { describe, expect, it } from 'vitest';
import {
  leaksPrompt,
  looksLikeReasoning,
  stripThoughtBlocks,
} from './reasoning';

describe('stripThoughtBlocks', () => {
  it('drops a closed think block and keeps the reply', () => {
    expect(
      stripThoughtBlocks('<think>plan the reply</think>Sure, it ships Monday.')
    ).toBe('Sure, it ships Monday.');
  });

  it('drops every block when the model thinks more than once', () => {
    expect(
      stripThoughtBlocks('<think>a</think>Hi there.<think>b</think> Bye.')
    ).toBe('Hi there. Bye.');
  });

  it('returns nothing for an unterminated block', () => {
    // The production shape: the token budget ran out mid-thought, so
    // there is no reply in the response at all.
    expect(stripThoughtBlocks('<think>1. Analyze user input\n2. Check')).toBe(
      ''
    );
  });

  it('keeps only the tail when the opener was swallowed', () => {
    expect(stripThoughtBlocks('reasoning noise</think>Namaste!')).toBe(
      'Namaste!'
    );
  });

  it('handles the alternate delimiter families', () => {
    expect(stripThoughtBlocks('◁think▷x◁/think▷ok')).toBe('ok');
    expect(
      stripThoughtBlocks('<|begin_of_thought|>x<|end_of_thought|>ok')
    ).toBe('ok');
    expect(stripThoughtBlocks('<reasoning>x</reasoning>ok')).toBe('ok');
  });

  it('leaves an ordinary reply untouched', () => {
    const reply = 'Aapka order kal deliver ho jayega. Thanks!';
    expect(stripThoughtBlocks(reply)).toBe(reply);
  });
});

describe('looksLikeReasoning', () => {
  it('catches the leak that reached a customer', () => {
    expect(
      looksLikeReasoning(
        "Here's a thinking process:\n\n1. **Analyze User Input**: The user is sending repeated \"Hi\""
      )
    ).toBe(true);
  });

  it('catches other scratchpad openings', () => {
    expect(looksLikeReasoning('Thinking process: first, check the tags')).toBe(
      true
    );
    expect(looksLikeReasoning('Let me analyze the customer message.')).toBe(
      true
    );
    expect(looksLikeReasoning('I need to figure out what they want.')).toBe(
      true
    );
    expect(looksLikeReasoning('**Analyze User Input**')).toBe(true);
  });

  it('does not fire on genuine replies that mention thinking', () => {
    // False positives silence a good reply, so these matter more than
    // the detections above.
    expect(looksLikeReasoning('I think we have that in stock — want one?')).toBe(
      false
    );
    expect(looksLikeReasoning('Let me check with the team and confirm.')).toBe(
      false
    );
    expect(looksLikeReasoning("Here's the price list you asked for.")).toBe(
      false
    );
    expect(looksLikeReasoning('Hi Sunil! How can I help you today?')).toBe(
      false
    );
    expect(looksLikeReasoning('')).toBe(false);
  });
});

describe('leaksPrompt', () => {
  it('detects our own instructions echoed back', () => {
    expect(leaksPrompt('- After reply, end with exact format:')).toBe(true);
    expect(leaksPrompt('The CRM data shows: Name: Sunil')).toBe(true);
  });

  it('passes a clean reply', () => {
    expect(leaksPrompt('Your order ships tomorrow, Sunil.')).toBe(false);
  });
});
