"use client"

import { memo, useCallback, useEffect, useMemo, useState, type ComponentType } from "react"
import dagre from "@dagrejs/dagre"
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import {
  Bot,
  Check,
  ChevronRight,
  GitBranch,
  LayoutTemplate,
  MessageSquare,
  Plus,
  Search,
  Timer,
  Webhook,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { AutomationStepType, AutomationTriggerType } from "@/types"
import type { BuilderStep, ParentScope, StepPath } from "./automation-builder"

const NODE_WIDTH = 248
const NODE_HEIGHT = 104

type InsertTarget = { parent: ParentScope; index: number; label: string }

type CanvasNodeData = {
  kind: "trigger" | "step" | "condition" | "insert"
  title: string
  eyebrow: string
  summary?: string
  icon?: LucideIcon
  selected?: boolean
  path?: StepPath
  stepType?: AutomationStepType
  target?: InsertTarget
  onSelect?: () => void
  onInsert?: (target: InsertTarget) => void
}

type CanvasNode = Node<CanvasNodeData>

const STEP_LIBRARY: {
  group: string
  items: { type: AutomationStepType; label: string; icon: LucideIcon; description: string }[]
}[] = [
  {
    group: "Messaging",
    items: [
      { type: "send_message", label: "Send message", icon: MessageSquare, description: "Send a text reply" },
      { type: "send_buttons", label: "Send buttons", icon: MessageSquare, description: "Offer quick actions" },
      { type: "send_list", label: "Send list", icon: LayoutTemplate, description: "Send a structured list" },
      { type: "send_template", label: "Send template", icon: LayoutTemplate, description: "Use an approved template" },
    ],
  },
  {
    group: "Contact & CRM",
    items: [
      { type: "add_tag", label: "Add tag", icon: Check, description: "Apply a contact tag" },
      { type: "remove_tag", label: "Remove tag", icon: X, description: "Remove a contact tag" },
      { type: "update_contact_field", label: "Update contact", icon: Bot, description: "Change a contact field" },
      { type: "create_deal", label: "Create deal", icon: ChevronRight, description: "Add a pipeline deal" },
      { type: "assign_conversation", label: "Assign conversation", icon: Bot, description: "Route to a teammate" },
      { type: "close_conversation", label: "Close conversation", icon: Check, description: "Mark conversation closed" },
    ],
  },
  {
    group: "Logic & integrations",
    items: [
      { type: "condition", label: "Condition", icon: GitBranch, description: "Create Yes and No paths" },
      { type: "wait", label: "Wait", icon: Timer, description: "Pause before continuing" },
      { type: "send_webhook", label: "Send webhook", icon: Webhook, description: "Call an external endpoint" },
    ],
  },
]

function WorkflowNode({ data }: NodeProps<CanvasNode>) {
  const Icon = data.icon ?? Zap
  if (data.kind === "insert") {
    return (
      <button
        type="button"
        onClick={() => data.target && data.onInsert?.(data.target)}
        className="group flex size-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={data.target?.label ?? "Add workflow step"}
      >
        <Plus aria-hidden="true" className="size-4" />
      </button>
    )
  }

  const isCondition = data.kind === "condition"
  return (
    <button
      type="button"
      onClick={data.onSelect}
      className={cn(
        "w-[248px] rounded-xl border bg-card text-left shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        data.selected ? "border-primary ring-2 ring-primary/20" : "border-border",
      )}
      aria-pressed={data.selected}
      aria-label={`Configure ${data.title}`}
    >
      <Handle type="target" position={Position.Left} className="!size-2.5 !border-2 !border-card !bg-muted-foreground" />
      <div className="flex items-start gap-3 p-4">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", isCondition ? "bg-secondary text-secondary-foreground" : "bg-primary-soft text-primary")}>
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{data.eyebrow}</span>
            {data.kind === "trigger" ? <Badge variant="secondary">Start</Badge> : null}
          </span>
          <span className="mt-1 block truncate text-sm font-semibold text-foreground">{data.title}</span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">{data.summary || "Select to configure"}</span>
        </span>
      </div>
      {isCondition ? (
        <>
          <Handle id="yes" type="source" position={Position.Right} style={{ top: 36 }} className="!size-2.5 !border-2 !border-card !bg-primary" />
          <Handle id="no" type="source" position={Position.Right} style={{ top: 76 }} className="!size-2.5 !border-2 !border-card !bg-muted-foreground" />
        </>
      ) : (
        <Handle type="source" position={Position.Right} className="!size-2.5 !border-2 !border-card !bg-primary" />
      )}
    </button>
  )
}

const MemoWorkflowNode = memo(WorkflowNode)
const nodeTypes = { workflow: MemoWorkflowNode as ComponentType<NodeProps<CanvasNode>> }

function layoutGraph(nodes: CanvasNode[], edges: Edge[]) {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
  graph.setGraph({ rankdir: "LR", ranksep: 92, nodesep: 54, marginx: 40, marginy: 40 })
  nodes.forEach((node) => graph.setNode(node.id, { width: node.data.kind === "insert" ? 36 : NODE_WIDTH, height: node.data.kind === "insert" ? 36 : NODE_HEIGHT }))
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target))
  dagre.layout(graph)
  return nodes.map((node) => {
    const point = graph.node(node.id)
    const width = node.data.kind === "insert" ? 36 : NODE_WIDTH
    const height = node.data.kind === "insert" ? 36 : NODE_HEIGHT
    return { ...node, position: { x: point.x - width / 2, y: point.y - height / 2 } }
  })
}

function graphFromTree({
  steps,
  triggerType,
  selectedId,
  labelForStep,
  labelForTrigger,
  summaryForStep,
  onSelect,
  onInsert,
}: {
  steps: BuilderStep[]
  triggerType: AutomationTriggerType
  selectedId: string
  labelForStep: (type: AutomationStepType) => string
  labelForTrigger: (type: AutomationTriggerType) => string
  summaryForStep: (step: BuilderStep) => string
  onSelect: (id: string) => void
  onInsert: (target: InsertTarget) => void
}) {
  const nodes: CanvasNode[] = []
  const edges: Edge[] = []
  const edgeBase = { type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeWidth: 1.5 } }
  nodes.push({ id: "trigger", type: "workflow", position: { x: 0, y: 0 }, data: { kind: "trigger", title: labelForTrigger(triggerType), eyebrow: "Workflow trigger", summary: "Runs when this event occurs", icon: Zap, selected: selectedId === "trigger", onSelect: () => onSelect("trigger") } })

  const walk = (list: BuilderStep[], parentId: string, parentPath: StepPath, scope: ParentScope, sourceHandle?: string) => {
    let previousId = parentId
    list.forEach((step, index) => {
      const path: StepPath = [...parentPath, scope.kind === "root" ? { kind: "root", index } : { kind: "branch", parentCid: scope.parentCid, branch: scope.branch, index }]
      const currentHandle = index === 0 ? sourceHandle : undefined
      nodes.push({ id: step.cid, type: "workflow", position: { x: 0, y: 0 }, data: { kind: step.step_type === "condition" ? "condition" : "step", title: labelForStep(step.step_type), eyebrow: step.step_type === "condition" ? "Decision" : "Action", summary: summaryForStep(step), icon: step.step_type === "condition" ? GitBranch : undefined, selected: selectedId === step.cid, path, stepType: step.step_type, onSelect: () => onSelect(step.cid) } })
      edges.push({ id: `e-${previousId}-${step.cid}-${currentHandle ?? "main"}`, source: previousId, target: step.cid, sourceHandle: currentHandle, label: currentHandle === "yes" ? "Yes" : currentHandle === "no" ? "No" : undefined, labelStyle: { fill: "var(--muted-foreground)", fontSize: 11, fontWeight: 600 }, labelBgStyle: { fill: "var(--background)" }, ...edgeBase })
      if (step.step_type === "condition" && step.branches) {
        walk(step.branches.yes, step.cid, path, { kind: "branch", parentCid: step.cid, branch: "yes" }, "yes")
        walk(step.branches.no, step.cid, path, { kind: "branch", parentCid: step.cid, branch: "no" }, "no")
        for (const branch of ["yes", "no"] as const) {
          if (step.branches[branch].length === 0) {
            const id = `insert-${step.cid}-${branch}-0`
            nodes.push({ id, type: "workflow", position: { x: 0, y: 0 }, data: { kind: "insert", title: "Add step", eyebrow: "", target: { parent: { kind: "branch", parentCid: step.cid, branch }, index: 0, label: `Add step to ${branch} branch` }, onInsert } })
            edges.push({ id: `e-${step.cid}-${id}`, source: step.cid, target: id, sourceHandle: branch, label: branch === "yes" ? "Yes" : "No", labelStyle: { fill: "var(--muted-foreground)", fontSize: 11, fontWeight: 600 }, labelBgStyle: { fill: "var(--background)" }, ...edgeBase })
          }
        }
      }
      previousId = step.cid
    })
    if (list.length > 0) {
      const id = `insert-${scope.kind === "root" ? "root" : `${scope.parentCid}-${scope.branch}`}-${list.length}`
      nodes.push({ id, type: "workflow", position: { x: 0, y: 0 }, data: { kind: "insert", title: "Add step", eyebrow: "", target: { parent: scope, index: list.length, label: "Add next workflow step" }, onInsert } })
      edges.push({ id: `e-${previousId}-${id}-add`, source: previousId, target: id, ...edgeBase })
    }
  }

  if (steps.length === 0) {
    const target: InsertTarget = { parent: { kind: "root" }, index: 0, label: "Add first workflow step" }
    nodes.push({ id: "insert-root-0", type: "workflow", position: { x: 0, y: 0 }, data: { kind: "insert", title: "Add step", eyebrow: "", target, onInsert } })
    edges.push({ id: "e-trigger-insert", source: "trigger", target: "insert-root-0", ...edgeBase })
  } else {
    walk(steps, "trigger", [], { kind: "root" })
  }
  return { nodes: layoutGraph(nodes, edges), edges }
}

function CanvasToolbar() {
  const { fitView } = useReactFlow()
  return (
    <div className="absolute top-4 left-4 flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm">
      <Button type="button" variant="ghost" size="sm" onClick={() => fitView({ padding: 0.22, duration: 300 })}>
        <LayoutTemplate data-icon="inline-start" />
        Auto layout
      </Button>
    </div>
  )
}

function StepLibrary({ target, onClose, onAdd }: { target: InsertTarget; onClose: () => void; onAdd: (target: InsertTarget, type: AutomationStepType) => void }) {
  const [query, setQuery] = useState("")
  const normalized = query.trim().toLowerCase()
  return (
    <aside className="absolute top-4 right-4 bottom-4 flex w-[340px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl" aria-label="Step library">
      <header className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Add a step</h2>
          <p className="mt-1 text-xs text-muted-foreground">Choose what happens next in this path.</p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close step library"><X /></Button>
      </header>
      <div className="p-3">
        <div className="relative">
          <Search aria-hidden="true" className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search actions and logic" className="pl-9" autoFocus />
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1 px-3 pb-3">
        <div className="flex flex-col gap-5">
          {STEP_LIBRARY.map((section) => {
            const items = section.items.filter((item) => !normalized || `${item.label} ${item.description}`.toLowerCase().includes(normalized))
            if (!items.length) return null
            return (
              <section key={section.group} className="flex flex-col gap-1">
                <h3 className="px-2 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{section.group}</h3>
                {items.map((item) => {
                  const Icon = item.icon
                  return (
                    <button key={item.type} type="button" onClick={() => onAdd(target, item.type)} className="flex items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"><Icon aria-hidden="true" className="size-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-foreground">{item.label}</span><span className="block truncate text-xs text-muted-foreground">{item.description}</span></span>
                      <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
                    </button>
                  )
                })}
              </section>
            )
          })}
        </div>
      </ScrollArea>
    </aside>
  )
}

function AutomationFlowInner(props: {
  steps: BuilderStep[]
  triggerType: AutomationTriggerType
  selectedId: string
  onSelect: (id: string) => void
  onAdd: (parent: ParentScope, index: number, type: AutomationStepType) => void
  onDeleteSelected: () => void
  labelForStep: (type: AutomationStepType) => string
  labelForTrigger: (type: AutomationTriggerType) => string
  summaryForStep: (step: BuilderStep) => string
}) {
  const [target, setTarget] = useState<InsertTarget | null>(null)
  const { fitView } = useReactFlow()
  const graph = useMemo(() => graphFromTree({ ...props, onInsert: setTarget }), [props])
  useEffect(() => { const timeout = window.setTimeout(() => fitView({ padding: 0.22, duration: 250 }), 40); return () => window.clearTimeout(timeout) }, [props.steps.length, fitView])
  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if ((event.key === "Backspace" || event.key === "Delete") && props.selectedId !== "trigger") {
      const targetElement = event.target as HTMLElement
      if (targetElement.matches("input, textarea, select, [contenteditable='true']")) return
      event.preventDefault()
      props.onDeleteSelected()
    }
  }, [props])
  return (
    <div className="relative size-full bg-background" onKeyDown={onKeyDown}>
      <ReactFlow nodes={graph.nodes} edges={graph.edges} nodeTypes={nodeTypes} nodesDraggable nodesConnectable={false} elementsSelectable fitView minZoom={0.25} maxZoom={1.5} fitViewOptions={{ padding: 0.22 }} proOptions={{ hideAttribution: true }} onPaneClick={() => props.onSelect("")}>
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
        <Controls position="bottom-left" showInteractive={false} className="!overflow-hidden !rounded-lg !border !border-border !bg-card !shadow-sm [&_button]:!border-border [&_button]:!bg-card [&_button]:!text-foreground [&_button:hover]:!bg-muted" />
        <MiniMap position="bottom-right" pannable zoomable nodeColor={(node) => node.data?.kind === "condition" ? "var(--secondary)" : "var(--primary)"} maskColor="color-mix(in oklch, var(--background) 80%, transparent)" className="!rounded-lg !border !border-border !bg-card" />
        <CanvasToolbar />
      </ReactFlow>
      {target ? <StepLibrary target={target} onClose={() => setTarget(null)} onAdd={(insertTarget, type) => { props.onAdd(insertTarget.parent, insertTarget.index, type); setTarget(null) }} /> : null}
    </div>
  )
}

export function AutomationFlowCanvas(props: Parameters<typeof AutomationFlowInner>[0]) {
  return <ReactFlowProvider><AutomationFlowInner {...props} /></ReactFlowProvider>
}
