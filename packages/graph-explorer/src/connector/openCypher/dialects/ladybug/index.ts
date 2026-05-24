import type { EdgeConnection } from "@/core";

import type { OpenCypherDialect } from "../../dialect";
import type { OpenCypherFetch } from "../../types";

import { defaultOpenCypherDialect } from "../default";
import { edgeDetails } from "./edgeDetails";
import { fetchNeighbors } from "./fetchNeighbors";
import { fetchSchema } from "./fetchSchema";
import { keywordSearch } from "./keywordSearch";
import { neighborCounts } from "./neighborCounts";
import { createLadybugSchemaCache } from "./schemaCache";
import { vertexDetails } from "./vertexDetails";

export {
  decodeEdgeIdParam,
  decodeLadybugEdgeId,
  decodeLadybugVertexId,
  decodeVertexIdParam,
  edgeIdParam,
  encodeLadybugEdgeId,
  encodeLadybugVertexId,
  vertexIdParam,
} from "./idParam";

export function createLadybugOpenCypherDialect(): OpenCypherDialect {
  const schemaCacheByFetch = new WeakMap<
    OpenCypherFetch,
    ReturnType<typeof createLadybugSchemaCache>
  >();

  function getSchemaCache(fetch: OpenCypherFetch) {
    let schemaCache = schemaCacheByFetch.get(fetch);
    if (schemaCache == null) {
      schemaCache = createLadybugSchemaCache(() => Promise.resolve(fetch));
      schemaCacheByFetch.set(fetch, schemaCache);
    }

    return schemaCache;
  }

  return {
    usesGraphSummary: false,
    fetchSchema,
    fetchVertexTypeCounts: defaultOpenCypherDialect.fetchVertexTypeCounts,
    async fetchNeighbors(fetch, req) {
      return fetchNeighbors(fetch, getSchemaCache(fetch), req);
    },
    async neighborCounts(fetch, req) {
      return neighborCounts(fetch, getSchemaCache(fetch), req);
    },
    async keywordSearch(fetch, req) {
      return keywordSearch(fetch, getSchemaCache(fetch), req);
    },
    async vertexDetails(fetch, req) {
      return vertexDetails(fetch, getSchemaCache(fetch), req);
    },
    async edgeDetails(fetch, req) {
      return edgeDetails(fetch, getSchemaCache(fetch), req);
    },
    rawQuery: defaultOpenCypherDialect.rawQuery,
    async fetchEdgeConnections(fetch, req) {
      const schemaCache = getSchemaCache(fetch);
      const edgeConnections: EdgeConnection[] = [];

      if (req.edgeTypes.length === 0) {
        edgeConnections.push(...(await schemaCache.edgeConnections()));
      } else {
        for (const edgeType of req.edgeTypes) {
          edgeConnections.push(
            ...(await schemaCache.edgeConnections(edgeType)),
          );
        }
      }

      return { edgeConnections };
    },
  } satisfies OpenCypherDialect;
}
