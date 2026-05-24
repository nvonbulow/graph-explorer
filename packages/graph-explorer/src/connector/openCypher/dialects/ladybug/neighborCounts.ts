import type {
  ErrorResponse,
  NeighborCount,
  NeighborCountsRequest,
  NeighborCountsResponse,
} from "@/connector/useGEFetchTypes";

import isErrorResponse from "@/connector/utils/isErrorResponse";
import { createVertexType, type VertexType } from "@/core";

import type { OCVertex, OpenCypherFetch } from "../../types";
import type { LadybugSchemaCache } from "./schemaCache";

import {
  decodeVertexIdParam,
  formatLadybugLabel,
  formatLadybugPrimaryKeyValue,
} from "./idParam";

export async function neighborCounts(
  openCypherFetch: OpenCypherFetch,
  schemaCache: LadybugSchemaCache,
  request: NeighborCountsRequest,
): Promise<NeighborCountsResponse> {
  if (!request.vertexIds.length) {
    return { counts: [] };
  }

  await schemaCache.schema();

  const counts: NeighborCount[] = [];
  for (const vertexId of request.vertexIds) {
    const decoded = decodeVertexIdParam(vertexId);
    const primaryKey = await requiredPrimaryKeyInfo(schemaCache, decoded.label);
    const data = await openCypherFetch<NeighborCountsResult>(
      `MATCH (source:${formatLadybugLabel(decoded.label)})-[edge]-(neighbor) WHERE source.${formatLadybugLabel(primaryKey.name)} = ${formatLadybugPrimaryKeyValue(decoded.value, primaryKey)} RETURN collect(DISTINCT neighbor) AS neighbors`,
    );

    if (isErrorResponse(data)) {
      throw new Error(data.detailedMessage);
    }

    const countsByType = new Map<VertexType, number>();
    const neighbors = data.results[0]?.neighbors ?? [];
    for (const neighbor of neighbors) {
      for (const label of neighbor["~labels"]) {
        const vertexType = createVertexType(label);
        countsByType.set(vertexType, (countsByType.get(vertexType) ?? 0) + 1);
      }
    }

    counts.push({
      vertexId,
      counts: countsByType,
      totalCount: neighbors.length,
    });
  }

  return { counts };
}

type NeighborCountsResult =
  | {
      results: Array<{
        neighbors?: OCVertex[];
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
