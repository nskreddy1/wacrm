import { describe, expect, it } from 'vitest'
import { createEditorHistory, editorHistoryReducer } from './history'

interface State {
  name: string
  nodes: string[]
}

const first: State = { name: 'Draft', nodes: [] }
const second: State = { name: 'Draft', nodes: ['message'] }
const third: State = { name: 'Published', nodes: ['message'] }

describe('editor history reducer', () => {
  it('undoes and redoes committed snapshots', () => {
    let history = createEditorHistory(first)
    history = editorHistoryReducer(history, { type: 'commit', value: second })
    history = editorHistoryReducer(history, { type: 'commit', value: third })
    history = editorHistoryReducer(history, { type: 'undo' })
    expect(history.present).toEqual(second)
    history = editorHistoryReducer(history, { type: 'undo' })
    expect(history.present).toEqual(first)
    history = editorHistoryReducer(history, { type: 'redo' })
    expect(history.present).toEqual(second)
  })

  it('clears redo history after a new commit', () => {
    let history = createEditorHistory(first)
    history = editorHistoryReducer(history, { type: 'commit', value: second })
    history = editorHistoryReducer(history, { type: 'undo' })
    history = editorHistoryReducer(history, { type: 'commit', value: third })
    expect(history.future).toEqual([])
    expect(editorHistoryReducer(history, { type: 'redo' })).toBe(history)
  })

  it('replaces transient state without creating an undo entry', () => {
    const history = editorHistoryReducer(createEditorHistory(first), {
      type: 'replace',
      value: second,
    })
    expect(history.present).toEqual(second)
    expect(history.past).toEqual([])
  })
})
