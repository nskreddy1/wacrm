export type AutomationEditorMode = "rule" | "flow";
export type AutomationEditorSaveState = "saved" | "unsaved" | "saving" | "error";

export interface XYPosition {
  x: number;
  y: number;
}

export interface AutomationEditorTrigger {
  type: string;
  config: Record<string, unknown>;
}

export interface AutomationEditorNode {
  id: string;
  kind: string;
  position: XYPosition;
  config: Record<string, unknown>;
  sourceRef?: string;
}

export interface AutomationEditorEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface AutomationEditorDocument {
  id?: string;
  mode: AutomationEditorMode;
  name: string;
  description: string;
  status: "draft" | "active" | "inactive" | "archived";
  trigger: AutomationEditorTrigger;
  nodes: AutomationEditorNode[];
  edges: AutomationEditorEdge[];
  revision: number;
}

export function createEditorId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

  return `editor_${random}`;
}

export function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

export function cloneNode(
  node: AutomationEditorNode,
  offset: XYPosition = { x: 40, y: 40 },
): AutomationEditorNode {
  return {
    ...node,
    id: createEditorId(),
    position: {
      x: node.position.x + offset.x,
      y: node.position.y + offset.y,
    },
    config: cloneValue(node.config),
    sourceRef: undefined,
  };
}

export function removeNodeAndEdges(
  nodes: AutomationEditorNode[],
  edges: AutomationEditorEdge[],
  nodeId: string,
): { nodes: AutomationEditorNode[]; edges: AutomationEditorEdge[] } {
  return {
    nodes: nodes.filter((node) => node.id !== nodeId),
    edges: edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
  };
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;

  const candidate = target as EventTarget & {
    tagName?: string;
    isContentEditable?: boolean;
    closest?: (selector: string) => Element | null;
  };
  const tagName = candidate.tagName?.toLowerCase();

  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    candidate.isContentEditable === true ||
    candidate.closest?.('[contenteditable="true"], [contenteditable=""]') != null
  );
}
