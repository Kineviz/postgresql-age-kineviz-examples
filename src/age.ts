import type {Dataset, Properties} from "./model.ts";
export const sqlString = (value: string): string => `'${value.replaceAll("'", "''")}'`;
export function identifier(value: string): string {
  if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(value)) throw new Error(`Invalid identifier: ${value}`);
  return value;
}
/** Keys are identifiers in Cypher maps; JSON object syntax is not Cypher. */
export function literal(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(literal).join(",")}]`;
  if (typeof value === "object" && value) return `{${Object.entries(value).map(([key, v]) => `\`${key.replaceAll("`", "``")}\`:${literal(v)}`).join(",")}}`;
  throw new Error("Unsupported Cypher property value");
}
export function cypher(graph: string, query: string, columns = "value agtype"): string {
  // AGE's parser requires a dollar-quoted query constant. Pick a delimiter
  // absent from the payload so strings cannot terminate the SQL literal.
  let delimiter = "$age$";
  while (query.includes(delimiter)) delimiter = delimiter.slice(0, -1) + "x$";
  return `SELECT * FROM ag_catalog.cypher(${sqlString(identifier(graph))}, ${delimiter}${query}${delimiter}) AS (${columns})`;
}
function chunks<T>(items: T[], size = 250): T[][] {
  return Array.from({length: Math.ceil(items.length / size)}, (_, i) => items.slice(i * size, (i + 1) * size));
}
export function loadStatements(graph: string, data: Dataset): string[] {
  identifier(graph);
  const statements = [`SELECT ag_catalog.create_graph(${sqlString(graph)})`];
  const labels = [...new Set(data.vertices.map(n => n.label))];
  for (const label of labels) {
    identifier(label);
    statements.push(`SELECT ag_catalog.create_vlabel(${sqlString(graph)}, ${sqlString(label)})`);
    for (const batch of chunks(data.vertices.filter(n => n.label === label))) {
      const rows = batch.map(n => ({...n.properties, _key: n.id}));
      statements.push(cypher(graph, `UNWIND ${literal(rows)} AS row CREATE (n:${label}) SET n = row`));
    }
    // MATCH property predicates use agtype containment; the GIN index keeps
    // batched endpoint matching practical for the 12,033-transaction demo.
    statements.push(`CREATE INDEX ON "${graph}"."${label}" USING gin (properties)`);
  }
  const nodes = new Map(data.vertices.map(n => [n.id, n]));
  const groups = new Map<string, {label: string; sourceLabel: string; targetLabel: string; rows: unknown[]}>();
  for (const edge of data.edges) {
    const sourceLabel = nodes.get(edge.source)!.label, targetLabel = nodes.get(edge.target)!.label;
    const key = `${edge.label}/${sourceLabel}/${targetLabel}`;
    if (!groups.has(key)) groups.set(key, {label: identifier(edge.label), sourceLabel, targetLabel, rows: []});
    groups.get(key)!.rows.push({source: edge.source, target: edge.target, properties: {...edge.properties, _key: edge.id}});
  }
  for (const label of new Set(data.edges.map(e => e.label))) statements.push(`SELECT ag_catalog.create_elabel(${sqlString(graph)}, ${sqlString(identifier(label))})`);
  for (const label of labels) statements.push(`ANALYZE "${graph}"."${label}"`);
  for (const {label, sourceLabel, targetLabel, rows} of groups.values()) {
    for (const batch of chunks(rows)) statements.push(cypher(graph,
      `UNWIND ${literal(batch)} AS row WITH row.source AS source, row.target AS target, row.properties AS props MATCH (a:${sourceLabel} {_key: source}), (b:${targetLabel} {_key: target}) CREATE (a)-[e:${label}]->(b) SET e = props`));
  }
  return statements;
}
export function countsQuery(graph: string): string {
  return `SELECT (SELECT count(*) FROM "${identifier(graph)}"._ag_label_vertex) AS vertices, (SELECT count(*) FROM "${graph}"._ag_label_edge) AS edges`;
}
export function replayStatement(graph: string, transaction: {id: string; source: string; target: string; targetLabel: string; relationship: string; properties: Properties}): string {
  const {id, source, target, properties} = transaction;
  return cypher(graph, `MATCH (a:client {_key:${literal(source)}}), (b:${identifier(transaction.targetLabel)} {_key:${literal(target)}})
    MERGE (t:transaction {_key:${literal(id)}}) SET t += ${literal(properties)}
    MERGE (a)-[p:performs {_key:${literal(`${source}/p${properties.globalstep}/${id}`)}}]->(t) SET p.timestamp = ${literal(properties.timestamp)}
    MERGE (t)-[r:${identifier(transaction.relationship)} {_key:${literal(`${id}/t${properties.globalstep}/${target}`)}}]->(b) SET r.timestamp = ${literal(properties.timestamp)} RETURN t._key`);
}
