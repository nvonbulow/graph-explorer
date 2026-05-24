import type { LoggerConnector } from "@/connector/LoggerConnector";
import type { FeatureFlags, NormalizedConnection } from "@/core";

import type {
  CountsByTypeRequest,
  CountsByTypeResponse,
  EdgeConnectionsRequest,
  EdgeConnectionsResponse,
  EdgeDetailsRequest,
  EdgeDetailsResponse,
  ExplorerRequestOptions,
  KeywordSearchRequest,
  KeywordSearchResponse,
  NeighborCountsRequest,
  NeighborCountsResponse,
  NeighborsRequest,
  NeighborsResponse,
  RawQueryRequest,
  RawQueryResponse,
  SchemaResponse,
  VertexDetailsRequest,
  VertexDetailsResponse,
} from "../useGEFetchTypes";
import type { GraphSummary, OpenCypherFetch } from "./types";

export type OpenCypherFetchFactory = (
  connection: NormalizedConnection,
  featureFlags: FeatureFlags,
  options?: ExplorerRequestOptions,
) => OpenCypherFetch;

export type OpenCypherDialect = {
  usesGraphSummary?: boolean;
  fetchSchema: (
    openCypherFetch: OpenCypherFetch,
    remoteLogger: LoggerConnector,
    summary?: GraphSummary,
  ) => Promise<SchemaResponse>;
  fetchVertexTypeCounts: (
    openCypherFetch: OpenCypherFetch,
    req: CountsByTypeRequest,
  ) => Promise<CountsByTypeResponse>;
  fetchNeighbors: (
    openCypherFetch: OpenCypherFetch,
    req: NeighborsRequest,
  ) => Promise<NeighborsResponse>;
  neighborCounts: (
    openCypherFetch: OpenCypherFetch,
    req: NeighborCountsRequest,
  ) => Promise<NeighborCountsResponse>;
  keywordSearch: (
    openCypherFetch: OpenCypherFetch,
    req: KeywordSearchRequest,
  ) => Promise<KeywordSearchResponse>;
  vertexDetails: (
    openCypherFetch: OpenCypherFetch,
    req: VertexDetailsRequest,
  ) => Promise<VertexDetailsResponse>;
  edgeDetails: (
    openCypherFetch: OpenCypherFetch,
    req: EdgeDetailsRequest,
  ) => Promise<EdgeDetailsResponse>;
  rawQuery: (
    openCypherFetch: OpenCypherFetch,
    req: RawQueryRequest,
  ) => Promise<RawQueryResponse>;
  fetchEdgeConnections: (
    openCypherFetch: OpenCypherFetch,
    req: EdgeConnectionsRequest,
  ) => Promise<EdgeConnectionsResponse>;
};
