import { atom, useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";

import type { Explorer } from "@/connector/useGEFetchTypes";

import { emptyExplorer } from "@/connector/emptyExplorer";
import { createGremlinExplorer } from "@/connector/gremlin/gremlinExplorer";
import {
  ClientLoggerConnector,
  type LoggerConnector,
  ServerLoggerConnector,
} from "@/connector/LoggerConnector";
import { createLadybugOpenCypherDialect } from "@/connector/openCypher/dialects/ladybug";
import { createOpenCypherExplorer } from "@/connector/openCypher/openCypherExplorer";
import { createSparqlExplorer } from "@/connector/sparql/sparqlExplorer";
import { createLadybugWasmOpenCypherFetch } from "@/ladybug-wasm/fetchFactory";
import { logger } from "@/utils";

import { featureFlagsSelector, type FeatureFlags } from "./StateProvider";
import {
  activeConnectionAtom,
  type NormalizedConnection,
} from "./StateProvider/configuration";

export const explorerAtom = atom(get => {
  const explorerForTesting = get(explorerForTestingAtom);
  if (explorerForTesting) {
    return explorerForTesting;
  }
  const connection = get(activeConnectionAtom);
  if (!connection) {
    return emptyExplorer;
  }
  const featureFlags = get(featureFlagsSelector);
  logger.debug("Creating explorer for connection:", {
    connection,
    featureFlags,
  });
  return createExplorerFromConnection(connection, featureFlags);
});

export function createExplorerFromConnection(
  connection: NormalizedConnection,
  featureFlags: FeatureFlags,
): Explorer {
  switch (connection.queryEngine) {
    case "openCypher":
      if (connection.backend === "ladybug-wasm-local-file") {
        return createOpenCypherExplorer(connection, featureFlags, {
          dialect: createLadybugOpenCypherDialect(),
          fetchFactory: createLadybugWasmOpenCypherFetch,
        });
      }

      if (connection.backend === "ladybug-remote") {
        return createOpenCypherExplorer(connection, featureFlags, {
          dialect: createLadybugOpenCypherDialect(),
        });
      }

      return createOpenCypherExplorer(connection, featureFlags);
    case "sparql":
      return createSparqlExplorer(connection, featureFlags, new Map());
    case "gremlin":
      return createGremlinExplorer(connection, featureFlags);
  }
}

/**
 * Explorer based on the active connection.
 */
export function useExplorer() {
  return useAtomValue(explorerAtom);
}

/** CAUTION: This atom is only for testing purposes. */
export const explorerForTestingAtom = atom<Explorer | null>(null);

export const queryEngineSelector = atom(get =>
  get(
    selectAtom(activeConnectionAtom, c =>
      c && c.queryEngine ? c.queryEngine : "gremlin",
    ),
  ),
);

export function useQueryEngine() {
  return useAtomValue(queryEngineSelector);
}

/**
 * Logger based on the active connection proxy URL.
 */
export const loggerSelector = atom(get =>
  createLoggerFromConnection(get(activeConnectionAtom)),
);

/** Creates a logger instance that will be remote if the connection is using the
 * proxy server. Otherwise it will be a client only logger. */
export function createLoggerFromConnection(
  connection: NormalizedConnection | null,
): LoggerConnector {
  // Check for a url and that we are using the proxy server
  if (!connection || !connection.url || connection.proxyConnection !== true) {
    logger.debug(
      "Connection did not contain enough information to create a remote logger, so using a client logger instead",
      connection,
    );
    return new ClientLoggerConnector();
  }

  logger.debug(
    "Creating a remote server logger using proxy server URL",
    connection.url,
  );
  return new ServerLoggerConnector(connection.url);
}
