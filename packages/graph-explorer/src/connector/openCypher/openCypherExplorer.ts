import type { FeatureFlags, NormalizedConnection } from "@/core";

import { createLoggerFromConnection } from "@/core/connector";
import { env, logger } from "@/utils";
import { DEFAULT_SERVICE_TYPE } from "@/utils/constants";

import type { Explorer, ExplorerRequestOptions } from "../useGEFetchTypes";
import type { OpenCypherDialect, OpenCypherFetchFactory } from "./dialect";
import type { GraphSummary } from "./types";

import { fetchDatabaseRequest } from "../fetchDatabaseRequest";
import { defaultOpenCypherDialect } from "./dialects/default";

function _openCypherFetch(
  connection: NormalizedConnection,
  featureFlags: FeatureFlags,
  options?: ExplorerRequestOptions,
): ReturnType<OpenCypherFetchFactory> {
  return async (queryTemplate: string) => {
    logger.debug(queryTemplate);
    return fetchDatabaseRequest(
      connection,
      featureFlags,
      `${connection.url}/openCypher`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: queryTemplate }),
        ...options,
      },
    );
  };
}

export type CreateOpenCypherExplorerOptions = {
  dialect?: OpenCypherDialect;
  fetchFactory?: OpenCypherFetchFactory;
};

export function createOpenCypherExplorer(
  connection: NormalizedConnection,
  featureFlags: FeatureFlags,
  createOptions?: CreateOpenCypherExplorerOptions,
): Explorer {
  const remoteLogger = createLoggerFromConnection(connection);
  const serviceType = connection.serviceType || DEFAULT_SERVICE_TYPE;
  const dialect = createOptions?.dialect ?? defaultOpenCypherDialect;
  const fetchFactory = createOptions?.fetchFactory ?? _openCypherFetch;
  return {
    connection,
    async fetchSchema(options) {
      remoteLogger.info("[openCypher Explorer] Fetching schema...");
      const summary =
        dialect.usesGraphSummary !== false
          ? await fetchSummary(serviceType, connection, featureFlags, options)
          : undefined;
      return dialect.fetchSchema(
        fetchFactory(connection, featureFlags, options),
        remoteLogger,
        summary,
      );
    },
    async fetchVertexCountsByType(req, options) {
      remoteLogger.info(
        "[openCypher Explorer] Fetching vertex counts by type...",
      );
      return dialect.fetchVertexTypeCounts(
        fetchFactory(connection, featureFlags, options),
        req,
      );
    },
    async fetchNeighbors(req, options) {
      remoteLogger.info("[openCypher Explorer] Fetching neighbors...");
      return dialect.fetchNeighbors(
        fetchFactory(connection, featureFlags, options),
        req,
      );
    },
    async neighborCounts(req, options) {
      remoteLogger.info("[openCypher Explorer] Fetching neighbors count...");
      return dialect.neighborCounts(
        fetchFactory(connection, featureFlags, options),
        req,
      );
    },
    async keywordSearch(req, options) {
      remoteLogger.info("[openCypher Explorer] Fetching keyword search...");
      return dialect.keywordSearch(
        fetchFactory(connection, featureFlags, options),
        req,
      );
    },
    async vertexDetails(req, options) {
      remoteLogger.info("[openCypher Explorer] Fetching vertex details...");
      return dialect.vertexDetails(
        fetchFactory(connection, featureFlags, options),
        req,
      );
    },
    async edgeDetails(req, options) {
      remoteLogger.info("[openCypher Explorer] Fetching edge details...");
      return dialect.edgeDetails(
        fetchFactory(connection, featureFlags, options),
        req,
      );
    },
    async rawQuery(req, options) {
      remoteLogger.info("[openCypher Explorer] Fetching raw query...");
      return dialect.rawQuery(
        fetchFactory(connection, featureFlags, options),
        req,
      );
    },
    async fetchEdgeConnections(req, options) {
      remoteLogger.info("[openCypher Explorer] Fetching edge connections...");
      return dialect.fetchEdgeConnections(
        fetchFactory(connection, featureFlags, options),
        req,
      );
    },
  } satisfies Explorer;
}

async function fetchSummary(
  serviceType: string,
  connection: NormalizedConnection,
  featureFlags: FeatureFlags,
  options?: RequestInit,
) {
  try {
    const endpoint =
      serviceType === DEFAULT_SERVICE_TYPE
        ? `${connection.url}/pg/statistics/summary?mode=detailed`
        : `${connection.url}/summary?mode=detailed`;
    const response = await fetchDatabaseRequest(
      connection,
      featureFlags,
      endpoint,
      {
        method: "GET",
        ...options,
      },
    );

    return (
      (response.payload
        ? (response.payload.graphSummary as GraphSummary)
        : (response.graphSummary as GraphSummary)) || undefined
    );
  } catch (e) {
    if (env.DEV) {
      logger.error("[Summary API]", e);
    }
  }
}
