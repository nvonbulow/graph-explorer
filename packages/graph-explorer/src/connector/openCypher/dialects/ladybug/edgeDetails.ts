import type {
  EdgeDetailsRequest,
  EdgeDetailsResponse,
  ErrorResponse,
} from "@/connector/useGEFetchTypes";

import isErrorResponse from "@/connector/utils/isErrorResponse";
import { createEdge, type Edge } from "@/core";

import type { OCEdge, OCVertex, OpenCypherFetch } from "../../types";
import type { LadybugSchemaCache } from "./schemaCache";

import mapApiEdge from "../../mappers/mapApiEdge";
import {
  decodeEdgeIdParam,
  formatLadybugLabel,
  formatLadybugPrimaryKeyValue,
} from "./idParam";

export async function edgeDetails(
  openCypherFetch: OpenCypherFetch,
  schemaCache: LadybugSchemaCache,
  request: EdgeDetailsRequest,
): Promise<EdgeDetailsResponse> {
  if (!request.edgeIds.length) {
    return { edges: [] };
  }

  const edges: Edge[] = [];
  for (const edgeId of request.edgeIds) {
    const decoded = decodeEdgeIdParam(edgeId);
    await requireEdgeConnection(
      schemaCache,
      decoded.type,
      decoded.source.label,
      decoded.target.label,
    );
    const sourcePrimaryKey = await requiredPrimaryKeyInfo(
      schemaCache,
      decoded.source.label,
    );
    const targetPrimaryKey = await requiredPrimaryKeyInfo(
      schemaCache,
      decoded.target.label,
    );
    const data = await openCypherFetch<EdgeDetailsResult>(
      `MATCH (source:${formatLadybugLabel(decoded.source.label)})-[edge:${formatLadybugLabel(decoded.type)}]->(target:${formatLadybugLabel(decoded.target.label)}) WHERE source.${formatLadybugLabel(sourcePrimaryKey.name)} = ${formatLadybugPrimaryKeyValue(decoded.source.value, sourcePrimaryKey)} AND target.${formatLadybugLabel(targetPrimaryKey.name)} = ${formatLadybugPrimaryKeyValue(decoded.target.value, targetPrimaryKey)} RETURN edge, source, target LIMIT 1`,
    );

    if (isErrorResponse(data)) {
      throw new Error(data.detailedMessage);
    }

    const edge = data.results[0]?.edge;
    if (edge != null) {
      edges.push(createEdge(mapApiEdge(edge)));
    }
  }

  return { edges };
}

type EdgeDetailsResult =
  | {
      results: Array<{
        edge?: OCEdge;
        source?: OCVertex;
        target?: OCVertex;
      }>;
    }
  | ErrorResponse;

async function requireEdgeConnection(
  schemaCache: LadybugSchemaCache,
  edgeType: string,
  sourceLabel: string,
  targetLabel: string,
): Promise<void> {
  const connections = await schemaCache.edgeConnections(edgeType);
  if (connections.length === 0) {
    throw new Error(
      `Missing Ladybug edge connection metadata for edge type ${edgeType}`,
    );
  }

  const hasConnection = connections.some(
    connection =>
      String(connection.sourceVertexType) === sourceLabel &&
      String(connection.targetVertexType) === targetLabel,
  );
  if (!hasConnection) {
    throw new Error(
      `Missing Ladybug edge connection metadata for ${sourceLabel}-[${edgeType}]->${targetLabel}`,
    );
  }
}

type PrimaryKeyInfo = NonNullable<
  Awaited<ReturnType<LadybugSchemaCache["primaryKeyInfo"]>>
>;

async function requiredPrimaryKeyInfo(
  schemaCache: LadybugSchemaCache,
  label: string,
): Promise<PrimaryKeyInfo> {
  const primaryKey = await schemaCache.primaryKeyInfo(label);
  if (primaryKey == null || primaryKey.name.length === 0) {
    throw new Error(`Missing Ladybug primary key for vertex label ${label}`);
  }

  return primaryKey;
}
