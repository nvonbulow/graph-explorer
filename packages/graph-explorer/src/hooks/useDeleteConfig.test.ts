// @vitest-environment happy-dom
import { waitFor } from "@testing-library/react";
import { useAtomValue } from "jotai";
import { act } from "react";
import { beforeEach, vi } from "vitest";

import {
  activeConfigurationAtom,
  allGraphSessionsAtom,
  configurationAtom,
  schemaAtom,
  type RawConfiguration,
} from "@/core";
import { deleteLadybugWasmDatabase } from "@/ladybug-wasm/client";
import {
  createRandomRawConfiguration,
  createRandomSchema,
  createRandomVertex,
  DbState,
  renderHookWithJotai,
} from "@/utils/testing";

import { useDeleteActiveConfiguration } from "./useDeleteConfig";

vi.mock("@/ladybug-wasm/client", () => ({
  deleteLadybugWasmDatabase: vi.fn(),
}));

const deleteLadybugWasmDatabaseMock = vi.mocked(deleteLadybugWasmDatabase);

beforeEach(() => {
  deleteLadybugWasmDatabaseMock.mockReset();
});

test("should delete the active configuration", async () => {
  const config1 = createRandomRawConfiguration();

  const { result } = renderHookWithJotai(
    () => {
      const callback = useDeleteActiveConfiguration();
      const allConfigs = useAtomValue(configurationAtom);
      const activeConfig = useAtomValue(activeConfigurationAtom);

      return { callback, allConfigs, activeConfig };
    },
    store => {
      store.set(activeConfigurationAtom, config1.id);
      store.set(configurationAtom, new Map([[config1.id, config1]]));
    },
  );

  await act(async () => {
    await result.current.callback();
  });

  await waitFor(() => {
    expect(result.current.activeConfig).toBeNull();
    expect(result.current.allConfigs.size).toBe(0);
  });
});

test("should delete the active schema", async () => {
  const config1 = createRandomRawConfiguration();
  const schema1 = createRandomSchema();

  const { result } = renderHookWithJotai(
    () => {
      const callback = useDeleteActiveConfiguration();
      const allSchemas = useAtomValue(schemaAtom);

      return { callback, allSchemas };
    },
    store => {
      store.set(activeConfigurationAtom, config1.id);
      store.set(configurationAtom, new Map([[config1.id, config1]]));
      store.set(schemaAtom, new Map([[config1.id, schema1]]));
    },
  );

  await act(async () => {
    await result.current.callback();
  });

  await waitFor(() => {
    expect(result.current.allSchemas.size).toBe(0);
  });
});

test("should delete the graph session for the active connection", async () => {
  const dbState = new DbState();
  dbState.addVertexToGraph(createRandomVertex());

  const { result } = renderHookWithJotai(
    () => {
      const callback = useDeleteActiveConfiguration();
      const allGraphs = useAtomValue(allGraphSessionsAtom);

      return { callback, allGraphs };
    },
    store => {
      dbState.applyTo(store);
    },
  );

  await act(async () => {
    await result.current.callback();
  });

  await waitFor(() => {
    expect(result.current.allGraphs.size).toBe(0);
  });
});

test("should delete the staged Ladybug WASM database for a local config", async () => {
  const config1 = {
    ...createRandomRawConfiguration(),
    connection: {
      url: "http://localhost/ladybug",
      queryEngine: "openCypher",
      backend: "ladybug-wasm-local-file",
      ladybug: {
        runtimeId: "runtime-1",
        fileName: "graph.lbug",
        fileSize: 1024,
        lastModified: 1234,
      },
    },
  } satisfies RawConfiguration;

  deleteLadybugWasmDatabaseMock.mockResolvedValue(true);

  const { result } = renderHookWithJotai(
    () => {
      const callback = useDeleteActiveConfiguration();
      const allConfigs = useAtomValue(configurationAtom);
      const activeConfig = useAtomValue(activeConfigurationAtom);

      return { callback, allConfigs, activeConfig };
    },
    store => {
      store.set(activeConfigurationAtom, config1.id);
      store.set(configurationAtom, new Map([[config1.id, config1]]));
    },
  );

  await act(async () => {
    await result.current.callback();
  });

  expect(deleteLadybugWasmDatabaseMock).toHaveBeenCalledTimes(1);
  expect(deleteLadybugWasmDatabaseMock).toHaveBeenCalledWith("runtime-1");
  await waitFor(() => {
    expect(result.current.activeConfig).toBeNull();
    expect(result.current.allConfigs.size).toBe(0);
  });
});

test("should keep the local Ladybug config when database cleanup fails", async () => {
  const config1 = {
    ...createRandomRawConfiguration(),
    connection: {
      url: "http://localhost/ladybug",
      queryEngine: "openCypher",
      backend: "ladybug-wasm-local-file",
      ladybug: {
        runtimeId: "runtime-fail",
      },
    },
  } satisfies RawConfiguration;
  const cleanupError = new Error("cleanup failed");
  deleteLadybugWasmDatabaseMock.mockRejectedValue(cleanupError);

  const { result } = renderHookWithJotai(
    () => {
      const callback = useDeleteActiveConfiguration();
      const allConfigs = useAtomValue(configurationAtom);
      const activeConfig = useAtomValue(activeConfigurationAtom);

      return { callback, allConfigs, activeConfig };
    },
    store => {
      store.set(activeConfigurationAtom, config1.id);
      store.set(configurationAtom, new Map([[config1.id, config1]]));
    },
  );

  await expect(
    act(async () => {
      await result.current.callback();
    }),
  ).rejects.toThrow("cleanup failed");

  expect(result.current.activeConfig).toBe(config1.id);
  expect(result.current.allConfigs.get(config1.id)).toBe(config1);
});
