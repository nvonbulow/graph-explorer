import { vi } from "vitest";

import { createEdgeConnection, createEdgeType, createVertexType } from "@/core";

import type { OpenCypherFetch } from "../../types";

import fetchSchema from "./fetchSchema";
import { createLadybugSchemaCache } from "./schemaCache";

type MockRow = Record<string, unknown>;

function response(results: MockRow[]) {
  return { results };
}

function createSchemaFetch() {
  return vi.fn((query: string) => {
    if (query === "CALL show_tables() RETURN *") {
      return Promise.resolve(
        response([
          { count: 3, name: "Route", type: "REL" },
          { name: "duckdb_functions", type: "ATTACHED" },
          { count: "2", name: "Airport", type: "NODE" },
        ]),
      );
    }

    if (query === "CALL table_info('Airport') RETURN *") {
      return Promise.resolve(
        response([
          { data_type: "String", name: "code", "primary key": true },
          { column_name: "latitude", data_type: "Number" },
        ]),
      );
    }

    if (query === "CALL table_info('Route') RETURN *") {
      return Promise.resolve(
        response([{ column_name: "distance", type: "Number" }]),
      );
    }

    if (query === "CALL show_connection('Route') RETURN *") {
      return Promise.resolve(
        response([
          {
            count: "3",
            "destination table name": "Airport",
            "source table name": "Airport",
          },
        ]),
      );
    }

    throw new Error(query);
  });
}

describe("Ladybug fetchSchema", () => {
  it("discovers schema through Ladybug table metadata queries", async () => {
    const openCypherFetch = createSchemaFetch();

    await expect(
      fetchSchema(openCypherFetch as OpenCypherFetch),
    ).resolves.toStrictEqual({
      edgeConnections: [
        createEdgeConnection({
          count: 3,
          edge: "Route",
          source: "Airport",
          target: "Airport",
        }),
      ],
      edges: [
        {
          attributes: [{ dataType: "Number", name: "distance" }],
          total: 3,
          type: createEdgeType("Route"),
        },
      ],
      totalEdges: 3,
      totalVertices: 2,
      vertices: [
        {
          attributes: [
            { dataType: "String", name: "code" },
            { dataType: "Number", name: "latitude" },
          ],
          total: 2,
          type: createVertexType("Airport"),
        },
      ],
    });

    expect(openCypherFetch).toHaveBeenCalledWith("CALL show_tables() RETURN *");
    expect(openCypherFetch).toHaveBeenCalledWith(
      "CALL table_info('Airport') RETURN *",
    );
    expect(openCypherFetch).toHaveBeenCalledWith(
      "CALL table_info('Route') RETURN *",
    );
    expect(openCypherFetch).toHaveBeenCalledWith(
      "CALL show_connection('Route') RETURN *",
    );
    expect(openCypherFetch).not.toHaveBeenCalledWith(
      "CALL table_info('duckdb_functions') RETURN *",
    );
    expect(openCypherFetch).toHaveBeenNthCalledWith(
      1,
      "CALL show_tables() RETURN *",
    );
    expect(openCypherFetch).toHaveBeenNthCalledWith(
      2,
      "CALL table_info('Route') RETURN *",
    );
    expect(openCypherFetch).toHaveBeenNthCalledWith(
      3,
      "CALL table_info('Airport') RETURN *",
    );
    expect(openCypherFetch).toHaveBeenNthCalledWith(
      4,
      "CALL show_connection('Route') RETURN *",
    );
  });

  it("keeps an empty edgeConnections array when connection discovery has no rows", async () => {
    const openCypherFetch = vi.fn((query: string) => {
      if (query === "CALL show_tables() RETURN *") {
        return Promise.resolve(
          response([{ name: "Route", table_type: "REL" }]),
        );
      }
      if (query === "CALL table_info('Route') RETURN *") {
        return Promise.resolve(response([]));
      }
      if (query === "CALL show_connection('Route') RETURN *") {
        return Promise.resolve(response([]));
      }
      throw new Error(query);
    });

    await expect(
      fetchSchema(openCypherFetch as OpenCypherFetch),
    ).resolves.toMatchObject({
      edgeConnections: [],
      edges: [{ attributes: [], type: createEdgeType("Route") }],
      vertices: [],
    });
  });

  it("captures primary keys and edge connections in the schema cache", async () => {
    const openCypherFetch = createSchemaFetch();
    const cache = createLadybugSchemaCache(
      () => openCypherFetch as OpenCypherFetch,
    );

    await expect(cache.schema()).resolves.toMatchObject({
      totalEdges: 3,
      totalVertices: 2,
    });
    await expect(cache.primaryKey("Airport")).resolves.toBe("code");
    await expect(cache.edgeConnections("Route")).resolves.toStrictEqual([
      createEdgeConnection({
        count: 3,
        edge: "Route",
        source: "Airport",
        target: "Airport",
      }),
    ]);
  });

  it("fails clearly for malformed required show_tables rows", async () => {
    const openCypherFetch = vi.fn(() =>
      Promise.resolve(response([{ name: "Airport" }])),
    );

    await expect(
      fetchSchema(openCypherFetch as OpenCypherFetch),
    ).rejects.toThrow("missing table type");
  });

  it("fails clearly for malformed graph show_tables rows", async () => {
    const openCypherFetch = vi.fn(() =>
      Promise.resolve(response([{ table_type: "NODE" }])),
    );

    await expect(
      fetchSchema(openCypherFetch as OpenCypherFetch),
    ).rejects.toThrow("missing table name");
  });
});
