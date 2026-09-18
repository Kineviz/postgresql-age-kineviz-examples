import {readFileSync} from "node:fs";
import {join} from "node:path";
import {parseCsv} from "./csv.ts";
import {validateDataset} from "./model.ts";
import type {Dataset, Demo, Properties} from "./model.ts";

const relationships: Record<string, [string, string, string, string, string]> = {
  UsedDevice: ["USED_DEVICE", "Client", "client_id", "Device", "device_id"],
  Paid: ["PAID", "Client", "src_client_id", "Client", "dst_client_id"],
  PaidMerchant: ["PAID_MERCHANT", "Client", "client_id", "Merchant", "merchant_id"],
  HostedAt: ["HOSTED_AT", "Gateway", "gateway_id", "Site", "site_id"],
  ConnectedTo: ["CONNECTED_TO", "Device", "device_id", "Gateway", "gateway_id"],
  RunsFirmware: ["RUNS", "Device", "device_id", "Firmware", "firmware_id"],
  Covers: ["COVERS", "Technician", "technician_id", "Site", "site_id"],
  DependsOn: ["DEPENDS_ON", "Device", "device_id", "Device", "depends_on_id"]
};
interface Manifest {tables: {tableName: string; filePatterns: string[]; columns: {columnName: string; typeName: string}[]}[]}

/** Preserve the upstream deterministic fixtures; convert their interchange CSVs
 * into typed AGE properties, not Spanner schema or runtime dependencies. */
export function readDataset(demo: Demo, directory: string): Dataset {
  const data: Dataset = {vertices: [], edges: []};
  const read = (file: string) => parseCsv(readFileSync(join(directory, file), "utf8"));
  if (demo === "paysim-schemaless") {
    for (const [id, label, properties] of read("GraphNode.csv")) data.vertices.push({id, label, properties: JSON.parse(properties) as Properties});
    for (const [source, target, key, label, properties] of read("GraphEdge.csv")) {
      data.edges.push({id: `${source}/${key}/${target}`, source, target, label, properties: JSON.parse(properties) as Properties});
    }
  } else {
    const manifest = JSON.parse(readFileSync(join(directory, "csv-export.json"), "utf8")) as Manifest;
    for (const table of manifest.tables) {
      for (const [index, cells] of read(table.filePatterns[0]).entries()) {
        const properties: Properties = {};
        table.columns.forEach((column, i) => {
          properties[column.columnName] = /^(FLOAT64|INT64)$/.test(column.typeName) ? Number(cells[i]) : cells[i];
        });
        const spec = relationships[table.tableName];
        if (spec) {
          const [label, sl, sk, tl, tk] = spec;
          data.edges.push({id: `${label}:${index}`, label, source: `${sl}:${properties[sk]}`, target: `${tl}:${properties[tk]}`, properties});
        } else {
          data.vertices.push({id: `${table.tableName}:${properties.id}`, label: table.tableName, properties});
        }
      }
    }
  }
  validateDataset(data);
  return data;
}
export function actorsOnly(data: Dataset): Dataset {
  const vertices = data.vertices.filter(n => n.label !== "transaction");
  const ids = new Set(vertices.map(n => n.id));
  return {vertices, edges: data.edges.filter(e => ids.has(e.source) && ids.has(e.target))};
}
