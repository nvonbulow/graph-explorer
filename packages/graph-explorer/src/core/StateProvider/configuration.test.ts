import { createRandomName } from "@shared/utils/testing";

import { createEdgeType, createVertexType } from "@/core/entities";
import { RESERVED_TYPES_PROPERTY } from "@/utils";
import {
  createRandomEdgePreferencesStorageModel,
  createRandomEdgeTypeConfig,
  createRandomRawConfiguration,
  createRandomSchema,
  createRandomVertexPreferencesStorageModel,
  createRandomVertexTypeConfig,
} from "@/utils/testing";

import type {
  RawConfiguration,
  VertexTypeConfig,
} from "../ConfigurationProvider";
import type { SchemaStorageModel } from "./schema";
import type { UserStyling } from "./userPreferences";

import {
  defaultEdgeTypeConfig,
  defaultVertexTypeConfig,
  getDefaultEdgeTypeConfig,
  getDefaultVertexTypeConfig,
  mergeConfiguration,
  migrateLegacyConnection,
  normalizeConnection,
  type NormalizedConnection,
  patchToRemoveDisplayLabel,
} from "./configuration";

/** The default empty connection values when no value is provided. */
const defaultEmptyConnection: NormalizedConnection = {
  graphDbUrl: "",
  queryEngine: "gremlin",
  awsAuthEnabled: false,
};

describe("mergedConfiguration", () => {
  it("should produce empty defaults when empty object is passed", () => {
    const config = {} as RawConfiguration;
    const result = mergeConfiguration(null, config, {});

    expect(result).toEqual({
      connection: defaultEmptyConnection,
      schema: {
        edges: [],
        vertices: [],
        totalEdges: 0,
        totalVertices: 0,
      },
    });
  });

  it("should produce empty schema when no schema provided", () => {
    const config = createRandomRawConfiguration();
    const result = mergeConfiguration(null, config, {});

    expect(result).toEqual({
      ...config,
      connection: {
        ...defaultEmptyConnection,
        ...config.connection,
      },
      schema: {
        edges: [],
        vertices: [],
        totalEdges: 0,
        totalVertices: 0,
      },
    } satisfies RawConfiguration);
  });

  it("should use schema when provided", () => {
    const config = createRandomRawConfiguration();
    const schema = createRandomSchema();
    const result = mergeConfiguration(schema, config, {});

    const expectedSchema = {
      ...schema,
      vertices: schema.vertices
        .map(v => ({
          ...defaultVertexTypeConfig,
          ...v,
        }))
        .map(patchToRemoveDisplayLabel)
        .toSorted(byType),
      edges: schema.edges
        .map(e => ({
          ...defaultEdgeTypeConfig,
          ...e,
        }))
        .map(patchToRemoveDisplayLabel),
      edgeConnections: schema.edgeConnections,
    } satisfies SchemaStorageModel;

    expect(result.schema?.vertices).toEqual(expectedSchema.vertices);
    expect(result.schema?.edges).toEqual(expectedSchema.edges);
    expect(result.schema?.edgeConnections).toEqual(
      expectedSchema.edgeConnections,
    );
    expect(result.schema).toEqual(expectedSchema);
    expect(result).toEqual({
      ...config,
      connection: {
        ...defaultEmptyConnection,
        ...config.connection,
        graphDbUrl: config.connection?.graphDbUrl ?? "",
      },
      schema: expectedSchema,
    } satisfies RawConfiguration);
  });

  it("should use styling when provided", () => {
    const config = createRandomRawConfiguration();
    const schema = createRandomSchema();
    const styling: UserStyling = {
      vertices: schema.vertices.map(v => ({
        ...createRandomVertexPreferencesStorageModel(),
        type: v.type,
      })),
      edges: schema.edges.map(v => ({
        ...createRandomEdgePreferencesStorageModel(),
        type: v.type,
      })),
    };
    const result = mergeConfiguration(schema, config, styling);

    const expectedSchema = {
      ...schema,
      vertices: schema.vertices
        .map(patchToRemoveDisplayLabel)
        .map(v => {
          const style = styling.vertices?.find(s => s.type === v.type) ?? {};
          return {
            ...defaultVertexTypeConfig,
            ...v,
            ...style,
          };
        })
        .toSorted(byType),
      edges: schema.edges.map(patchToRemoveDisplayLabel).map(e => {
        const style = styling.edges?.find(s => s.type === e.type) ?? {};
        return {
          ...defaultEdgeTypeConfig,
          ...e,
          ...style,
        };
      }),
      edgeConnections: schema.edgeConnections,
    } satisfies SchemaStorageModel;

    expect(result.schema?.vertices).toEqual(expectedSchema.vertices);
    expect(result.schema?.edges).toEqual(expectedSchema.edges);
    expect(result.schema?.edgeConnections).toEqual(
      expectedSchema.edgeConnections,
    );
    expect(result.schema).toEqual(expectedSchema);
    expect(result).toEqual({
      ...config,
      connection: {
        ...defaultEmptyConnection,
        ...config.connection,
        graphDbUrl: config.connection?.graphDbUrl ?? "",
      },
      schema: expectedSchema,
    });
  });

  it("should have undefined vertex display label when not provided", () => {
    const config = createRandomRawConfiguration();
    const styling: UserStyling = {};
    const schema = createRandomSchema();

    const vtConfig = createRandomVertexTypeConfig();
    delete vtConfig.displayLabel;
    schema.vertices = [vtConfig];

    const result = mergeConfiguration(schema, config, styling);

    const actualVtConfig = result.schema?.vertices.find(
      v => v.type === vtConfig.type,
    );

    expect(actualVtConfig?.displayLabel).toBeUndefined();
  });

  it("should have undefined edge display label when not provided", () => {
    const config: RawConfiguration = createRandomRawConfiguration();
    const styling: UserStyling = {};
    const schema = createRandomSchema();

    const etConfig = createRandomEdgeTypeConfig();
    delete etConfig.displayLabel;
    schema.edges = [etConfig];

    const result = mergeConfiguration(schema, config, styling);

    const actualEtConfig = result.schema?.edges.find(
      e => e.type === etConfig.type,
    );

    expect(actualEtConfig?.displayLabel).toBeUndefined();
  });

  it("should prefer vertex styling display label", () => {
    const vtConfig = createRandomVertexTypeConfig();
    vtConfig.displayLabel = createRandomName("displayLabel");

    const customDisplayLabel = createRandomName("Display Label");

    const config: RawConfiguration = createRandomRawConfiguration();
    const styling: UserStyling = {
      vertices: [
        {
          type: vtConfig.type,
          displayLabel: customDisplayLabel,
        },
      ],
    };
    const schema = createRandomSchema();
    schema.vertices = [vtConfig];

    const result = mergeConfiguration(schema, config, styling);

    const actualVtConfig = result.schema?.vertices.find(
      v => v.type === vtConfig.type,
    );

    expect(actualVtConfig?.displayLabel).toEqual(customDisplayLabel);
  });

  it("should prefer edge styling display label", () => {
    const etConfig = createRandomEdgeTypeConfig();
    etConfig.displayLabel = createRandomName("displayLabel");

    const customDisplayLabel = createRandomName("Display Label");

    const config: RawConfiguration = createRandomRawConfiguration();
    const styling: UserStyling = {
      edges: [
        {
          type: etConfig.type,
          displayLabel: customDisplayLabel,
        },
      ],
    };
    const schema = createRandomSchema();
    schema.edges = [etConfig];

    const result = mergeConfiguration(schema, config, styling);

    const actualEtConfig = result.schema?.edges.find(
      e => e.type === etConfig.type,
    );

    expect(actualEtConfig?.displayLabel).toEqual(customDisplayLabel);
  });

  it("should patch displayNameAttribute to be 'types' when it was 'type'", () => {
    const etConfig = createRandomEdgeTypeConfig();

    const config: RawConfiguration = createRandomRawConfiguration();
    const styling: UserStyling = {
      edges: [
        {
          type: etConfig.type,
          displayNameAttribute: "type",
        },
      ],
    };
    const schema = createRandomSchema();
    schema.edges = [etConfig];

    const result = mergeConfiguration(schema, config, styling);

    const actualEtConfig = result.schema?.edges.find(
      e => e.type === etConfig.type,
    );

    expect(actualEtConfig?.displayNameAttribute).toEqual(
      RESERVED_TYPES_PROPERTY,
    );
  });
});

/** Sorts the configs by type name */
function byType(a: VertexTypeConfig, b: VertexTypeConfig) {
  return a.type.localeCompare(b.type);
}

describe("patchToRemoveDisplayLabel", () => {
  it("should remove displayLabel", () => {
    const config = createRandomVertexTypeConfig();
    config.displayLabel = createRandomName("displayLabel");
    config.attributes.forEach(
      a => ((a as any).displayLabel = createRandomName("displayLabel")),
    );
    const result = patchToRemoveDisplayLabel(config);

    expect(result).not.toHaveProperty("displayLabel");
    for (const attr of result.attributes) {
      expect(attr).not.toHaveProperty("displayLabel");
    }
  });

  it("should not mutate the original config", () => {
    const config = createRandomVertexTypeConfig();
    config.displayLabel = createRandomName("displayLabel");
    config.attributes.forEach(
      a => ((a as any).displayLabel = createRandomName("displayLabel")),
    );
    const originalDisplayLabel = config.displayLabel;
    const originalAttrDisplayLabels = config.attributes.map(
      a => (a as any).displayLabel,
    );

    patchToRemoveDisplayLabel(config);

    expect(config.displayLabel).toBe(originalDisplayLabel);
    config.attributes.forEach((a, i) => {
      expect((a as any).displayLabel).toBe(originalAttrDisplayLabels[i]);
    });
  });
});

describe("normalizeConnection", () => {
  test("should remove trailing slash from graphDbUrl", () => {
    const result = normalizeConnection({ graphDbUrl: "https://example.com/" });
    expect(result.graphDbUrl).toBe("https://example.com");
  });

  test("should default queryEngine to gremlin", () => {
    const result = normalizeConnection({ graphDbUrl: "https://example.com" });
    expect(result.queryEngine).toBe("gremlin");
  });

  test("should default awsAuthEnabled to false", () => {
    const result = normalizeConnection({ graphDbUrl: "https://example.com" });
    expect(result.awsAuthEnabled).toBe(false);
  });

  test("should preserve path in graphDbUrl", () => {
    const result = normalizeConnection({
      graphDbUrl: "http://blazegraph:9999/blazegraph/namespace/kb",
    });
    expect(result.graphDbUrl).toBe(
      "http://blazegraph:9999/blazegraph/namespace/kb",
    );
  });

  test("should remove only trailing slash from graphDbUrl with path", () => {
    const result = normalizeConnection({
      graphDbUrl: "http://blazegraph:9999/blazegraph/namespace/kb/",
    });
    expect(result.graphDbUrl).toBe(
      "http://blazegraph:9999/blazegraph/namespace/kb",
    );
  });

  test("should migrate legacy connection with url and proxyConnection=true", () => {
    const result = normalizeConnection({
      url: "https://proxy.com",
      proxyConnection: true,
      graphDbUrl: "https://db.com",
    } as any);
    expect(result.graphDbUrl).toBe("https://db.com");
  });

  test("should migrate legacy connection with url and proxyConnection=false", () => {
    const result = normalizeConnection({
      url: "https://my-neptune:8182",
      proxyConnection: false,
    } as any);
    expect(result.graphDbUrl).toBe("https://my-neptune:8182");
  });
});

describe("migrateLegacyConnection", () => {
  test("should use graphDbUrl directly when proxyConnection is true", () => {
    const result = migrateLegacyConnection({
      url: "https://proxy.example.com",
      proxyConnection: true,
      graphDbUrl: "https://my-neptune:8182",
    });
    expect(result.graphDbUrl).toBe("https://my-neptune:8182");
  });

  test("should use url as graphDbUrl when proxyConnection is false", () => {
    const result = migrateLegacyConnection({
      url: "https://my-neptune:8182",
      proxyConnection: false,
    });
    expect(result.graphDbUrl).toBe("https://my-neptune:8182");
  });

  test("should use url as graphDbUrl when proxyConnection is absent and no graphDbUrl", () => {
    const result = migrateLegacyConnection({
      url: "https://my-neptune:8182",
    });
    expect(result.graphDbUrl).toBe("https://my-neptune:8182");
  });

  test("should not include proxyConnection in result", () => {
    const result = migrateLegacyConnection({
      url: "https://proxy.com",
      proxyConnection: true,
      graphDbUrl: "https://db.com",
    });
    expect(result).not.toHaveProperty("proxyConnection");
  });

  test("should not include url in result", () => {
    const result = migrateLegacyConnection({
      url: "https://proxy.com",
      proxyConnection: true,
      graphDbUrl: "https://db.com",
    });
    expect(result).not.toHaveProperty("url");
  });

  test("should preserve other connection properties", () => {
    const result = migrateLegacyConnection({
      url: "https://proxy.com",
      proxyConnection: true,
      graphDbUrl: "https://db.com",
      queryEngine: "sparql",
      awsAuthEnabled: true,
      awsRegion: "us-east-1",
      serviceType: "neptune-graph",
      fetchTimeoutMs: 30000,
      nodeExpansionLimit: 100,
    });
    expect(result.queryEngine).toBe("sparql");
    expect(result.awsAuthEnabled).toBe(true);
    expect(result.awsRegion).toBe("us-east-1");
    expect(result.serviceType).toBe("neptune-graph");
    expect(result.fetchTimeoutMs).toBe(30000);
    expect(result.nodeExpansionLimit).toBe(100);
  });

  test("should pass through a connection that already has graphDbUrl and no url", () => {
    const result = migrateLegacyConnection({
      graphDbUrl: "https://db.com",
      queryEngine: "gremlin",
    });
    expect(result.graphDbUrl).toBe("https://db.com");
  });
});

describe("getDefaultVertexTypeConfig", () => {
  test("should return default config with given type", () => {
    const result = getDefaultVertexTypeConfig(createVertexType("Person"));
    expect(result).toStrictEqual({
      ...defaultVertexTypeConfig,
      type: createVertexType("Person"),
    });
  });
});

describe("getDefaultEdgeTypeConfig", () => {
  test("should return default config with given type", () => {
    const result = getDefaultEdgeTypeConfig(createEdgeType("knows"));
    expect(result).toStrictEqual({
      ...defaultEdgeTypeConfig,
      type: createEdgeType("knows"),
    });
  });
});
