import { useAtomCallback } from "jotai/utils";
import { useCallback } from "react";

import {
  activeConfigurationAtom,
  configurationAtom,
  createNewConfigurationId,
  type RawConfiguration,
} from "@/core";
import useResetState from "@/core/StateProvider/useResetState";
import { stageLadybugWasmDatabase } from "@/ladybug-wasm/client";

type LadybugLocalConnection = NonNullable<RawConfiguration["connection"]> & {
  backend: "ladybug-wasm-local-file";
  ladybug: {
    fileName: string;
    fileSize: number;
    lastModified: number;
    runtimeId: string;
  };
};

export function useOpenLadybugFile() {
  const resetState = useResetState();

  return useAtomCallback(
    useCallback(
      async (_get, set, file: File) => {
        const newId = createNewConfigurationId();
        const runtimeId = newId as string;

        await stageLadybugWasmDatabase(runtimeId, file);

        const connection: LadybugLocalConnection = {
          backend: "ladybug-wasm-local-file",
          url: `/ladybug-wasm/${encodeURIComponent(runtimeId)}`,
          queryEngine: "openCypher",
          proxyConnection: false,
          ladybug: {
            fileName: file.name,
            fileSize: file.size,
            lastModified: file.lastModified,
            runtimeId,
          },
        };

        set(configurationAtom, prevConfig => {
          const updatedConfig = new Map(prevConfig);
          updatedConfig.set(newId, {
            id: newId,
            displayLabel: file.name,
            connection,
          });
          return updatedConfig;
        });
        set(activeConfigurationAtom, newId);

        resetState();
      },
      [resetState],
    ),
  );
}
