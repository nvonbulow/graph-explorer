import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FeatureFlags, NormalizedConnection } from "@/core";

const queryLadybugWasmRuntime = vi.hoisted(() => vi.fn());

vi.mock("./client", () => ({
  queryLadybugWasmRuntime,
}));

import { createLadybugWasmOpenCypherFetch } from "./fetchFactory";

type LadybugTestConnection = NormalizedConnection & {
  ladybug?: {
    runtimeId?: unknown;
  };
};

const featureFlags = {} as FeatureFlags;

function createConnection(
  overrides?: Partial<LadybugTestConnection>,
): LadybugTestConnection {
  return {
    url: "",
    queryEngine: "openCypher",
    graphDbUrl: "",
    proxyConnection: false,
    awsAuthEnabled: false,
    ladybug: { runtimeId: "runtime-1" },
    ...overrides,
  } as LadybugTestConnection;
}

describe("createLadybugWasmOpenCypherFetch", () => {
  beforeEach(() => {
    queryLadybugWasmRuntime.mockReset();
  });

  it("fails clearly for non-openCypher connections", () => {
    expect(() =>
      createLadybugWasmOpenCypherFetch(
        createConnection({ queryEngine: "gremlin" }),
        featureFlags,
      ),
    ).toThrow("require an openCypher connection");
  });

  it("fails clearly when the Ladybug runtime id is missing", () => {
    expect(() =>
      createLadybugWasmOpenCypherFetch(
        createConnection({ ladybug: undefined }),
        featureFlags,
      ),
    ).toThrow("missing ladybug.runtimeId");

    expect(() =>
      createLadybugWasmOpenCypherFetch(
        createConnection({ ladybug: { runtimeId: "" } }),
        featureFlags,
      ),
    ).toThrow("missing ladybug.runtimeId");
  });

  it("queries the in-context runtime with the query template and returns a Neptune-compatible response", async () => {
    const response = { results: [{ one: 1 }] };
    queryLadybugWasmRuntime.mockResolvedValueOnce(response);

    const fetch = createLadybugWasmOpenCypherFetch(
      createConnection({ ladybug: { runtimeId: "tenant/db" } }),
      featureFlags,
      {
        method: "PUT",
        headers: { "x-ignored": "true" },
        body: "ignored",
      },
    );

    await expect(fetch("RETURN 1 AS one")).resolves.toBe(response);
    expect(queryLadybugWasmRuntime).toHaveBeenCalledOnce();
    expect(queryLadybugWasmRuntime).toHaveBeenCalledWith(
      "tenant/db",
      "RETURN 1 AS one",
      { primaryKeys: {} },
    );
  });

  it("honors an already-aborted signal before querying", async () => {
    const abortReason = new Error("aborted");
    const abortController = new AbortController();
    abortController.abort(abortReason);

    const fetch = createLadybugWasmOpenCypherFetch(
      createConnection(),
      featureFlags,
      { signal: abortController.signal },
    );

    await expect(fetch("RETURN 1")).rejects.toBe(abortReason);
    expect(queryLadybugWasmRuntime).not.toHaveBeenCalled();
  });

  it("honors an abort signal while a runtime query is pending", async () => {
    const abortReason = new Error("aborted while pending");
    const abortController = new AbortController();
    queryLadybugWasmRuntime.mockReturnValueOnce(new Promise(() => undefined));

    const fetch = createLadybugWasmOpenCypherFetch(
      createConnection(),
      featureFlags,
      { signal: abortController.signal },
    );
    const result = fetch("RETURN 1");

    abortController.abort(abortReason);

    await expect(result).rejects.toBe(abortReason);
    expect(queryLadybugWasmRuntime).toHaveBeenCalledWith(
      "runtime-1",
      "RETURN 1",
      { primaryKeys: {} },
    );
  });

  it("shares primary keys learned from table_info responses across fetches for one runtime only", async () => {
    const tableInfoResponse = {
      results: [
        { name: "folder_id", data_type: "String", "primary key": true },
        { name: "name", data_type: "String" },
      ],
    };
    const sameRuntimeGraphResponse = {
      results: [{ folder: { "~id": "encoded" } }],
    };
    const otherRuntimeGraphResponse = { results: [] };
    queryLadybugWasmRuntime
      .mockResolvedValueOnce(tableInfoResponse)
      .mockResolvedValueOnce(sameRuntimeGraphResponse)
      .mockResolvedValueOnce(otherRuntimeGraphResponse);

    const firstFetch = createLadybugWasmOpenCypherFetch(
      createConnection({ ladybug: { runtimeId: "shared-runtime" } }),
      featureFlags,
    );
    await expect(
      firstFetch("CALL table_info('Folder') RETURN *"),
    ).resolves.toBe(tableInfoResponse);

    const secondFetch = createLadybugWasmOpenCypherFetch(
      createConnection({ ladybug: { runtimeId: "shared-runtime" } }),
      featureFlags,
    );
    await expect(secondFetch("MATCH (f:Folder) RETURN f")).resolves.toBe(
      sameRuntimeGraphResponse,
    );

    const otherRuntimeFetch = createLadybugWasmOpenCypherFetch(
      createConnection({ ladybug: { runtimeId: "other-runtime" } }),
      featureFlags,
    );
    await expect(otherRuntimeFetch("MATCH (f:Folder) RETURN f")).resolves.toBe(
      otherRuntimeGraphResponse,
    );

    expect(queryLadybugWasmRuntime).toHaveBeenNthCalledWith(
      1,
      "shared-runtime",
      "CALL table_info('Folder') RETURN *",
    );
    expect(queryLadybugWasmRuntime).toHaveBeenNthCalledWith(
      2,
      "shared-runtime",
      "MATCH (f:Folder) RETURN f",
      { primaryKeys: { Folder: "folder_id" } },
    );
    expect(queryLadybugWasmRuntime).toHaveBeenNthCalledWith(
      3,
      "other-runtime",
      "MATCH (f:Folder) RETURN f",
      { primaryKeys: {} },
    );
  });

  it("keeps table_info and scalar queries working when primary-key metadata is empty", async () => {
    const tableInfoResponse = { results: [{ column_name: "distance" }] };
    const scalarResponse = { results: [{ count: 2 }] };
    queryLadybugWasmRuntime
      .mockResolvedValueOnce(tableInfoResponse)
      .mockResolvedValueOnce(scalarResponse);

    const fetch = createLadybugWasmOpenCypherFetch(
      createConnection(),
      featureFlags,
    );

    await expect(fetch("CALL table_info('Route') RETURN *")).resolves.toBe(
      tableInfoResponse,
    );
    await expect(fetch("RETURN 2 AS count")).resolves.toBe(scalarResponse);

    expect(queryLadybugWasmRuntime).toHaveBeenNthCalledWith(
      1,
      "runtime-1",
      "CALL table_info('Route') RETURN *",
    );
    expect(queryLadybugWasmRuntime).toHaveBeenNthCalledWith(
      2,
      "runtime-1",
      "RETURN 2 AS count",
      { primaryKeys: {} },
    );
  });
});
