import {
  createRandomBoolean,
  createRandomInteger,
  createRandomName,
  createRandomUrlString,
} from "@shared/utils/testing";
import { beforeEach, vi } from "vitest";

import type { FeatureFlags, NormalizedConnection } from "@/core";

import {
  createRandomAwsRegion,
  createRandomQueryEngine,
  createRandomServiceType,
} from "@/utils/testing";

const connectorMocks = vi.hoisted(() => ({
  createGremlinExplorer: vi.fn(),
  createLadybugOpenCypherDialect: vi.fn(() => ({ dialect: "ladybug" })),
  createLadybugWasmOpenCypherFetch: vi.fn(),
  createOpenCypherExplorer: vi.fn(),
  createSparqlExplorer: vi.fn(),
}));

vi.mock("@/connector/gremlin/gremlinExplorer", () => ({
  createGremlinExplorer: connectorMocks.createGremlinExplorer,
}));

vi.mock("@/connector/openCypher/dialects/ladybug", () => ({
  createLadybugOpenCypherDialect: connectorMocks.createLadybugOpenCypherDialect,
}));

vi.mock("@/connector/openCypher/openCypherExplorer", () => ({
  createOpenCypherExplorer: connectorMocks.createOpenCypherExplorer,
}));

vi.mock("@/connector/sparql/sparqlExplorer", () => ({
  createSparqlExplorer: connectorMocks.createSparqlExplorer,
}));

vi.mock("@/ladybug-wasm/fetchFactory", () => ({
  createLadybugWasmOpenCypherFetch:
    connectorMocks.createLadybugWasmOpenCypherFetch,
}));

import { createExplorerFromConnection } from "./connector";
import {
  DefaultConnectionDataSchema,
  mapToConnection,
} from "./defaultConnection";

describe("mapToConnection", () => {
  test("should map default connection data to connection config", () => {
    const defaultConnectionData = createRandomDefaultConnectionData();
    const actual = mapToConnection(defaultConnectionData);
    expect(actual).toEqual({
      id: "Default Connection",
      displayLabel: "Default Connection",
      connection: {
        graphDbUrl: defaultConnectionData.GRAPH_EXP_CONNECTION_URL,
        url: defaultConnectionData.GRAPH_EXP_PUBLIC_OR_PROXY_ENDPOINT,
        proxyConnection: defaultConnectionData.GRAPH_EXP_USING_PROXY_SERVER,
        queryEngine: defaultConnectionData.GRAPH_EXP_GRAPH_TYPE,
        awsAuthEnabled: defaultConnectionData.GRAPH_EXP_IAM,
        awsRegion: defaultConnectionData.GRAPH_EXP_AWS_REGION,
        serviceType: defaultConnectionData.GRAPH_EXP_SERVICE_TYPE,
        fetchTimeoutMs: defaultConnectionData.GRAPH_EXP_FETCH_REQUEST_TIMEOUT,
        nodeExpansionLimit:
          defaultConnectionData.GRAPH_EXP_NODE_EXPANSION_LIMIT,
      },
    });
  });
});

describe("createExplorerFromConnection", () => {
  const featureFlags: FeatureFlags = {
    allowLoggingDbQuery: false,
    showDebugActions: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("should keep default remote openCypher explorer behavior", () => {
    const connection = createConnection({
      backend: "remote",
      queryEngine: "openCypher",
    });

    createExplorerFromConnection(connection, featureFlags);

    expect(connectorMocks.createOpenCypherExplorer).toHaveBeenCalledWith(
      connection,
      featureFlags,
    );
  });

  test("should use Ladybug dialect and WASM fetch for local Ladybug files", () => {
    const connection = createConnection({
      backend: "ladybug-wasm-local-file",
      queryEngine: "openCypher",
      url: "/ladybug-wasm/runtime-1",
      ladybug: {
        fileName: "data.lbug",
        fileSize: 1,
        lastModified: 2,
        runtimeId: "runtime-1",
      },
    });

    createExplorerFromConnection(connection, featureFlags);

    expect(connectorMocks.createLadybugOpenCypherDialect).toHaveBeenCalledTimes(
      1,
    );
    expect(connectorMocks.createOpenCypherExplorer).toHaveBeenCalledWith(
      connection,
      featureFlags,
      {
        dialect: { dialect: "ladybug" },
        fetchFactory: connectorMocks.createLadybugWasmOpenCypherFetch,
      },
    );
  });

  test("should use Ladybug dialect and default fetch for remote Ladybug", () => {
    const connection = createConnection({
      backend: "ladybug-remote",
      queryEngine: "openCypher",
      url: "/ladybug/db",
      ladybug: {
        databaseName: "db",
      },
    });

    createExplorerFromConnection(connection, featureFlags);

    expect(connectorMocks.createLadybugOpenCypherDialect).toHaveBeenCalledTimes(
      1,
    );
    expect(connectorMocks.createOpenCypherExplorer).toHaveBeenCalledWith(
      connection,
      featureFlags,
      {
        dialect: { dialect: "ladybug" },
      },
    );
  });
});

describe("DefaultConnectionDataSchema", () => {
  test("should parse default connection data", () => {
    const data = createRandomDefaultConnectionData();
    const actual = DefaultConnectionDataSchema.parse(data);
    expect(actual).toEqual(data);
  });

  test("should handle missing values", () => {
    const data = {};
    const actual = DefaultConnectionDataSchema.parse(data);
    expect(actual).toEqual({
      GRAPH_EXP_USING_PROXY_SERVER: false,
      GRAPH_EXP_CONNECTION_URL: "",
      GRAPH_EXP_PUBLIC_OR_PROXY_ENDPOINT: "",
      GRAPH_EXP_IAM: false,
      GRAPH_EXP_AWS_REGION: "",
      GRAPH_EXP_SERVICE_TYPE: "neptune-db",
      GRAPH_EXP_FETCH_REQUEST_TIMEOUT: 240000,
    });
  });

  test("should handle invalid service type", () => {
    const data: any = createRandomDefaultConnectionData();
    data.GRAPH_EXP_SERVICE_TYPE = createRandomName("serviceType");
    // Make the enum less strict
    const actual = DefaultConnectionDataSchema.parse(data);
    expect(actual).toEqual({ ...data, GRAPH_EXP_SERVICE_TYPE: "neptune-db" });
  });

  test("should handle invalid URLs", () => {
    const data: any = createRandomDefaultConnectionData();
    data.GRAPH_EXP_CONNECTION_URL = createRandomName("connectionURL");
    data.GRAPH_EXP_PUBLIC_OR_PROXY_ENDPOINT = createRandomName(
      "publicOrProxyEndpoint",
    );
    // Make the enum less strict
    const actual = DefaultConnectionDataSchema.parse(data);
    expect(actual).toEqual({
      ...data,
      GRAPH_EXP_CONNECTION_URL: "",
      GRAPH_EXP_PUBLIC_OR_PROXY_ENDPOINT: "",
    });
  });

  test("should preserve path in GRAPH_EXP_CONNECTION_URL", () => {
    const data = {
      ...createRandomDefaultConnectionData(),
      GRAPH_EXP_CONNECTION_URL:
        "http://blazegraph:9999/blazegraph/namespace/kb",
    };
    const actual = DefaultConnectionDataSchema.parse(data);
    expect(actual.GRAPH_EXP_CONNECTION_URL).toBe(
      "http://blazegraph:9999/blazegraph/namespace/kb",
    );
  });

  test("should preserve path in GRAPH_EXP_PUBLIC_OR_PROXY_ENDPOINT", () => {
    const data = {
      ...createRandomDefaultConnectionData(),
      GRAPH_EXP_PUBLIC_OR_PROXY_ENDPOINT:
        "http://localhost:8080/proxy/explorer",
    };
    const actual = DefaultConnectionDataSchema.parse(data);
    expect(actual.GRAPH_EXP_PUBLIC_OR_PROXY_ENDPOINT).toBe(
      "http://localhost:8080/proxy/explorer",
    );
  });
});

function createConnection(
  overrides?: Partial<NormalizedConnection>,
): NormalizedConnection {
  return {
    backend: "remote",
    url: "https://example.com",
    graphDbUrl: "",
    queryEngine: "gremlin",
    proxyConnection: false,
    awsAuthEnabled: false,
    ...overrides,
  } as NormalizedConnection;
}

function createRandomDefaultConnectionData() {
  return {
    GRAPH_EXP_USING_PROXY_SERVER: createRandomBoolean(),
    GRAPH_EXP_CONNECTION_URL: createRandomUrlString(),
    GRAPH_EXP_PUBLIC_OR_PROXY_ENDPOINT: createRandomUrlString(),
    GRAPH_EXP_GRAPH_TYPE: createRandomQueryEngine(),
    GRAPH_EXP_IAM: createRandomBoolean(),
    GRAPH_EXP_AWS_REGION: createRandomAwsRegion(),
    GRAPH_EXP_SERVICE_TYPE: createRandomServiceType(),
    GRAPH_EXP_FETCH_REQUEST_TIMEOUT: createRandomInteger(),
    GRAPH_EXP_NODE_EXPANSION_LIMIT: createRandomInteger(),
  };
}
