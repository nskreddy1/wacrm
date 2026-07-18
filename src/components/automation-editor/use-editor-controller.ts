'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'

import { cloneValue, type AutomationEditorDocument, type AutomationEditorSaveState } from './document'
import { createEditorState, editorReducer, type EditorAction } from './editor-reducer'

export type EditorSaveCallback = (
  document: AutomationEditorDocument,
  signal: AbortSignal,
) => Promise<void>

export interface RevisionSaveManager {
  save: (document: AutomationEditorDocument) => Promise<void>
  autosave: (document: AutomationEditorDocument) => Promise<void>
  retry: () => Promise<void>
  abort: () => void
}

export function createRevisionSaveManager(
  onSave: EditorSaveCallback,
  onStateChange: (state: AutomationEditorSaveState, revision: number) => void,
): RevisionSaveManager {
  let latestRequest = 0
  let latestDocument: AutomationEditorDocument | undefined
  let activeController: AbortController | undefined

  const save = async (document: AutomationEditorDocument) => {
    latestDocument = cloneValue(document)
    const requestId = ++latestRequest
    activeController?.abort()
    const controller = new AbortController()
    activeController = controller
    onStateChange('saving', document.revision)
    try {
      await onSave(cloneValue(document), controller.signal)
      if (requestId === latestRequest) onStateChange('saved', document.revision)
    } catch (error) {
      if (requestId === latestRequest && !controller.signal.aborted) {
        onStateChange('error', document.revision)
      }
      throw error
    }
  }

  return {
    save,
    autosave: async (document) => {
      if (!document.id) return
      await save(document)
    },
    retry: async () => {
      if (!latestDocument) return
      await save(latestDocument)
    },
    abort: () => activeController?.abort(),
  }
}

export interface UseEditorControllerOptions {
  initialDocument: AutomationEditorDocument
  onSave: EditorSaveCallback
  autosaveDelay?: number
}

export function useEditorController({
  initialDocument,
  onSave,
  autosaveDelay = 800,
}: UseEditorControllerOptions) {
  const [state, dispatch] = useReducer(editorReducer, initialDocument, createEditorState)
  const [saveState, setSaveState] = useState<AutomationEditorSaveState>('saved')
  const [savedRevision, setSavedRevision] = useState(initialDocument.revision)
  const manager = useMemo(() => createRevisionSaveManager(onSave, (nextState, revision) => {
    setSaveState(nextState)
    if (nextState === 'saved') setSavedRevision(revision)
  }), [onSave])
  const previousRevision = useRef(initialDocument.revision)

  const editorDispatch = useCallback((action: EditorAction) => {
    dispatch(action)
  }, [])

  const save = useCallback(async () => {
    await manager.save(state.document)
  }, [manager, state.document])

  const retry = useCallback(async () => {
    await manager.retry()
  }, [manager])

  useEffect(() => {
    if (state.document.revision === previousRevision.current) return
    previousRevision.current = state.document.revision
    setSaveState('unsaved')
    if (!state.document.id) return

    const timer = window.setTimeout(() => {
      void manager.autosave(state.document).catch(() => undefined)
    }, autosaveDelay)
    return () => window.clearTimeout(timer)
  }, [autosaveDelay, manager, state.document])

  useEffect(() => () => manager.abort(), [manager])

  return {
    state,
    document: state.document,
    dispatch: editorDispatch,
    save,
    retry,
    saveState,
    savedRevision,
    isDirty: state.document.revision !== savedRevision,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  }
}
