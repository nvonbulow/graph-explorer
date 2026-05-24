import { queryEngineOptions } from "@shared/types";

import type {
  AttributeConfig,
  ConfigurationContextProps,
  EdgeTypeConfig,
  VertexTypeConfig,
} from "@/core";

type LadybugConnection = {
  backend?: unknown;
  url?: unknown;
  ladybug?: {
    databaseName?: unknown;
  };
};

const getLadybugProxyUrl = (databaseName: string) =>
  `/ladybug/${encodeURIComponent(databaseName)}`;

const isValidLadybugRemoteConnection = (connection: LadybugConnection) => {
  const databaseName = connection.ladybug?.databaseName;

  if (typeof databaseName !== "string" || databaseName.length === 0) {
    return false;
  }

  return (
    connection.url === getLadybugProxyUrl(databaseName) ||
    (typeof connection.url === "string" && isValidHttpUrl(connection.url))
  );
};

const isValidHttpUrl = (str: string) => {
  let url;
  try {
    url = new URL(str);
  } catch {
    return false;
  }

  return url.protocol === "http:" || url.protocol === "https:";
};

const isValidAttributeConfig = (attr: any): attr is AttributeConfig => {
  if (!attr.name) {
    return false;
  }

  return true;
};

const isValidEdgeConfig = (edge: any): edge is EdgeTypeConfig => {
  if (!edge.type) {
    return false;
  }

  return true;
};

const isValidVertexConfig = (vertex: any): vertex is VertexTypeConfig => {
  if (!vertex.type) {
    return false;
  }

  for (const attr of vertex.attributes) {
    if (!isValidAttributeConfig(attr)) {
      return false;
    }
  }

  return true;
};

const isValidConfigurationFile = (
  data: any,
): data is Pick<
  ConfigurationContextProps,
  "id" | "displayLabel" | "connection" | "schema"
> => {
  if (!data.id || !data.connection || !data.schema) {
    return false;
  }

  const connection = data.connection as LadybugConnection;
  if (connection.backend === "ladybug-wasm-local-file") {
    return false;
  }

  if (
    connection.backend === "ladybug-remote" &&
    !isValidLadybugRemoteConnection(connection)
  ) {
    return false;
  }

  if (
    !data.connection.url ||
    !data.connection.queryEngine ||
    (connection.backend !== "ladybug-remote" &&
      !isValidHttpUrl(data.connection.url)) ||
    !queryEngineOptions.includes(data.connection.queryEngine)
  ) {
    return false;
  }

  for (const e of data.schema.edges) {
    if (!isValidEdgeConfig(e)) {
      return false;
    }
  }

  for (const v of data.schema.vertices) {
    if (!isValidVertexConfig(v)) {
      return false;
    }
  }

  return true;
};

export default isValidConfigurationFile;
