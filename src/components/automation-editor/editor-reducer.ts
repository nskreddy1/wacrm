import {
  cloneNode,
  cloneValue,
  removeNodeAndEdges,
  type AutomationEditorDocument,
  type AutomationEditorEdge,
  type AutomationEditorNode,
  type AutomationEditorTrigger,
  type XYPosition,
} from './document'

const HISTORY_LIMIT = 100

export interface EditorState {
  document: AutomationEditorDocument
  past: AutomationEditorDocument[]
  future: AutomationEditorDocument[]
  selectedNodeId: string | null
  viewport: { x: number; y: number; zoom: number }
  lastCoalesceKey?: string
}

export type EditorAction =
  | { type: 'document/reset'; document: AutomationEditorDocument }
  | { type: 'document/replace'; document: AutomationEditorDocument }
  | { type: 'metadata/update'; patch: Partial<Pick<AutomationEditorDocument, 'name' | 'description' | 'status'>>; coalesceKey?: string }
  | { type: 'trigger/update'; trigger: AutomationEditorTrigger; coalesceKey?: string }
  | { type: 'node/add'; node: AutomationEditorNode; edge?: AutomationEditorEdge }
  | { type: 'node/configure'; nodeId: string; patch: Record<string, unknown>; coalesceKey?: string }
  | { type: 'node/move'; nodeId: string; position: XYPosition }
  | { type: 'node/duplicate'; nodeId: string }
  | { type: 'node/delete'; nodeId: string }
  | { type: 'edge/connect'; edge: AutomationEditorEdge }
  | { type: 'edge/delete'; edgeId: string }
  | { type: 'selection/set'; nodeId: string | null }
  | { type: 'viewport/set'; viewport: EditorState['viewport'] }
  | { type: 'history/undo' }
  | { type: 'history/redo' }

export function createEditorState(document: AutomationEditorDocument): EditorState {
  return {
    document: cloneValue(document),
    past: [],
    future: [],
    selectedNodeId: null,
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'document/reset':
      return createEditorState(action.document)
    case 'document/replace':
      return { ...state, document: cloneValue(action.document), lastCoalesceKey: undefined }
    case 'selection/set':
      return { ...state, selectedNodeId: action.nodeId }
    case 'viewport/set':
      return { ...state, viewport: action.viewport }
    case 'history/undo': {
      const previous = state.past.at(-1)
      if (!previous) return state
      return {
        ...state,
        document: cloneValue(previous),
        past: state.past.slice(0, -1),
        future: [cloneValue(state.document), ...state.future],
        lastCoalesceKey: undefined,
      }
    }
    case 'history/redo': {
      const next = state.future[0]
      if (!next) return state
      return {
        ...state,
        document: cloneValue(next),
        past: bounded([...state.past, cloneValue(state.document)]),
        future: state.future.slice(1),
        lastCoalesceKey: undefined,
      }
    }
    case 'metadata/update':
      return commit(state, { ...state.document, ...action.patch }, action.coalesceKey)
    case 'trigger/update':
      return commit(state, { ...state.document, trigger: cloneValue(action.trigger) }, action.coalesceKey)
    case 'node/add':
      return commit(state, {
        ...state.document,
        nodes: [...state.document.nodes, cloneValue(action.node)],
        edges: action.edge ? [...state.document.edges, cloneValue(action.edge)] : state.document.edges,
      })
    case 'node/configure':
      return commit(state, {
        ...state.document,
        nodes: state.document.nodes.map((node) => node.id === action.nodeId
          ? { ...node, config: { ...node.config, ...cloneValue(action.patch) } }
          : node),
      }, action.coalesceKey)
    case 'node/move':
      return commit(state, {
        ...state.document,
        nodes: state.document.nodes.map((node) => node.id === action.nodeId
          ? { ...node, position: { ...action.position } }
          : node),
      })
    case 'node/duplicate': {
      const source = state.document.nodes.find((node) => node.id === action.nodeId)
      if (!source) return state
      const duplicate = cloneNode(source)
      return {
        ...commit(state, {
          ...state.document,
          nodes: [...state.document.nodes, duplicate],
        }),
        selectedNodeId: duplicate.id,
      }
    }
    case 'node/delete': {
      const next = removeNodeAndEdges(state.document.nodes, state.document.edges, action.nodeId)
      if (next.nodes.length === state.document.nodes.length) return state
      return {
        ...commit(state, { ...state.document, ...next }),
        selectedNodeId: state.selectedNodeId === action.nodeId ? null : state.selectedNodeId,
      }
    }
    case 'edge/connect':
      return commit(state, {
        ...state.document,
        edges: [...state.document.edges, cloneValue(action.edge)],
      })
    case 'edge/delete': {
      const edges = state.document.edges.filter((edge) => edge.id !== action.edgeId)
      return edges.length === state.document.edges.length
        ? state
        : commit(state, { ...state.document, edges })
    }
  }
}

function commit(
  state: EditorState,
  nextDocument: AutomationEditorDocument,
  coalesceKey?: string,
): EditorState {
  const coalescing = Boolean(coalesceKey && coalesceKey === state.lastCoalesceKey)
  const document = cloneValue({
    ...nextDocument,
    revision: state.document.revision + 1,
  })
  return {
    ...state,
    document,
    past: coalescing ? state.past : bounded([...state.past, cloneValue(state.document)]),
    future: [],
    lastCoalesceKey: coalesceKey,
  }
}

function bounded<T>(entries: T[]): T[] {
  return entries.length > HISTORY_LIMIT ? entries.slice(-HISTORY_LIMIT) : entries
}
