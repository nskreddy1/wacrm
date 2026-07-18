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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  type AutomationNodeCategory,
  type NodeField,
} from './node-registry'
import { canPublishAutomation, validateAutomationDocument } from './validation'

const TRIGGER_ID = 'trigger'
const NODE_TYPES = { automation: AutomationCanvasNode }

/** Strong ease-out curve (animations.dev). Built-in easings feel weak. */
const EASE_OUT = 'ease-[cubic-bezier(0.23,1,0.32,1)]'

/** Category accent tokens keep the canvas and palette visually coherent. */
const CATEGORY_ACCENT: Record<AutomationNodeCategory | 'trigger', string> = {
  trigger: 'bg-primary/10 text-primary',
  messaging: 'bg-chart-1/15 text-chart-1',
  logic: 'bg-chart-4/15 text-chart-4',
  crm: 'bg-chart-2/15 text-chart-2',
  control: 'bg-muted text-muted-foreground',
}

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
      <header className="flex min-h-16 items-center gap-2 border-b bg-card px-4 lg:px-6">
        <a
          href={backHref}
          aria-label="Back to automations"
          className={cn(
            'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            EASE_OUT,
          )}
        >
          <ChevronLeft />
        </a>
        <div className="min-w-0 flex-1">
          <Input
            aria-label="Automation name"
            value={document.name}
            onChange={(event) => commit({ ...document, name: event.target.value })}
            placeholder="Untitled automation"
            className="h-auto truncate border-0 bg-transparent px-0 text-base font-semibold shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="h-5 px-1.5 text-[11px] font-medium">
              {document.mode === 'rule' ? 'Rule' : 'Flow'}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {document.mode === 'rule' ? 'Rule automation' : 'Conversation flow'}
            </span>
          </div>
        </div>
        <SaveIndicator state={saveState} />
        <div className="mx-1 flex items-center gap-0.5 rounded-md border bg-background p-0.5">
          <EditorIconButton label="Undo" disabled={!history.past.length} onClick={() => dispatch({ type: 'undo' })}><Undo2 /></EditorIconButton>
          <EditorIconButton label="Redo" disabled={!history.future.length} onClick={() => dispatch({ type: 'redo' })}><Redo2 /></EditorIconButton>
        </div>
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
  const accent = CATEGORY_ACCENT[isTrigger ? 'trigger' : definition?.category ?? 'control']
  const detail = String(data.detail || '')
  const handleClass = 'size-2.5 rounded-full border-2 border-card bg-muted-foreground transition-colors hover:bg-primary'
  return (
    <div
      className={cn(
        'group min-w-56 rounded-xl border bg-card p-3 shadow-sm transition-[box-shadow,transform,border-color] motion-reduce:transition-none',
        EASE_OUT,
        'hover:-translate-y-0.5 hover:shadow-md',
        selected ? 'border-primary ring-2 ring-primary/40' : 'hover:border-border',
      )}
    >
      {!isTrigger && <Handle type="target" position={Position.Left} className={handleClass} />}
      <div className="flex items-center gap-3">
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4.5', accent)}>
          <Icon />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium leading-tight">{String(data.label)}</span>
          <span className={cn('mt-0.5 block max-w-40 truncate text-xs', detail ? 'text-muted-foreground' : 'italic text-muted-foreground/70')}>
            {detail || 'Not configured'}
          </span>
        </span>
      </div>
      {isBranch ? (
        <>
          <span className="pointer-events-none absolute right-3 top-[34%] -translate-y-1/2 text-[10px] font-medium text-muted-foreground">Yes</span>
          <span className="pointer-events-none absolute right-3 top-[68%] -translate-y-1/2 text-[10px] font-medium text-muted-foreground">No</span>
          <Handle id="yes" type="source" position={Position.Right} className={handleClass} style={{ top: '38%' }} />
          <Handle id="no" type="source" position={Position.Right} className={handleClass} style={{ top: '72%' }} />
        </>
      ) : <Handle type="source" position={Position.Right} className={handleClass} />}
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
            return (
              <section key={category.id} className="flex flex-col gap-2">
                <h3 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{category.label}</h3>
                {items.map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => onAdd(item.type)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border bg-background p-2.5 text-left transition-[background-color,border-color,transform] motion-reduce:transition-none',
                      EASE_OUT,
                      'hover:border-border hover:bg-muted active:scale-[0.98]',
                    )}
                  >
                    <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-md [&_svg]:size-4', CATEGORY_ACCENT[item.category])}>
                      <item.icon />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium leading-tight">{item.label}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.description}</span>
                    </span>
                  </button>
                ))}
              </section>
            )
          })}
          {!definitions.length && (
            <p className="px-1 py-8 text-center text-sm text-muted-foreground">No steps match your search.</p>
          )}
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
  const definition = node ? getAutomationNodeDefinition(node.kind) : undefined
  const DefinitionIcon = definition?.icon
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-5 p-4">
        {node ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                {DefinitionIcon && (
                  <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4.5', CATEGORY_ACCENT[definition?.category ?? 'control'])}>
                    <DefinitionIcon />
                  </span>
                )}
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">{definition?.label ?? humanize(node.kind)}</h2>
                  <p className="truncate text-xs text-muted-foreground">{definition?.description ?? 'Step settings'}</p>
                </div>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label="Delete step" onClick={onDelete}>
                <Trash2 />
              </Button>
            </div>
            <Separator />
            <NodeConfigForm node={node} fields={definition?.fields ?? []} onNodeChange={onNodeChange} />
          </>
        ) : (
          <>
            <div>
              <h2 className="text-sm font-semibold">Automation settings</h2>
              <p className="text-xs text-muted-foreground">Select a step on the canvas to configure it.</p>
            </div>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="automation-description">Description</FieldLabel>
                <Textarea id="automation-description" value={document.description} placeholder="What does this automation do?" onChange={(event) => onDocumentChange({ ...document, description: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="automation-trigger">Trigger type</FieldLabel>
                <Input id="automation-trigger" value={document.trigger.type} onChange={(event) => onDocumentChange({ ...document, trigger: { ...document.trigger, type: event.target.value } })} />
              </Field>
            </FieldGroup>
          </>
        )}
        <Separator />
        <section aria-labelledby="validation-title" className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 id="validation-title" className="text-sm font-semibold">Validation</h3>
            <Badge variant={issues.some((issue) => issue.severity === 'error') ? 'destructive' : 'secondary'}>
              {issues.length ? `${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}` : 'Ready'}
            </Badge>
          </div>
          {issues.length ? (
            <ul className="flex flex-col gap-1.5">
              {issues.map((issue) => (
                <li
                  key={issue.id}
                  className={cn(
                    'flex items-start gap-2 rounded-md border p-2 text-xs',
                    issue.severity === 'error'
                      ? 'border-destructive/30 bg-destructive/10 text-destructive'
                      : 'border-border bg-muted text-muted-foreground',
                  )}
                >
                  <AlertCircle className="mt-px size-3.5 shrink-0" />
                  <span className="leading-relaxed">{issue.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Check className="size-4 text-primary" />
              Ready to publish
            </p>
          )}
        </section>
      </div>
    </ScrollArea>
  )
}

function NodeConfigForm({ node, fields, onNodeChange }: {
  node: AutomationEditorNode
  fields: NodeField[]
  onNodeChange: (patch: Partial<AutomationEditorNode>) => void
}) {
  const setValue = (key: string, value: unknown) => {
    onNodeChange({ config: { ...node.config, [key]: value } })
  }

  return (
    <FieldGroup>
      {fields.length === 0 && (
        <p className="rounded-md border border-dashed bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
          This step has no simple settings yet. Use the advanced editor below to configure it, or edit it once more options are available.
        </p>
      )}
      {fields.map((field) => {
        const id = `field-${field.key}`
        const raw = node.config[field.key]
        return (
          <Field key={field.key}>
            <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
            {field.type === 'textarea' ? (
              <Textarea id={id} rows={4} value={String(raw ?? '')} placeholder={field.placeholder} onChange={(event) => setValue(field.key, event.target.value)} />
            ) : field.type === 'number' ? (
              <Input id={id} type="number" min={field.min} value={raw === undefined || raw === null ? '' : String(raw)} placeholder={field.placeholder} onChange={(event) => setValue(field.key, event.target.value === '' ? '' : Number(event.target.value))} />
            ) : field.type === 'select' ? (
              <Select value={String(raw ?? '')} onValueChange={(value) => setValue(field.key, value)}>
                <SelectTrigger id={id} className="w-full">
                  <SelectValue placeholder="Select an option" />
                </SelectTrigger>
                <SelectContent>
                  {field.options?.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input id={id} value={String(raw ?? '')} placeholder={field.placeholder} onChange={(event) => setValue(field.key, event.target.value)} />
            )}
            {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
          </Field>
        )
      })}
      <AdvancedConfigEditor node={node} onNodeChange={onNodeChange} />
    </FieldGroup>
  )
}

function AdvancedConfigEditor({ node, onNodeChange }: {
  node: AutomationEditorNode
  onNodeChange: (patch: Partial<AutomationEditorNode>) => void
}) {
  const [configText, setConfigText] = useState(() => JSON.stringify(node.config ?? {}, null, 2))
  return (
    <details className="rounded-md border bg-muted/30">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground">Advanced (raw JSON)</summary>
      <div className="border-t p-3">
        <Textarea
          aria-label="Raw configuration JSON"
          value={configText}
          rows={10}
          className="font-mono text-xs"
          onChange={(event) => setConfigText(event.target.value)}
          onBlur={() => {
            try {
              onNodeChange({ config: JSON.parse(configText) as Record<string, unknown> })
            } catch {
              toast.error('Configuration must be valid JSON')
            }
          }}
        />
      </div>
    </details>
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
