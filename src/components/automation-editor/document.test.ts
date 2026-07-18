import { describe, expect, it } from "vitest";

import {
  cloneNode,
  createEditorId,
  isEditableTarget,
  removeNodeAndEdges,
  type AutomationEditorNode,
} from "./document";

const node: AutomationEditorNode = {
  id: "message-1",
  kind: "send_message",
  position: { x: 100, y: 160 },
  config: { text: "Hello", nested: { enabled: true } },
  sourceRef: "server-step-id",
};

describe("automation editor document helpers", () => {
  it("creates a non-empty client id", () => {
    expect(createEditorId()).toMatch(/^editor_/);
  });

  it("clones a node without retaining its persistence identity", () => {
    const copy = cloneNode(node);

    expect(copy.id).not.toBe(node.id);
    expect(copy.sourceRef).toBeUndefined();
    expect(copy.position).toEqual({ x: 140, y: 200 });
    expect(copy.config).toEqual(node.config);
    expect(copy.config).not.toBe(node.config);
    expect(copy.config.nested).not.toBe(node.config.nested);
  });

  it("removes a node and all attached edges", () => {
    const result = removeNodeAndEdges(
      [node, { ...node, id: "message-2" }],
      [
        { id: "edge-in", source: "message-2", target: node.id },
        { id: "edge-out", source: node.id, target: "message-2" },
        { id: "edge-keep", source: "message-2", target: "message-2" },
      ],
      node.id,
    );

    expect(result.nodes.map((item) => item.id)).toEqual(["message-2"]);
    expect(result.edges.map((item) => item.id)).toEqual(["edge-keep"]);
  });

  it("recognizes editable shortcut targets", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(isEditableTarget({ tagName } as unknown as EventTarget)).toBe(true);
    }

    expect(
      isEditableTarget({
        tagName: "DIV",
        isContentEditable: true,
      } as unknown as EventTarget),
    ).toBe(true);
    expect(isEditableTarget({ tagName: "BUTTON" } as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
