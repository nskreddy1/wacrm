import { describe, expect, it } from 'vitest'

import type { AutomationEditorDocument } from './document'
import { createEditorState, editorReducer } from './editor-reducer'

const initial: AutomationEditorDocument = {
  mode: 'rule',
  name: 'Draft',
  description: '',
  status: 'draft',
  trigger: { type: 'new_contact_created', config: {} },
  nodes: [
    {
      id: 'message-1',
      kind: 'send_message',
      position: { x: 100, y: 100 },
      config: { text: 'Hello' },
    },
  ],
  edges: [{ id: 'entry', source: 'trigger', target: 'message-1' }],
  revision: 0,
}

describe('editor reducer', () => {
  it('updates authored state and keeps selection out of history', () => {
    let state = createEditorState(initial)
    state = editorReducer(state, { type: 'selection/set', nodeId: 'message-1' })
    expect(state.past).toHaveLength(0)

    state = editorReducer(state, { type: 'metadata/update', patch: { name: 'Welcome' } })
    expect(state.document.name).toBe('Welcome')
    expect(state.document.revision).toBe(1)
    expect(state.past).toHaveLength(1)
  })

  it('duplicates and deletes a node with attached edges', () => {
    let state = editorReducer(createEditorState(initial), { type: 'node/duplicate', nodeId: 'message-1' })
    expect(state.document.nodes).toHaveLength(2)
    const duplicate = state.document.nodes[1]
    expect(duplicate.id).not.toBe('message-1')
    expect(duplicate.config).toEqual({ text: 'Hello' })

    state = editorReducer(state, { type: 'node/delete', nodeId: 'message-1' })
    expect(state.document.nodes.map((node) => node.id)).not.toContain('message-1')
    expect(state.document.edges).toEqual([])
  })

  it('undoes, redoes, and clears redo after a new command', () => {
    let state = createEditorState(initial)
    state = editorReducer(state, { type: 'metadata/update', patch: { name: 'One' } })
    state = editorReducer(state, { type: 'history/undo' })
    expect(state.document.name).toBe('Draft')
    state = editorReducer(state, { type: 'history/redo' })
    expect(state.document.name).toBe('One')
    state = editorReducer(state, { type: 'history/undo' })
    state = editorReducer(state, { type: 'metadata/update', patch: { name: 'Two' } })
    expect(state.future).toEqual([])
  })

  it('coalesces repeated edits sharing one key', () => {
    let state = createEditorState(initial)
    state = editorReducer(state, {
      type: 'node/configure',
      nodeId: 'message-1',
      patch: { text: 'H' },
      coalesceKey: 'message-1:text',
    })
    state = editorReducer(state, {
      type: 'node/configure',
      nodeId: 'message-1',
      patch: { text: 'Hello again' },
      coalesceKey: 'message-1:text',
    })

    expect(state.past).toHaveLength(1)
    state = editorReducer(state, { type: 'history/undo' })
    expect(state.document.nodes[0].config.text).toBe('Hello')
  })

  it('caps authored history at 100 entries', () => {
    let state = createEditorState(initial)
    for (let index = 0; index < 120; index += 1) {
      state = editorReducer(state, { type: 'metadata/update', patch: { name: `Draft ${index}` } })
    }
    expect(state.past).toHaveLength(100)
  })
})
