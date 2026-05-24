import { saveAs } from "file-saver";

import type { ConfigurationContextProps } from "@/core";

import { toJsonFileData } from "./fileData";

type LadybugLocalConnection = {
  backend?: unknown;
};

function isLadybugLocalConnection(connection: unknown): boolean {
  return (
    (connection as LadybugLocalConnection | undefined)?.backend ===
    "ladybug-wasm-local-file"
  );
}

const saveConfigurationToFile = (config: ConfigurationContextProps) => {
  if (isLadybugLocalConnection(config.connection)) {
    throw new Error(
      "Local Ladybug configurations cannot be exported because database file bytes are stored only in the browser.",
    );
  }

  const exportableConfig = {
    id: config.id,
    displayLabel: config.displayLabel || config.id,
    connection: {
      ...config.connection,
      queryEngine: config.connection?.queryEngine || "gremlin",
    },
    schema: {
      vertices: config.schema?.vertices || [],
      edges: config.schema?.edges || [],
      prefixes: config?.schema?.prefixes,
      lastUpdate: config.schema?.lastUpdate?.toISOString(),
      edgeConnections: config.schema?.edgeConnections,
    },
  };

  const fileToSave = toJsonFileData(exportableConfig);
  saveAs(fileToSave, `${exportableConfig.displayLabel}.json`);
};

export default saveConfigurationToFile;
