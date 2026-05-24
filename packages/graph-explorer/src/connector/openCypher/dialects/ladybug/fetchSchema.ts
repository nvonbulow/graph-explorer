import type { LoggerConnector } from "@/connector/LoggerConnector";
import type { SchemaResponse } from "@/connector/useGEFetchTypes";

import { createEdgeType, createVertexType, type EdgeConnection } from "@/core";

import type { OpenCypherFetch } from "../../types";

import {
  escapeLadybugString,
  normalizeResponseRecords,
  parseShowConnectionRows,
  parseShowTablesRows,
  parseTableInfoRows,
  readTablePrimaryKey,
} from "./schemaReaders";

const SHOW_TABLES_QUERY = "CALL show_tables() RETURN *";

export type LadybugDiscoveredSchema = {
  schema: SchemaResponse;
  primaryKeysByLabel: ReadonlyMap<string, string>;
  edgeConnectionsByType: ReadonlyMap<string, readonly EdgeConnection[]>;
};

export async function discoverLadybugSchema(
  openCypherFetch: OpenCypherFetch,
): Promise<LadybugDiscoveredSchema> {
  const tables = parseShowTablesRows(
    await queryRecords(openCypherFetch, SHOW_TABLES_QUERY),
  );
  const vertices: SchemaResponse["vertices"] = [];
  const edges: SchemaResponse["edges"] = [];
  const edgeTables: string[] = [];
  const edgeConnections: EdgeConnection[] = [];
  const primaryKeysByLabel = new Map<string, string>();
  const edgeConnectionsByType = new Map<string, readonly EdgeConnection[]>();
  let totalVertices = 0;
  let totalEdges = 0;

  for (const table of tables) {
    const tableInfoRows = await queryRecords(
      openCypherFetch,
      `CALL table_info('${escapeLadybugString(table.name)}') RETURN *`,
    );
    const attributes = parseTableInfoRows(tableInfoRows);
    const primaryKey = readTablePrimaryKey(tableInfoRows);
    if (primaryKey != null) {
      primaryKeysByLabel.set(table.name, primaryKey);
    }

    if (table.kind === "node") {
      vertices.push({
        type: createVertexType(table.name),
        attributes,
        ...(table.count != null && { total: table.count }),
      });
      totalVertices += table.count ?? 0;
      continue;
    }

    edges.push({
      type: createEdgeType(table.name),
      attributes,
      ...(table.count != null && { total: table.count }),
    });
    edgeTables.push(table.name);
    totalEdges += table.count ?? 0;
  }

  for (const edgeTable of edgeTables) {
    const connections = parseShowConnectionRows(
      await queryRecords(
        openCypherFetch,
        `CALL show_connection('${escapeLadybugString(edgeTable)}') RETURN *`,
      ),
      edgeTable,
    );
    edgeConnectionsByType.set(edgeTable, connections);
    edgeConnections.push(...connections);
  }

  return {
    schema: {
      vertices,
      edges,
      ...(totalVertices > 0 && { totalVertices }),
      ...(totalEdges > 0 && { totalEdges }),
      edgeConnections,
    },
    primaryKeysByLabel,
    edgeConnectionsByType,
  };
}

export const fetchSchema = async (
  openCypherFetch: OpenCypherFetch,
  _remoteLogger?: LoggerConnector,
): Promise<SchemaResponse> => {
  return (await discoverLadybugSchema(openCypherFetch)).schema;
};

async function queryRecords(openCypherFetch: OpenCypherFetch, query: string) {
  return normalizeResponseRecords(await openCypherFetch(query));
}

export default fetchSchema;
