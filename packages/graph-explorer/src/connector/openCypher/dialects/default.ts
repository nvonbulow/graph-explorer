import type { OpenCypherDialect } from "../dialect";

import { edgeDetails } from "../edgeDetails";
import fetchEdgeConnections from "../fetchEdgeConnections";
import fetchNeighbors from "../fetchNeighbors";
import fetchSchema from "../fetchSchema";
import fetchVertexTypeCounts from "../fetchVertexTypeCounts";
import keywordSearch from "../keywordSearch";
import { neighborCounts } from "../neighborCounts";
import { rawQuery } from "../rawQuery";
import { vertexDetails } from "../vertexDetails";

export const defaultOpenCypherDialect = {
  usesGraphSummary: true,
  fetchSchema,
  fetchVertexTypeCounts,
  fetchNeighbors,
  neighborCounts,
  keywordSearch,
  vertexDetails,
  edgeDetails,
  rawQuery,
  fetchEdgeConnections,
} satisfies OpenCypherDialect;
