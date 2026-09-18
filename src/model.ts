export type Properties = Record<string, string | number | boolean | null>;
export interface Vertex { id: string; label: string; properties: Properties }
export interface Edge { id: string; label: string; source: string; target: string; properties: Properties }
export interface Dataset { vertices: Vertex[]; edges: Edge[] }
export const demos = {
  "fraud-rings": {graph: "fraud_rings", title: "Shared devices, payment rings, and an innocent family"},
  "edge-fleet": {graph: "edge_fleet", title: "Gateway concentration, firmware exposure, and dependencies"},
  "paysim-schemaless": {graph: "paysim", title: "Flexible properties, shared identifiers, and payment trails"}
} as const;
export type Demo = keyof typeof demos;
export function demoName(value: string | undefined): Demo {
  if (!value || !Object.hasOwn(demos, value)) throw new Error(`Choose a demo: ${Object.keys(demos).join(", ")}`);
  return value as Demo;
}
export function validateDataset(data: Dataset): void {
  const ids = new Set<string>();
  for (const node of data.vertices) {
    if (ids.has(node.id)) throw new Error(`Duplicate vertex: ${node.id}`);
    ids.add(node.id);
  }
  const edges = new Set<string>();
  for (const edge of data.edges) {
    if (edges.has(edge.id)) throw new Error(`Duplicate edge: ${edge.id}`);
    if (!ids.has(edge.source) || !ids.has(edge.target)) throw new Error(`Missing endpoint: ${edge.id}`);
    edges.add(edge.id);
  }
}
