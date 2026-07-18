import { describe, expect, it, vi } from 'vitest'

import type { AutomationEditorDocument } from './document'
import { createRevisionSaveManager } from './use-editor-controller'

const document: AutomationEditorDocument = {
  id: 'automation-1',
  mode: 'rule',
  name: 'Draft',
  description: '',
  status: 'draft',
  trigger: { type: 'new_contact_created', config: {} },
  nodes: [],
  edges: [],
  revision: 1,
}

describe('revision save manager', () => {
  it('does not let an older response mark a newer revision saved', async () => {
    let resolveFirst!: () => void
    const first = new Promise<void>((resolve) => { resolveFirst = resolve })
    const onSave = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(undefined)
    const states: Array<{ state: string; revision: number }> = []
    const manager = createRevisionSaveManager(onSave, (state, revision) => states.push({ state, revision }))

    const oldRequest = manager.save(document)
    const currentRequest = manager.save({ ...document, revision: 2 })
    await currentRequest
    resolveFirst()
    await oldRequest

    expect(states.at(-1)).toEqual({ state: 'saved', revision: 2 })
  })

  it('retains the current revision on failure and retries it', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined)
    const states: Array<{ state: string; revision: number }> = []
    const manager = createRevisionSaveManager(onSave, (state, revision) => states.push({ state, revision }))

    await expect(manager.save(document)).rejects.toThrow('offline')
    expect(states.at(-1)).toEqual({ state: 'error', revision: 1 })
    await manager.retry()
    expect(onSave).toHaveBeenLastCalledWith(document, expect.any(AbortSignal))
    expect(states.at(-1)).toEqual({ state: 'saved', revision: 1 })
  })

  it('skips autosave for documents without an id', async () => {
    const onSave = vi.fn()
    const manager = createRevisionSaveManager(onSave, () => undefined)

    await manager.autosave({ ...document, id: undefined })
    expect(onSave).not.toHaveBeenCalled()
  })
})
