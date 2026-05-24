import type {
  ErrorResponse,
  VertexDetailsRequest,
  VertexDetailsResponse,
} from "@/connector/useGEFetchTypes";

import isErrorResponse from "@/connector/utils/isErrorResponse";
import { createVertex, type Vertex } from "@/core";

import type { OCVertex, OpenCypherFetch } from "../../types";
import type { LadybugSchemaCache } from "./schemaCache";

import mapApiVertex from "../../mappers/mapApiVertex";
import {
  decodeVertexIdParam,
  formatLadybugLabel,
  formatLadybugPrimaryKeyValue,
} from "./idParam";

export async function vertexDetails(
  openCypherFetch: OpenCypherFetch,
  schemaCache: LadybugSchemaCache,
  request: VertexDetailsRequest,
): Promise<VertexDetailsResponse> {
  if (!request.vertexIds.length) {
    return { vertices: [] };
  }

  const vertices: Vertex[] = [];
  for (const vertexId of request.vertexIds) {
    const decoded = decodeVertexIdParam(vertexId);
    const primaryKey = await requiredPrimaryKeyInfo(schemaCache, decoded.label);
    const data = await openCypherFetch<VertexDetailsResult>(
      `MATCH (vertex:${formatLadybugLabel(decoded.label)}) WHERE vertex.${formatLadybugLabel(primaryKey.name)} = ${formatLadybugPrimaryKeyValue(decoded.value, primaryKey)} RETURN vertex LIMIT 1`,
    );

    if (isErrorResponse(data)) {
      throw new Error(data.detailedMessage);
    }

    const vertex = data.results[0]?.vertex;
    if (vertex != null) {
      vertices.push(createVertex(mapApiVertex(vertex)));
    }
  }

  return { vertices };
}

type VertexDetailsResult =
  | {
      results: Array<{
        vertex?: OCVertex;
      }>;
    }
  | ErrorResponse;

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
