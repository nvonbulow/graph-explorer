import { useAtomValue } from "jotai";
import { useAtomCallback } from "jotai/utils";
import { useCallback } from "react";

import {
  activeConfigurationAtom,
  allGraphSessionsAtom,
  configurationAtom,
  type ConfigurationId,
  schemaAtom,
} from "@/core";
import { deleteLadybugWasmDatabase } from "@/ladybug-wasm/client";
import { logger } from "@/utils";

type LadybugLocalConnection = {
  backend?: unknown;
  ladybug?: {
    runtimeId?: unknown;
  };
};

function getLadybugLocalRuntimeId(connection: unknown): string | undefined {
  const localConnection = connection as LadybugLocalConnection | undefined;
  if (localConnection?.backend !== "ladybug-wasm-local-file") {
    return undefined;
  }

  const runtimeId = localConnection.ladybug?.runtimeId;
  return typeof runtimeId === "string" && runtimeId.length > 0
    ? runtimeId
    : undefined;
}

export function useDeleteConfig() {
  return useAtomCallback(
    useCallback(async (get, set, id: ConfigurationId) => {
      logger.log("Deleting connection:", id);

      const config = get(configurationAtom).get(id);
      const ladybugRuntimeId = getLadybugLocalRuntimeId(config?.connection);
      if (ladybugRuntimeId != null) {
        try {
          await deleteLadybugWasmDatabase(ladybugRuntimeId);
        } catch (error) {
          logger.error("Failed to delete Ladybug WASM database:", error);
          throw error;
        }
      }

      set(activeConfigurationAtom, prev => {
        if (prev === id) {
          return null;
        }
        return prev;
      });

      set(configurationAtom, prevConfigs => {
        const updatedConfigs = new Map(prevConfigs);
        updatedConfigs.delete(id);
        return updatedConfigs;
      });

      set(schemaAtom, prevSchemas => {
        const updatedSchemas = new Map(prevSchemas);
        updatedSchemas.delete(id);
        return updatedSchemas;
      });

      set(allGraphSessionsAtom, prev => {
        const updatedGraphs = new Map(prev);
        updatedGraphs.delete(id);
        return updatedGraphs;
      });
    }, []),
  );
}

export function useDeleteActiveConfiguration() {
  const activeConfigId = useAtomValue(activeConfigurationAtom);
  const deleteConfig = useDeleteConfig();

  return () => {
    if (!activeConfigId) {
      return;
    }

    return deleteConfig(activeConfigId);
  };
}
