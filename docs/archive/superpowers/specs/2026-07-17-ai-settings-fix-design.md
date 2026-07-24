# AI Settings Reliability Fix Design

## Goal

Make AI Settings safe for first-time users and complete for every supported provider. The page must show a real loading state, expose all 12 existing providers, support an editable Ollama base URL, and allow Ollama configuration without an API key while still validating server connectivity before saving changed settings.

## Scope

This is a focused correction to the existing AI Settings UI, configuration API, validation behavior, translations, and targeted tests. It does not redesign the settings page, change the unified-versus-separate AI engine architecture, add providers, or repair unrelated generation tests that currently reach external OpenAI or Anthropic services.

No database table or column change is expected. The existing `ai_configs` schema and migration `045_ai_provider_expansion.sql` already contain the provider and `base_url` support needed by this feature. If implementation verification reveals a missing schema element, the change must be added through the existing Supabase migration/script workflow rather than applied only in application code.

## Existing Problems and Root Cause

1. The shared provider type and model layer support 12 providers, but the provider selector contains only OpenAI, Anthropic, and Gemini as hard-coded options.
2. While configuration is loading, the component renders the `loadFailed` translation and unfinished comments instead of a loading state.
3. The API accepts and returns `base_url`, but the settings form does not render a base URL control.
4. Ollama is keyless in backend validation, but the form still presents API-key behavior intended for hosted providers.
5. A first-time user legitimately has no `ai_configs` row. The API already represents that state as `configured: false`; the UI must initialize a normal empty form rather than treating it as an error.

## Provider Behavior

The selector will display the 12 providers already defined by `AiProvider`:

- OpenAI
- Anthropic
- Google Gemini
- Azure OpenAI
- AWS Bedrock
- Groq
- Mistral AI
- Cohere
- Perplexity
- DeepSeek
- Ollama (Local)
- Custom Endpoint

Provider labels and capability decisions should come from one provider metadata definition rather than repeated conditional lists. Existing model defaults remain unchanged.

### Credentials

Hosted providers continue to accept an API key. Existing saved keys remain masked and are preserved when the user leaves the placeholder untouched.

Ollama does not require or submit a user API key. The UI replaces the credential expectation with explanatory text stating that Ollama runs through the configured server URL.

Custom Endpoint behavior remains compatible with the current backend rules; this task does not redefine its authentication contract.

### Base URL

A Base URL input appears for Ollama and Custom Endpoint. For Ollama, the input initializes from the saved value or the existing default `http://localhost:11434`. Changing providers must not accidentally retain an irrelevant base URL in the submitted configuration.

## Loading and Empty States

During the initial SWR request, the settings card shows a proper skeleton/loading state and no error language. If the request fails, the existing load-failure alert is shown. If the request succeeds with `configured: false`, the component renders an editable first-time configuration using existing defaults and does not show an error.

Controls that depend on loaded configuration remain unavailable until loading completes, preventing accidental submission of fallback state before the server response is known.

## Connectivity Validation and Saving

The existing server-side test-before-save contract remains authoritative.

For Ollama:

1. The user selects Ollama, model, and Base URL.
2. “Test connection” calls the existing test endpoint without requiring an API key.
3. The test endpoint validates that the Ollama server at the selected Base URL is reachable using the existing engine/model path.
4. A successful test creates the same short-lived proof used by other providers.
5. Saving changed provider/model/Base URL values requires a matching successful proof.
6. The persisted configuration stores the Base URL and the backend-managed keyless placeholder; the browser does not need to provide a real key.

A changed provider, model, key, or Base URL invalidates previous successful test state in the UI. The API remains responsible for rejecting stale or mismatched proof.

## Error Handling

- Initial fetch failure: show the existing localized load error.
- Connectivity failure: show the sanitized error returned by the test endpoint without persisting changes.
- Save failure: retain entered form values and show the existing save error.
- Missing hosted-provider key: retain the current validation behavior.
- Ollama unreachable: report connection failure; do not silently save unverified settings.
- No existing row: treat as a valid first-run state.

No secret values may be logged or returned in API responses.

## Components and Files

The implementation is expected to touch only focused files:

- `src/components/settings/ai-config.tsx`: loading state, complete provider selector, capability-aware credential/Base URL controls, test-state invalidation, and Ollama copy.
- `src/lib/ai/types.ts` or a nearby focused provider metadata module: provider labels/capabilities if extraction is needed to avoid duplicated rules.
- `src/app/api/ai/config/route.ts` and `src/app/api/ai/test/route.ts`: only if targeted tests reveal a server-side mismatch for keyless Ollama or proof validation.
- `messages/*.json`: localized loading, Base URL, and Ollama connection labels for every existing locale.
- Existing/new focused test files beside the affected UI/API modules.
- `supabase/migrations/*` and the schema push script only if an actual schema discrepancy is verified.

The visual structure, design tokens, typography, and surrounding settings layout remain unchanged.

## Testing

Targeted automated coverage must verify:

1. All 12 provider choices are rendered.
2. Initial loading does not display the failure message or editable form prematurely.
3. `configured: false` renders a normal first-run form.
4. Ollama shows Base URL, does not require an API key, and sends the URL in test/save payloads.
5. Changed Ollama settings cannot save without matching successful connectivity validation.
6. A successful Ollama test permits save without a user-entered key.
7. Existing hosted-provider key placeholder preservation still works.
8. Custom Endpoint still exposes Base URL.
9. Existing focused AI configuration/model tests remain green.

After automated tests, verify the settings page in the browser at the active dark-mode desktop viewport, exercise provider switching and the first-run/loading states, and confirm there are no layout regressions.

## Acceptance Criteria

- The page has distinct loading, load-error, and unconfigured-first-run states.
- The selector exposes exactly the 12 currently supported providers.
- Ollama exposes an editable Base URL and no required API-key input.
- Ollama changes require a successful server connectivity test before save.
- Configuration fetch/save does not fail merely because a first-time user has no stored row or key.
- No unnecessary schema change is introduced; any necessary schema change is represented in the repository migration/script workflow.
- Targeted tests and browser verification pass.
