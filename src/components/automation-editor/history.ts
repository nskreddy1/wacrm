import { cloneValue } from './document'

export interface EditorHistory<T> {
  past: T[]
  present: T
  future: T[]
}

export type EditorHistoryAction<T> =
  | { type: 'commit'; value: T }
  | { type: 'replace'; value: T }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; value: T }

export function createEditorHistory<T>(value: T): EditorHistory<T> {
  return { past: [], present: cloneValue(value), future: [] }
}

export function editorHistoryReducer<T>(
  state: EditorHistory<T>,
  action: EditorHistoryAction<T>,
): EditorHistory<T> {
  switch (action.type) {
    case 'commit':
      return {
        past: [...state.past, cloneValue(state.present)],
        present: cloneValue(action.value),
        future: [],
      }
    case 'replace':
      return { ...state, present: cloneValue(action.value) }
    case 'undo': {
      const previous = state.past.at(-1)
      if (!previous) return state
      return {
        past: state.past.slice(0, -1),
        present: cloneValue(previous),
        future: [cloneValue(state.present), ...state.future],
      }
    }
    case 'redo': {
      const next = state.future[0]
      if (!next) return state
      return {
        past: [...state.past, cloneValue(state.present)],
        present: cloneValue(next),
        future: state.future.slice(1),
      }
    }
    case 'reset':
      return createEditorHistory(action.value)
  }
}
