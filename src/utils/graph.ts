import type { PipelineNode, PipelineEdge } from "../types/pipeline";

/**
 * Detect if a directed graph contains a cycle using DFS 3-color marking.
 *
 * Colors:
 *   0 = WHITE — not yet visited
 *   1 = GRAY  — currently on the DFS stack (in progress)
 *   2 = BLACK — fully explored
 *
 * A cycle exists if DFS reaches a GRAY node (we looped back to a node
 * already on the current path).
 */
export function detectCycle(nodes: PipelineNode[], edges: PipelineEdge[]): boolean {
  const color = new Map<string, 0 | 1 | 2>();
  nodes.forEach((n) => color.set(n.id, 0));

  const dfs = (nodeId: string): boolean => {
    color.set(nodeId, 1); // GRAY — on current path
    const outgoing = edges.filter((e) => e.from === nodeId);
    for (const edge of outgoing) {
      const c = color.get(edge.to);
      if (c === 1) return true; // reached a GRAY node → cycle
      if (c === 0 && dfs(edge.to)) return true;
    }
    color.set(nodeId, 2); // BLACK — fully explored
    return false;
  };

  for (const node of nodes) {
    if (color.get(node.id) === 0 && dfs(node.id)) return true;
  }
  return false;
}

/**
 * Topological sort using Kahn's algorithm.
 *
 * Returns an ordered list of node IDs such that for every edge A→B,
 * A appears before B. Returns null if the graph has a cycle (should
 * not happen if detectCycle() is called first).
 */
export function topologicalSort(
  nodes: PipelineNode[],
  edges: PipelineEdge[]
): string[] | null {
  const inDegree = new Map<string, number>();
  nodes.forEach((n) => inDegree.set(n.id, 0));

  for (const edge of edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const queue: string[] = [];
  inDegree.forEach((deg, id) => {
    if (deg === 0) queue.push(id);
  });

  const result: string[] = [];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    result.push(nodeId);
    const outgoing = edges.filter((e) => e.from === nodeId);
    for (const edge of outgoing) {
      const newDeg = (inDegree.get(edge.to) ?? 0) - 1;
      inDegree.set(edge.to, newDeg);
      if (newDeg === 0) queue.push(edge.to);
    }
  }

  if (result.length !== nodes.length) return null; // cycle detected
  return result;
}

/**
 * Group topologically sorted nodes into parallel execution layers.
 *
 * Nodes in the same layer have no dependency on each other and can run
 * concurrently. Layers are executed sequentially.
 *
 * Example: edges A→C, B→C, C→D
 *   Layer 0: [A, B]  — both roots, run in parallel
 *   Layer 1: [C]     — waits for A and B
 *   Layer 2: [D]     — waits for C
 */
export function getExecutionLayers(
  nodes: PipelineNode[],
  edges: PipelineEdge[]
): string[][] {
  const inDegree = new Map<string, number>();
  nodes.forEach((n) => inDegree.set(n.id, 0));

  for (const edge of edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const layers: string[][] = [];
  const remaining = new Set(nodes.map((n) => n.id));

  while (remaining.size > 0) {
    // Collect all nodes with in-degree 0 in the remaining set
    const layer = [...remaining].filter((id) => (inDegree.get(id) ?? 0) === 0);
    if (layer.length === 0) break; // cycle guard

    layers.push(layer);
    layer.forEach((id) => {
      remaining.delete(id);
      // Reduce in-degree for successors
      edges
        .filter((e) => e.from === id)
        .forEach((e) => {
          inDegree.set(e.to, (inDegree.get(e.to) ?? 0) - 1);
        });
    });
  }

  return layers;
}
