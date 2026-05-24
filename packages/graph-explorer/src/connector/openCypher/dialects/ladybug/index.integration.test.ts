import { describe, expect, it, vi } from "vitest";

import type { ResultEntity } from "@/connector/entities";
import type { OpenCypherFetch } from "@/connector/openCypher/types";

import {
  createEdgeConnection,
  createEdgeId,
  createEdgeType,
  createVertexId,
  createVertexType,
} from "@/core";

import {
  createLadybugOpenCypherDialect,
  encodeLadybugEdgeId,
  encodeLadybugVertexId,
} from ".";

type FakeVertex = {
  "~id": string;
  "~entityType": "node";
  "~labels": string[];
  "~properties": Record<string, string | number | boolean>;
};

type FakeEdge = {
  "~id": string;
  "~entityType": "relationship";
  "~start": string;
  "~end": string;
  "~type": string;
  "~properties": Record<string, string | number | boolean>;
};

const repoId = createVertexId(
  encodeLadybugVertexId({ label: "Repo", value: "repo:graph-explorer" }),
);
const adapterRepoId = createVertexId(
  encodeLadybugVertexId({ label: "Repo", value: "repo:ladybug-adapter" }),
);
const indexFileId = createVertexId(
  encodeLadybugVertexId({ label: "File", value: "file:src/index.ts" }),
);
const ladybugFileId = createVertexId(
  encodeLadybugVertexId({ label: "File", value: "file:src/ladybug.ts" }),
);
const packageFileId = createVertexId(
  encodeLadybugVertexId({ label: "File", value: "file:package.json" }),
);
const srcFolderId = createVertexId(
  encodeLadybugVertexId({ label: "Folder", value: "folder:src" }),
);
const testFolderId = createVertexId(
  encodeLadybugVertexId({ label: "Folder", value: "folder:test" }),
);
const aliceId = createVertexId(
  encodeLadybugVertexId({ label: "Author", value: "author:alice" }),
);
const bobId = createVertexId(
  encodeLadybugVertexId({ label: "Author", value: "author:bob" }),
);
const buildId = createVertexId(
  encodeLadybugVertexId({ label: "Build", value: "101" }),
);
const escapedId = createVertexId(
  encodeLadybugVertexId({ label: "Escaped", value: 'escaped:"\\\\key' }),
);

const repoToIndexFileEdgeId = encodeLadybugEdgeId({
  type: "CONTAINS",
  sourceId: String(repoId),
  targetId: String(indexFileId),
});
const repoToLadybugFileEdgeId = encodeLadybugEdgeId({
  type: "CONTAINS",
  sourceId: String(repoId),
  targetId: String(ladybugFileId),
});
const repoToSrcFolderEdgeId = encodeLadybugEdgeId({
  type: "CONTAINS",
  sourceId: String(repoId),
  targetId: String(srcFolderId),
});
const srcFolderToIndexFileEdgeId = encodeLadybugEdgeId({
  type: "CONTAINS",
  sourceId: String(srcFolderId),
  targetId: String(indexFileId),
});
const buildToRepoEdgeId = encodeLadybugEdgeId({
  type: "DEPENDS",
  sourceId: String(buildId),
  targetId: String(repoId),
});

const vertices: Record<string, FakeVertex> = {
  [String(repoId)]: vertex("Repo", String(repoId), {
    repo_key: "repo:graph-explorer",
    name: "Graph Explorer",
    stars: "9007199254740993",
  }),
  [String(adapterRepoId)]: vertex("Repo", String(adapterRepoId), {
    repo_key: "repo:ladybug-adapter",
    name: "Ladybug Adapter",
    stars: 42,
  }),
  [String(indexFileId)]: vertex("File", String(indexFileId), {
    file_key: "file:src/index.ts",
    path: "src/index.ts",
    bytes: 128,
  }),
  [String(ladybugFileId)]: vertex("File", String(ladybugFileId), {
    file_key: "file:src/ladybug.ts",
    path: "src/ladybug.ts",
    bytes: 256,
  }),
  [String(packageFileId)]: vertex("File", String(packageFileId), {
    file_key: "file:package.json",
    path: "package.json",
    bytes: 512,
  }),
  [String(srcFolderId)]: vertex("Folder", String(srcFolderId), {
    folder_key: "folder:src",
    path: "src",
  }),
  [String(testFolderId)]: vertex("Folder", String(testFolderId), {
    folder_key: "folder:test",
    path: "test",
  }),
  [String(aliceId)]: vertex("Author", String(aliceId), {
    author_key: "author:alice",
    name: "Alice",
  }),
  [String(bobId)]: vertex("Author", String(bobId), {
    author_key: "author:bob",
    name: "Bob",
  }),
  [String(buildId)]: vertex("Build", String(buildId), {
    build_id: 101,
    status: "passed",
  }),
  [String(escapedId)]: vertex("Escaped", String(escapedId), {
    escaped_key: 'escaped:"\\\\key',
    value: "quoted",
  }),
};

const edges: FakeEdge[] = [
  edge("CONTAINS", String(repoId), String(indexFileId), { weight: 7 }),
  edge("CONTAINS", String(repoId), String(ladybugFileId), { weight: 11 }),
  edge("CONTAINS", String(repoId), String(srcFolderId), { weight: 19 }),
  edge("CONTAINS", String(adapterRepoId), String(packageFileId), { weight: 5 }),
  edge("CONTAINS", String(srcFolderId), String(indexFileId), { weight: 3 }),
  edge("CONTAINS", String(srcFolderId), String(ladybugFileId), { weight: 13 }),
  edge("CONTAINS", String(testFolderId), String(packageFileId), { weight: 17 }),
  edge("OWNS", String(aliceId), String(repoId), { role: "maintainer" }),
  edge("OWNS", String(bobId), String(repoId), { role: "reviewer" }),
  edge("OWNS", String(aliceId), String(adapterRepoId), { role: "owner" }),
  edge("DEPENDS", String(buildId), String(repoId), { since: 2024 }),
];

function vertex(
  label: string,
  id: string,
  properties: Record<string, string | number | boolean>,
): FakeVertex {
  return {
    "~id": id,
    "~entityType": "node",
    "~labels": [label],
    "~properties": properties,
  };
}

function edge(
  type: string,
  sourceId: string,
  targetId: string,
  properties: Record<string, string | number | boolean>,
): FakeEdge {
  return {
    "~id": encodeLadybugEdgeId({ type, sourceId, targetId }),
    "~entityType": "relationship",
    "~start": sourceId,
    "~end": targetId,
    "~type": type,
    "~properties": properties,
  };
}

function createFakeOpenCypherFetch() {
  const queries: string[] = [];
  const fetch = vi.fn((query: string) => {
    queries.push(query);

    if (/\bID\s*\(/iu.test(query)) {
      return Promise.reject(
        new Error(`Ladybug dialect emitted Neptune ID() query: ${query}`),
      );
    }
    if (query.includes("pg/statistics") || query.includes("graphSummary")) {
      return Promise.reject(
        new Error(`Ladybug dialect emitted Neptune summary query: ${query}`),
      );
    }

    if (query === "CALL show_tables() RETURN *") {
      return Promise.resolve({
        results: [
          { name: "Repo", type: "NODE", count: 2 },
          { name: "File", type: "NODE", count: 3 },
          { name: "Folder", type: "NODE", count: 2 },
          { name: "Author", type: "NODE", count: 2 },
          { name: "Build", type: "NODE", count: 1 },
          { name: "Escaped", type: "NODE", count: 1 },
          { name: "CONTAINS", type: "REL", count: 7 },
          { name: "OWNS", type: "REL", count: 3 },
          { name: "DEPENDS", type: "REL", count: 1 },
        ],
      });
    }

    const tableInfo = query.match(
      /^CALL table_info\('([^']+)'\) RETURN \*$/u,
    )?.[1];
    if (tableInfo != null) {
      return Promise.resolve({ results: tableInfoRows(tableInfo) });
    }

    const showConnection = query.match(
      /^CALL show_connection\('([^']+)'\) RETURN \*$/u,
    )?.[1];
    if (showConnection != null) {
      return Promise.resolve({ results: connectionRows(showConnection) });
    }

    if (query === "MATCH (v:`Repo`) RETURN count(v) AS count") {
      return Promise.resolve({ results: [{ count: 2 }] });
    }

    if (
      query.includes("RETURN v AS object") &&
      query.includes("primaryKeyValue")
    ) {
      return Promise.resolve({
        results: Object.values(vertices)
          .filter(v => v["~labels"][0] === "Repo")
          .filter(v => String(v["~properties"].name).includes("Graph Explorer"))
          .map(object => ({
            object,
            label: "Repo",
            primaryKeyValue: object["~properties"].repo_key,
          })),
      });
    }

    if (query.includes("RETURN vertex LIMIT 1")) {
      const vertex = query.includes("build_id` = 101")
        ? vertices[String(buildId)]
        : query.includes('escaped_key` = "escaped:\\"\\\\\\\\key"')
          ? vertices[String(escapedId)]
          : vertices[String(repoId)];
      return Promise.resolve({ results: [{ vertex }] });
    }

    if (
      query.includes("RETURN collect(DISTINCT source) AS sourceObjects") &&
      query.includes("collect(DISTINCT neighbor) AS vObjects")
    ) {
      const sourceId = query.includes("build_id` = 101")
        ? String(buildId)
        : query.includes('folder_key` = "folder:src"')
          ? String(srcFolderId)
          : String(repoId);
      const matchingEdges = incidentEdges(sourceId).slice(
        0,
        query.includes("LIMIT 1") ? 1 : undefined,
      );
      return Promise.resolve({
        results: [
          {
            sourceObjects: matchingEdges.map(() => vertices[sourceId]),
            vObjects: matchingEdges.map(
              e => vertices[e["~start"] === sourceId ? e["~end"] : e["~start"]],
            ),
            eObjects: matchingEdges,
          },
        ],
      });
    }

    if (query.includes("RETURN collect(DISTINCT neighbor) AS neighbors")) {
      const sourceId = query.includes("build_id` = 101")
        ? String(buildId)
        : String(repoId);
      const matchingEdges = incidentEdges(sourceId);
      return Promise.resolve({
        results: [
          {
            neighbors: matchingEdges.map(
              e => vertices[e["~start"] === sourceId ? e["~end"] : e["~start"]],
            ),
          },
        ],
      });
    }

    if (query.includes("RETURN edge, source, target LIMIT 1")) {
      const edgeId = query.includes("[edge:`DEPENDS`]")
        ? buildToRepoEdgeId
        : repoToIndexFileEdgeId;
      const edgeObject = edges.find(e => e["~id"] === edgeId);
      return Promise.resolve({
        results: [
          {
            edge: edgeObject,
            source: vertices[edgeObject?.["~start"] ?? ""],
            target: vertices[edgeObject?.["~end"] ?? ""],
          },
        ],
      });
    }

    if (query.includes("RETURN count(repo) AS owned_repo_edges")) {
      return Promise.resolve({
        results: [{ owned_repo_edges: 3, max_stars: "9007199254740993" }],
      });
    }

    return Promise.reject(new Error(`Unexpected Ladybug fake query: ${query}`));
  }) as unknown as OpenCypherFetch;

  return { fetch, queries };
}

function tableInfoRows(table: string) {
  switch (table) {
    case "Repo":
      return [
        { name: "repo_key", type: "STRING", primary_key: true },
        { name: "name", type: "STRING" },
        { name: "stars", type: "INT64" },
      ];
    case "File":
      return [
        { name: "file_key", type: "STRING", primary_key: true },
        { name: "path", type: "STRING" },
        { name: "bytes", type: "INT64" },
      ];
    case "Folder":
      return [
        { name: "folder_key", type: "STRING", primary_key: true },
        { name: "path", type: "STRING" },
      ];
    case "Author":
      return [
        { name: "author_key", type: "STRING", primary_key: true },
        { name: "name", type: "STRING" },
      ];
    case "Build":
      return [
        { name: "build_id", type: "INT64", primary_key: true },
        { name: "status", type: "STRING" },
      ];
    case "Escaped":
      return [
        { name: "escaped_key", type: "STRING", primary_key: true },
        { name: "value", type: "STRING" },
      ];
    case "CONTAINS":
      return [{ name: "weight", type: "INT64" }];
    case "OWNS":
      return [{ name: "role", type: "STRING" }];
    case "DEPENDS":
      return [{ name: "since", type: "INT64" }];
    default:
      throw new Error(`Unexpected table_info table: ${table}`);
  }
}

function connectionRows(type: string) {
  switch (type) {
    case "CONTAINS":
      return [
        { source: "Repo", target: "File", count: 3 },
        { source: "Repo", target: "Folder", count: 1 },
        { source: "Folder", target: "File", count: 3 },
      ];
    case "OWNS":
      return [{ source: "Author", target: "Repo", count: 3 }];
    case "DEPENDS":
      return [{ source: "Build", target: "Repo", count: 1 }];
    default:
      throw new Error(`Unexpected show_connection type: ${type}`);
  }
}

function incidentEdges(vertexId: string) {
  return edges.filter(
    edge => edge["~start"] === vertexId || edge["~end"] === vertexId,
  );
}

function createExplorer() {
  const dialect = createLadybugOpenCypherDialect();
  const fake = createFakeOpenCypherFetch();

  return {
    ...fake,
    fetchSchema: () => dialect.fetchSchema(fake.fetch, noopLogger),
    fetchVertexCountsByType: (
      req: Parameters<typeof dialect.fetchVertexTypeCounts>[1],
    ) => dialect.fetchVertexTypeCounts(fake.fetch, req),
    fetchNeighbors: (req: Parameters<typeof dialect.fetchNeighbors>[1]) =>
      dialect.fetchNeighbors(fake.fetch, req),
    neighborCounts: (req: Parameters<typeof dialect.neighborCounts>[1]) =>
      dialect.neighborCounts(fake.fetch, req),
    keywordSearch: (req: Parameters<typeof dialect.keywordSearch>[1]) =>
      dialect.keywordSearch(fake.fetch, req),
    rawQuery: (req: Parameters<typeof dialect.rawQuery>[1]) =>
      dialect.rawQuery(fake.fetch, req),
    vertexDetails: (req: Parameters<typeof dialect.vertexDetails>[1]) =>
      dialect.vertexDetails(fake.fetch, req),
    edgeDetails: (req: Parameters<typeof dialect.edgeDetails>[1]) =>
      dialect.edgeDetails(fake.fetch, req),
    fetchEdgeConnections: (
      req: Parameters<typeof dialect.fetchEdgeConnections>[1],
    ) => dialect.fetchEdgeConnections(fake.fetch, req),
  };
}

function expectQueryBefore(
  queries: readonly string[],
  before: string,
  after: (query: string) => boolean,
) {
  const beforeIndex = queries.indexOf(before);
  const afterIndex = queries.findIndex(after);

  expect(beforeIndex).toBeGreaterThanOrEqual(0);
  expect(afterIndex).toBeGreaterThanOrEqual(0);
  expect(beforeIndex).toBeLessThan(afterIndex);
}

const noop = () => undefined;
const noopLogger = {
  debug: noop,
  error: noop,
  info: noop,
  trace: noop,
  warn: noop,
};

function collectScalars(results: readonly ResultEntity[]) {
  const scalars = new Map<string, string | number | boolean | Date | null>();

  function visit(result: ResultEntity) {
    if (result.entityType === "scalar" && result.name != null) {
      scalars.set(result.name, result.value);
      return;
    }

    if (result.entityType === "bundle") {
      result.values.forEach(visit);
    }
  }

  results.forEach(visit);
  return scalars;
}

describe("createLadybugOpenCypherDialect", () => {
  it("discovers Ladybug schema and edge connections without Neptune summary or ID queries", async () => {
    const explorer = createExplorer();

    const schema = await explorer.fetchSchema();

    expect(schema.vertices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: createVertexType("Repo"),
          total: 2,
          attributes: expect.arrayContaining([
            expect.objectContaining({ name: "repo_key" }),
          ]),
        }),
        expect.objectContaining({ type: createVertexType("File"), total: 3 }),
        expect.objectContaining({ type: createVertexType("Folder"), total: 2 }),
        expect.objectContaining({ type: createVertexType("Author"), total: 2 }),
      ]),
    );
    expect(schema.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: createEdgeType("CONTAINS"), total: 7 }),
        expect.objectContaining({ type: createEdgeType("OWNS"), total: 3 }),
      ]),
    );
    expect(schema.edgeConnections).toEqual(
      expect.arrayContaining([
        expect.objectContaining(
          createEdgeConnection({
            source: "Repo",
            edge: "CONTAINS",
            target: "File",
          }),
        ),
        expect.objectContaining(
          createEdgeConnection({
            source: "Repo",
            edge: "CONTAINS",
            target: "Folder",
          }),
        ),
        expect.objectContaining(
          createEdgeConnection({
            source: "Folder",
            edge: "CONTAINS",
            target: "File",
          }),
        ),
        expect.objectContaining(
          createEdgeConnection({
            source: "Author",
            edge: "OWNS",
            target: "Repo",
          }),
        ),
      ]),
    );
    expect(explorer.queries).toContain("CALL show_tables() RETURN *");
    expect(explorer.queries).toContain(
      "CALL show_connection('CONTAINS') RETURN *",
    );
  });

  it("delegates vertex counts to Neptune-compatible count queries", async () => {
    await expect(
      createExplorer().fetchVertexCountsByType({
        label: createVertexType("Repo"),
      }),
    ).resolves.toStrictEqual({ total: 2 });
  });

  it("returns keyword search vertices with Ladybug primary-key IDs", async () => {
    const search = await createExplorer().keywordSearch({
      vertexTypes: ["Repo"],
      searchTerm: "Graph Explorer",
      searchByAttributes: ["name"],
      limit: 0,
    });

    expect(search.vertices).toHaveLength(1);
    expect(search.vertices[0]).toMatchObject({
      id: repoId,
      types: ["Repo"],
      attributes: expect.objectContaining({
        repo_key: "repo:graph-explorer",
        name: "Graph Explorer",
      }),
    });
    expect(search.vertices[0]?.attributes.stars).toBe("9007199254740993");
  });

  it("returns vertex details by Ladybug primary-key ID", async () => {
    const details = await createExplorer().vertexDetails({
      vertexIds: [repoId],
    });

    expect(details.vertices).toHaveLength(1);
    expect(details.vertices[0]).toMatchObject({
      id: repoId,
      types: ["Repo"],
      attributes: expect.objectContaining({
        repo_key: "repo:graph-explorer",
        name: "Graph Explorer",
      }),
    });
  });

  it("returns neighbors and edge attributes using Ladybug primary keys", async () => {
    const explorer = createExplorer();
    const neighbors = await explorer.fetchNeighbors({
      vertexId: repoId,
      limit: 0,
    });

    expect(neighbors.vertices.map(vertex => String(vertex.id))).toEqual(
      expect.arrayContaining([
        String(indexFileId),
        String(ladybugFileId),
        String(aliceId),
        String(bobId),
        String(buildId),
        String(srcFolderId),
      ]),
    );
    expect(neighbors.edges).toHaveLength(6);
    expect(neighbors.edges.map(edge => String(edge.id))).toEqual(
      expect.arrayContaining([
        repoToIndexFileEdgeId,
        repoToLadybugFileEdgeId,
        repoToSrcFolderEdgeId,
        buildToRepoEdgeId,
      ]),
    );
    expect(
      neighbors.edges
        .map(edge =>
          String(
            edge.attributes.since ??
              edge.attributes.weight ??
              edge.attributes.role,
          ),
        )
        .sort(),
    ).toStrictEqual(["11", "19", "2024", "7", "maintainer", "reviewer"]);
    const neighborGraphQuery = (query: string) =>
      query.includes("RETURN collect(DISTINCT source) AS sourceObjects") &&
      query.includes("collect(DISTINCT neighbor) AS vObjects") &&
      query.includes("collect(edge) AS eObjects");
    expectQueryBefore(
      explorer.queries,
      "CALL show_tables() RETURN *",
      neighborGraphQuery,
    );
    expectQueryBefore(
      explorer.queries,
      "CALL table_info('Folder') RETURN *",
      neighborGraphQuery,
    );
    expectQueryBefore(
      explorer.queries,
      "CALL show_connection('CONTAINS') RETURN *",
      neighborGraphQuery,
    );
    const neighborQuery = explorer.queries.find(neighborGraphQuery);
    expect(neighborQuery).toContain(
      "RETURN collect(DISTINCT source) AS sourceObjects, collect(DISTINCT neighbor) AS vObjects, collect(edge) AS eObjects",
    );
  });

  it("uses Ladybug label predicates for excluded neighbor vertices", async () => {
    const explorer = createExplorer();

    await explorer.fetchNeighbors({
      vertexId: repoId,
      excludedVertices: new Set([indexFileId]),
      limit: 0,
    });

    const neighborQuery = explorer.queries.find(
      query =>
        query.includes("RETURN collect(DISTINCT source) AS sourceObjects") &&
        query.includes("collect(DISTINCT neighbor) AS vObjects") &&
        query.includes("collect(edge) AS eObjects"),
    );
    const whereClause = neighborQuery?.match(/\sWHERE\s(.+)\sRETURN /u)?.[1];

    expect(whereClause).toContain('label(neighbor) = "File"');
    expect(whereClause).toContain('neighbor.`file_key` = "file:src/index.ts"');
    expect(whereClause).not.toContain("neighbor:");
  });

  it("uses Ladybug label predicates for multiple target vertex types", async () => {
    const explorer = createExplorer();

    await explorer.fetchNeighbors({
      vertexId: repoId,
      filterByVertexTypes: ["File", "Folder"],
      limit: 0,
    });

    const neighborQuery = explorer.queries.find(
      query =>
        query.includes("RETURN collect(DISTINCT source) AS sourceObjects") &&
        query.includes("collect(DISTINCT neighbor) AS vObjects") &&
        query.includes("collect(edge) AS eObjects"),
    );
    const whereClause = neighborQuery?.match(/\sWHERE\s(.+)\sRETURN /u)?.[1];

    expect(whereClause).toContain('label(neighbor) IN ["File", "Folder"]');
    expect(whereClause).toContain('"File"');
    expect(whereClause).toContain('"Folder"');
    expect(whereClause).not.toContain("neighbor:");
  });

  it("honors positive neighbor limits", async () => {
    const explorer = createExplorer();

    await expect(
      explorer.fetchNeighbors({ vertexId: repoId, limit: 1 }),
    ).resolves.toMatchObject({ edges: [expect.any(Object)] });

    const limitedNeighborQuery = explorer.queries.find(
      query =>
        query.includes("WITH DISTINCT source, neighbor LIMIT 1") &&
        query.includes("RETURN collect(DISTINCT source) AS sourceObjects") &&
        query.includes("collect(DISTINCT neighbor) AS vObjects") &&
        query.includes("collect(edge) AS eObjects"),
    );
    expect(limitedNeighborQuery).toContain(
      "RETURN collect(DISTINCT source) AS sourceObjects, collect(DISTINCT neighbor) AS vObjects, collect(edge) AS eObjects",
    );
  });

  it("uses schema connection rows for repeated edge types", async () => {
    const neighbors = await createExplorer().fetchNeighbors({
      vertexId: srcFolderId,
      limit: 0,
    });

    expect(neighbors.vertices.map(vertex => String(vertex.id))).toEqual(
      expect.arrayContaining([String(indexFileId), String(ladybugFileId)]),
    );
    expect(neighbors.edges.map(edge => String(edge.id))).toEqual(
      expect.arrayContaining([srcFolderToIndexFileEdgeId]),
    );
  });

  it("returns neighbor counts by vertex type", async () => {
    const explorer = createExplorer();
    const counts = await explorer.neighborCounts({
      vertexIds: [repoId],
    });

    expect(counts.counts).toStrictEqual([
      {
        vertexId: repoId,
        totalCount: 6,
        counts: new Map([
          [createVertexType("File"), 2],
          [createVertexType("Folder"), 1],
          [createVertexType("Author"), 2],
          [createVertexType("Build"), 1],
        ]),
      },
    ]);
    const neighborCountGraphQuery = (query: string) =>
      query.includes("RETURN collect(DISTINCT neighbor) AS neighbors");
    expectQueryBefore(
      explorer.queries,
      "CALL table_info('Folder') RETURN *",
      neighborCountGraphQuery,
    );
  });

  it("returns edge details after validating Ladybug connection metadata", async () => {
    const explorer = createExplorer();

    const details = await explorer.edgeDetails({
      edgeIds: [createEdgeId(repoToIndexFileEdgeId)],
    });

    expect(details.edges).toHaveLength(1);
    expect(details.edges[0]).toMatchObject({
      id: repoToIndexFileEdgeId,
      sourceId: repoId,
      targetId: indexFileId,
      type: createEdgeType("CONTAINS"),
      attributes: expect.objectContaining({ weight: 7 }),
    });
    expect(explorer.queries).toContain(
      'MATCH (source:`Repo`)-[edge:`CONTAINS`]->(target:`File`) WHERE source.`repo_key` = "repo:graph-explorer" AND target.`file_key` = "file:src/index.ts" RETURN edge, source, target LIMIT 1',
    );
  });

  it("formats Ladybug primary-key predicates using table_info column types", async () => {
    const explorer = createExplorer();

    await explorer.vertexDetails({ vertexIds: [buildId] });
    await explorer.fetchNeighbors({ vertexId: buildId, limit: 0 });
    await explorer.neighborCounts({ vertexIds: [buildId] });
    await explorer.edgeDetails({ edgeIds: [createEdgeId(buildToRepoEdgeId)] });
    await explorer.vertexDetails({ vertexIds: [escapedId] });

    const queries = explorer.queries.join("\n");
    expect(queries).toContain("vertex.`build_id` = 101");
    expect(queries).toContain("source.`build_id` = 101");
    expect(queries).toContain('target.`repo_key` = "repo:graph-explorer"');
    expect(queries).not.toContain('`build_id` = "101"');
    expect(queries).toContain(
      `vertex.\`escaped_key\` = ${JSON.stringify('escaped:"\\\\key')}`,
    );
  });

  it("delegates raw query scalar handling to Neptune-compatible adapter responses", async () => {
    const raw = await createExplorer().rawQuery({
      query:
        "MATCH (:Author)-[:OWNS]->(repo:Repo) RETURN count(repo) AS owned_repo_edges, max(repo.stars) AS max_stars;",
    });
    const scalars = collectScalars(raw.results);

    expect(() => JSON.stringify(raw.results)).not.toThrow();
    expect(scalars.get("owned_repo_edges")).toBe(3);
    expect(scalars.get("max_stars")).toBe("9007199254740993");
  });

  it("returns cached Ladybug edge connections without Neptune edge discovery templates", async () => {
    const explorer = createExplorer();
    const schema = await explorer.fetchSchema();
    const allConnections = await explorer.fetchEdgeConnections({
      edgeTypes: [],
    });
    const containsConnections = await explorer.fetchEdgeConnections({
      edgeTypes: [createEdgeType("CONTAINS")],
    });

    expect(allConnections.edgeConnections).toStrictEqual(
      schema.edgeConnections,
    );
    expect(containsConnections.edgeConnections).toStrictEqual([
      createEdgeConnection({
        source: "Repo",
        edge: "CONTAINS",
        target: "File",
        count: 3,
      }),
      createEdgeConnection({
        source: "Repo",
        edge: "CONTAINS",
        target: "Folder",
        count: 1,
      }),
      createEdgeConnection({
        source: "Folder",
        edge: "CONTAINS",
        target: "File",
        count: 3,
      }),
    ]);
    expect(explorer.queries.join("\n")).not.toContain("ID(");
  });
});
