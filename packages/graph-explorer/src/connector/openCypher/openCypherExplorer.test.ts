import type { Mock } from "vitest";

import type { FeatureFlags, NormalizedConnection } from "@/core";

import type { OpenCypherDialect, OpenCypherFetchFactory } from "./dialect";

import { defaultOpenCypherDialect } from "./dialects/default";
import { createLadybugOpenCypherDialect } from "./dialects/ladybug";
import { createOpenCypherExplorer } from "./openCypherExplorer";

function createConnection(
  overrides?: Partial<NormalizedConnection>,
): NormalizedConnection {
  return {
    url: "http://localhost:8182",
    queryEngine: "openCypher",
    graphDbUrl: "",
    proxyConnection: false,
    awsAuthEnabled: false,
    ...overrides,
  };
}

function createFeatureFlags(overrides?: Partial<FeatureFlags>): FeatureFlags {
  return {
    showDebugActions: false,
    allowLoggingDbQuery: false,
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.href;
  }

  return input.url;
}

function readStringBody(body: BodyInit | null | undefined): string {
  if (typeof body === "string") {
    return body;
  }

  const bodyType =
    body === undefined ? "undefined" : body === null ? "null" : typeof body;
  throw new Error(`Expected string request body, received ${bodyType}.`);
}

describe("createOpenCypherExplorer", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the summary API and existing openCypher HTTP endpoint by default", async () => {
    const connection = createConnection();
    const featureFlags = createFeatureFlags();
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = requestUrl(input);

      if (url === "http://localhost:8182/pg/statistics/summary?mode=detailed") {
        return Promise.resolve(
          jsonResponse({
            payload: {
              graphSummary: {
                numNodes: 1,
                numEdges: 0,
                numNodeLabels: 1,
                numEdgeLabels: 0,
                nodeLabels: ["airport"],
                edgeLabels: [],
                numNodeProperties: 1,
                numEdgeProperties: 0,
                nodeProperties: { code: 1 },
                edgeProperties: {},
                totalNodePropertyValues: 1,
                totalEdgePropertyValues: 0,
              },
            },
          }),
        );
      }

      if (url === "http://localhost:8182/openCypher") {
        return Promise.resolve(
          jsonResponse({
            results: [
              {
                object: {
                  "~id": "1",
                  "~entityType": "node",
                  "~labels": ["airport"],
                  "~properties": { code: "SFO" },
                },
              },
            ],
          }),
        );
      }

      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    const explorer = createOpenCypherExplorer(connection, featureFlags);

    const schema = await explorer.fetchSchema();

    expect(schema.totalVertices).toBe(1);
    expect(schema.vertices).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8182/pg/statistics/summary?mode=detailed",
      expect.objectContaining({ method: "GET" }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8182/openCypher",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
        }),
      }),
    );
    const requestBody = JSON.parse(
      readStringBody(mockFetch.mock.calls[1][1].body),
    );
    expect(requestBody.query).toContain("airport");
  });

  it("allows injecting a dialect and fetch factory without fetching summary", async () => {
    const connection = createConnection();
    const featureFlags = createFeatureFlags();
    const openCypherFetch = vi.fn();
    const fetchFactory = vi.fn(
      () => openCypherFetch,
    ) as Mock<OpenCypherFetchFactory>;
    const fetchSchema = vi.fn(() =>
      Promise.resolve({
        totalVertices: 0,
        vertices: [],
        totalEdges: 0,
        edges: [],
      }),
    );
    const dialect = {
      ...defaultOpenCypherDialect,
      usesGraphSummary: false,
      fetchSchema,
    } satisfies OpenCypherDialect;

    const explorer = createOpenCypherExplorer(connection, featureFlags, {
      dialect,
      fetchFactory,
    });

    await expect(explorer.fetchSchema()).resolves.toStrictEqual({
      totalVertices: 0,
      vertices: [],
      totalEdges: 0,
      edges: [],
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(fetchFactory).toHaveBeenCalledWith(
      connection,
      featureFlags,
      undefined,
    );
    expect(fetchSchema).toHaveBeenCalledWith(
      openCypherFetch,
      expect.objectContaining({ info: expect.any(Function) }),
      undefined,
    );
  });

  it("uses Ladybug dialect schema discovery without fetching graph summary", async () => {
    const connection = createConnection();
    const featureFlags = createFeatureFlags();

    mockFetch.mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url !== "http://localhost:8182/openCypher") {
          return Promise.reject(new Error(`Unexpected request: ${url}`));
        }

        const query = JSON.parse(readStringBody(init?.body)).query as string;
        if (query === "CALL show_tables() RETURN *") {
          return Promise.resolve(
            jsonResponse({
              results: [{ name: "Repo", type: "NODE", count: 1 }],
            }),
          );
        }
        if (query === "CALL table_info('Repo') RETURN *") {
          return Promise.resolve(
            jsonResponse({
              results: [
                { name: "repo_key", type: "STRING", primary_key: true },
                { name: "name", type: "STRING" },
              ],
            }),
          );
        }

        return Promise.reject(new Error(`Unexpected query: ${query}`));
      },
    );

    const explorer = createOpenCypherExplorer(connection, featureFlags, {
      dialect: createLadybugOpenCypherDialect(),
    });

    await expect(explorer.fetchSchema()).resolves.toMatchObject({
      totalVertices: 1,
      vertices: [
        expect.objectContaining({
          type: "Repo",
          attributes: expect.arrayContaining([
            expect.objectContaining({ name: "repo_key" }),
          ]),
        }),
      ],
      edges: [],
      edgeConnections: [],
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).not.toHaveBeenCalledWith(
      "http://localhost:8182/pg/statistics/summary?mode=detailed",
      expect.anything(),
    );
    const queries = mockFetch.mock.calls.map(
      call => JSON.parse(readStringBody(call[1]?.body)).query,
    );
    expect(queries).toStrictEqual([
      "CALL show_tables() RETURN *",
      "CALL table_info('Repo') RETURN *",
    ]);
  });
});
