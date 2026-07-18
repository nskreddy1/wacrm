'use client'

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type Connection,
  type Node as FlowNode,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  AlertCircle,
  Check,
  ChevronLeft,
  CircleDot,
  Library,
  LoaderCircle,
  PanelRight,
  Redo2,
  Save,
  Search,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  createEditorId,
  isEditableTarget,
  removeNodeAndEdges,
  type AutomationEditorDocument,
  type AutomationEditorNode,
  type AutomationEditorSaveState,
} from './document'
import { createEditorHistory, editorHistoryReducer } from './history'
import {
  AUTOMATION_NODE_CATEGORIES,
  AUTOMATION_NODE_DEFINITIONS,
  getAutomationNodeDefinition,
} from './node-registry'
import { canPublishAutomation, validateAutomationDocument } from './validation'

const TRIGGER_ID = 'trigger'
const NODE_TYPES = { automation: AutomationCanvasNode }

interface AutomationEditorProps {
  initialDocument: AutomationEditorDocument
  backHref: string
  onSave: (document: AutomationEditorDocument) => Promise<void>
  onTest?: (document: AutomationEditorDocument) => Promise<void>
}

export function AutomationEditor(props: AutomationEditorProps) {
  return (
    <ReactFlowProvider>
      <AutomationEditorInner {...props} />
    </ReactFlowProvider>
  )
}

function AutomationEditorInner({ initialDocument, backHref, onSave, onTest }: AutomationEditorProps) {
  const [history, dispatch] = useReducer(editorHistoryReducer<AutomationEditorDocument>, initialDocument, createEditorHistory)
  const document = history.present
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [saveState, setSaveState] = useState<AutomationEditorSaveState>('saved')
  const [query, setQuery] = useState('')
  const issues = useMemo(() => validateAutomationDocument(document), [document])

  const commit = useCallback((next: AutomationEditorDocument) => {
    dispatch({ type: 'commit', value: { ...next, revision: next.revision + 1 } })
    setSaveState('unsaved')
  }, [])

  const save = useCallback(async (next = document) => {
    setSaveState('saving')
    try {
      await onSave(next)
      setSaveState('saved')
      toast.success('Automation saved')
    } catch (error) {
      setSaveState('error')
      toast.error(error instanceof Error ? error.message : 'Unable to save automation')
    }
  }, [document, onSave])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return
      const modifier = event.metaKey || event.ctrlKey
      if (modifier && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
        return
      }
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' })
        setSaveState('unsaved')
        return
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && selectedNodeId) {
        event.preventDefault()
        const next = removeNodeAndEdges(document.nodes, document.edges, selectedNodeId)
        commit({ ...document, ...next })
        setSelectedNodeId(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [commit, document, save, selectedNodeId])

  const flowNodes = useMemo<FlowNode[]>(() => [
    {
      id: TRIGGER_ID,
      type: 'automation',
      position: { x: 40, y: 160 },
      data: { kind: 'trigger', label: 'Trigger', detail: humanize(document.trigger.type) },
      deletable: false,
    },
    ...document.nodes.map((node) => ({
      id: node.id,
      type: 'automation',
      position: node.position,
      data: {
        kind: node.kind,
        label: getAutomationNodeDefinition(node.kind)?.label ?? humanize(node.kind),
        detail: summarizeConfig(node.config),
      },
    })),
  ], [document.nodes, document.trigger.type])

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    const changed = applyNodeChanges(changes, flowNodes)
    const moved = changes.some((change) => change.type === 'position' && !change.dragging)
    if (!moved) return
    commit({
      ...document,
      nodes: document.nodes.map((node) => {
        const current = changed.find((candidate) => candidate.id === node.id)
        return current ? { ...node, position: current.position } : node
      }),
    })
  }, [commit, document, flowNodes])

  const connect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    const nextEdges = addEdge({
      ...connection,
      id: createEditorId(),
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
    }, document.edges)
    commit({ ...document, edges: nextEdges })
  }, [commit, document])

  const addNode = useCallback((kind: string, position?: { x: number; y: number }) => {
    const definition = getAutomationNodeDefinition(kind)
    if (!definition) return
    const node: AutomationEditorNode = {
      id: createEditorId(),
      kind,
      config: structuredClone(definition.defaultConfig),
      position: position ?? { x: 340, y: 180 + document.nodes.length * 36 },
    }
    commit({ ...document, nodes: [...document.nodes, node] })
    setSelectedNodeId(node.id)
    setInspectorOpen(true)
  }, [commit, document])

  const selectedNode = document.nodes.find((node) => node.id === selectedNodeId)
  const updateSelected = (patch: Partial<AutomationEditorNode>) => {
    if (!selectedNode) return
    commit({
      ...document,
      nodes: document.nodes.map((node) => node.id === selectedNode.id ? { ...node, ...patch } : node),
    })
  }
  const deleteSelected = () => {
    if (!selectedNode) return
    const next = removeNodeAndEdges(document.nodes, document.edges, selectedNode.id)
    commit({ ...document, ...next })
    setSelectedNodeId(null)
  }

  const filteredDefinitions = AUTOMATION_NODE_DEFINITIONS.filter(
    (definition) => definition.modes.includes(document.mode) &&
      `${definition.label} ${definition.description}`.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <main className="flex h-full min-h-[680px] flex-col overflow-hidden bg-background">
      <header className="flex min-h-16 items-center gap-3 border-b bg-card px-4 lg:px-6">
        <a href={backHref} aria-label="Back to automations" className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <ChevronLeft />
        </a>
        <div className="min-w-0 flex-1">
          <Input
            aria-label="Automation name"
            value={document.name}
            onChange={(event) => commit({ ...document, name: event.target.value })}
            className="h-auto border-0 bg-transparent px-0 text-base font-semibold shadow-none focus-visible:ring-0"
          />
          <p className="text-xs text-muted-foreground">{document.mode === 'rule' ? 'Rule automation' : 'Conversation flow'}</p>
        </div>
        <SaveIndicator state={saveState} />
        <EditorIconButton label="Undo" disabled={!history.past.length} onClick={() => dispatch({ type: 'undo' })}><Undo2 /></EditorIconButton>
        <EditorIconButton label="Redo" disabled={!history.future.length} onClick={() => dispatch({ type: 'redo' })}><Redo2 /></EditorIconButton>
        {onTest && <Button variant="outline" size="sm" onClick={() => void onTest(document)}>Test</Button>}
        <Button variant="outline" size="sm" onClick={() => void save()} disabled={saveState === 'saving'}>
          {saveState === 'saving' ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Save data-icon="inline-start" />}
          Save
        </Button>
        <Button
          size="sm"
          disabled={!canPublishAutomation(document) || saveState === 'saving'}
          onClick={() => void save({ ...document, status: 'active' })}
        >
          Publish
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-72 shrink-0 border-r bg-card lg:flex lg:flex-col">
          <NodeLibrary query={query} onQueryChange={setQuery} definitions={filteredDefinitions} onAdd={addNode} />
        </aside>

        <section className="relative min-w-0 flex-1" aria-label="Automation canvas">
          <ReactFlow
            nodes={flowNodes}
            edges={document.edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={handleNodesChange}
            onConnect={connect}
            onNodeClick={(_, node) => {
              if (node.id === TRIGGER_ID) return
              setSelectedNodeId(node.id)
              setInspectorOpen(true)
            }}
            onPaneClick={() => setSelectedNodeId(null)}
            fitView
            minZoom={0.25}
            maxZoom={1.75}
            colorMode="system"
            deleteKeyCode={null}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            <Controls position="bottom-left" />
            <MiniMap position="bottom-right" pannable zoomable className="hidden md:block" />
          </ReactFlow>
          <div className="absolute left-3 top-3 flex gap-2 lg:hidden">
            <Button variant="outline" size="sm" onClick={() => setLibraryOpen(true)}><Library data-icon="inline-start" />Steps</Button>
            {selectedNode && <Button variant="outline" size="sm" onClick={() => setInspectorOpen(true)}><PanelRight data-icon="inline-start" />Configure</Button>}
          </div>
        </section>

        <aside className="hidden w-80 shrink-0 border-l bg-card xl:flex xl:flex-col">
          <Inspector key={selectedNode?.id ?? 'document'} document={document} node={selectedNode} issues={issues} onDocumentChange={commit} onNodeChange={updateSelected} onDelete={deleteSelected} />
        </aside>
      </div>

      <Sheet open={libraryOpen} onOpenChange={setLibraryOpen}>
        <SheetContent side="left">
          <SheetHeader><SheetTitle>Step library</SheetTitle><SheetDescription>Add a step to the canvas.</SheetDescription></SheetHeader>
          <NodeLibrary query={query} onQueryChange={setQuery} definitions={filteredDefinitions} onAdd={(kind) => { addNode(kind); setLibraryOpen(false) }} />
        </SheetContent>
      </Sheet>
      <Sheet open={inspectorOpen && Boolean(selectedNode)} onOpenChange={setInspectorOpen}>
        <SheetContent side="right">
          <SheetHeader><SheetTitle>Step settings</SheetTitle><SheetDescription>Configure the selected automation step.</SheetDescription></SheetHeader>
          <Inspector key={selectedNode?.id ?? 'document'} document={document} node={selectedNode} issues={issues} onDocumentChange={commit} onNodeChange={updateSelected} onDelete={deleteSelected} />
        </SheetContent>
      </Sheet>
    </main>
  )
}

function AutomationCanvasNode({ data, selected }: NodeProps) {
  const definition = getAutomationNodeDefinition(String(data.kind))
  const Icon = definition?.icon ?? CircleDot
  const isTrigger = data.kind === 'trigger'
  const isBranch = data.kind === 'condition' || data.kind === 'branch'
  return (
    <div className={cn('min-w-56 rounded-xl border bg-card p-3 shadow-sm transition-shadow', selected && 'ring-2 ring-ring')}>
      {!isTrigger && <Handle type="target" position={Position.Left} />}
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-foreground"><Icon /></span>
        <span className="min-w-0"><span className="block text-sm font-medium">{String(data.label)}</span><span className="block max-w-40 truncate text-xs text-muted-foreground">{String(data.detail || 'Not configured')}</span></span>
      </div>
      {isBranch ? (
        <><Handle id="yes" type="source" position={Position.Right} style={{ top: '38%' }} /><Handle id="no" type="source" position={Position.Right} style={{ top: '72%' }} /></>
      ) : <Handle type="source" position={Position.Right} />}
    </div>
  )
}

function NodeLibrary({ query, onQueryChange, definitions, onAdd }: {
  query: string
  onQueryChange: (value: string) => void
  definitions: typeof AUTOMATION_NODE_DEFINITIONS
  onAdd: (kind: string) => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <h2 className="text-sm font-semibold">Step library</h2>
      <p className="mt-1 text-xs text-muted-foreground">Click a step to add it to the canvas.</p>
      <div className="relative mt-4"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search steps" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search steps" className="pl-9" /></div>
      <ScrollArea className="mt-4 min-h-0 flex-1">
        <div className="flex flex-col gap-5 pr-3">
          {AUTOMATION_NODE_CATEGORIES.map((category) => {
            const items = definitions.filter((definition) => definition.category === category.id)
            if (!items.length) return null
            return <section key={category.id} className="flex flex-col gap-2"><h3 className="text-xs font-medium text-muted-foreground">{category.label}</h3>{items.map((item) => <button key={item.type} type="button" onClick={() => onAdd(item.type)} className="flex items-center gap-3 rounded-lg border bg-background p-3 text-left hover:bg-muted"><item.icon className="size-5 shrink-0" /><span><span className="block text-sm font-medium">{item.label}</span><span className="block text-xs leading-relaxed text-muted-foreground">{item.description}</span></span></button>)}</section>
          })}
        </div>
      </ScrollArea>
    </div>
  )
}

function Inspector({ document, node, issues, onDocumentChange, onNodeChange, onDelete }: {
  document: AutomationEditorDocument
  node?: AutomationEditorNode
  issues: ReturnType<typeof validateAutomationDocument>
  onDocumentChange: (document: AutomationEditorDocument) => void
  onNodeChange: (patch: Partial<AutomationEditorNode>) => void
  onDelete: () => void
}) {
  const [configText, setConfigText] = useState(() => JSON.stringify(node?.config ?? {}, null, 2))
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-5 p-4">
        {node ? <>
          <div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">{getAutomationNodeDefinition(node.kind)?.label ?? humanize(node.kind)}</h2><p className="text-xs text-muted-foreground">Step settings</p></div><Button variant="ghost" size="icon-sm" aria-label="Delete step" onClick={onDelete}><Trash2 /></Button></div>
          <Separator />
          <FieldGroup>
            <Field><FieldLabel htmlFor="step-kind">Step type</FieldLabel><Input id="step-kind" value={node.kind} disabled /></Field>
            <Field><FieldLabel htmlFor="step-config">Configuration (JSON)</FieldLabel><Textarea id="step-config" value={configText} rows={12} className="font-mono text-xs" onChange={(event) => setConfigText(event.target.value)} onBlur={() => { try { onNodeChange({ config: JSON.parse(configText) as Record<string, unknown> }) } catch { toast.error('Configuration must be valid JSON') } }} /></Field>
          </FieldGroup>
        </> : <>
          <div><h2 className="text-sm font-semibold">Automation settings</h2><p className="text-xs text-muted-foreground">Select a step to configure it.</p></div>
          <FieldGroup>
            <Field><FieldLabel htmlFor="automation-description">Description</FieldLabel><Textarea id="automation-description" value={document.description} onChange={(event) => onDocumentChange({ ...document, description: event.target.value })} /></Field>
            <Field><FieldLabel htmlFor="automation-trigger">Trigger type</FieldLabel><Input id="automation-trigger" value={document.trigger.type} onChange={(event) => onDocumentChange({ ...document, trigger: { ...document.trigger, type: event.target.value } })} /></Field>
          </FieldGroup>
        </>}
        <Separator />
        <section aria-labelledby="validation-title" className="flex flex-col gap-2"><div className="flex items-center justify-between"><h3 id="validation-title" className="text-sm font-semibold">Validation</h3><Badge variant={issues.some((issue) => issue.severity === 'error') ? 'destructive' : 'secondary'}>{issues.length || 'Ready'}</Badge></div>{issues.length ? issues.map((issue) => <button type="button" key={issue.id} className="flex items-start gap-2 rounded-md bg-muted p-2 text-left text-xs" onClick={() => issue.nodeId && onDocumentChange(document)}><AlertCircle className="size-4 shrink-0" /><span>{issue.message}</span></button>) : <p className="flex items-center gap-2 text-xs text-muted-foreground"><Check className="size-4" />Ready to publish</p>}</section>
      </div>
    </ScrollArea>
  )
}

function EditorIconButton({ label, children, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
  return <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} {...props} />}>{children}</TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>
}

function SaveIndicator({ state }: { state: AutomationEditorSaveState }) {
  const content = state === 'saved' ? 'Saved' : state === 'saving' ? 'Saving' : state === 'error' ? 'Save failed' : 'Unsaved'
  return <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex" aria-live="polite">{state === 'saving' ? <LoaderCircle className="size-3.5 animate-spin" /> : state === 'error' ? <X className="size-3.5" /> : state === 'saved' ? <Check className="size-3.5" /> : <CircleDot className="size-3.5" />}{content}</span>
}

function summarizeConfig(config: Record<string, unknown>) {
  const value = config.text ?? config.body ?? config.prompt ?? config.url ?? Object.values(config)[0]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function humanize(value: string) {
  return value ? value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Not configured'
}
