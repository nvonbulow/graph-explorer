// @vitest-environment happy-dom
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { TooltipProvider } from "@/components";
import {
  activeConfigurationAtom,
  configurationAtom,
  getAppStore,
} from "@/core";
import { createQueryClient } from "@/core/queryClient";
import { DbState, renderHookWithState, TestProvider } from "@/utils/testing";

import AvailableConnections from "./AvailableConnections";
import { ConnectionRow } from "./ConnectionRow";
import { useOpenLadybugFile } from "./useOpenLadybugFile";

const mockStageLadybugWasmDatabase = vi.hoisted(() => vi.fn());
const mockResetState = vi.hoisted(() => vi.fn());

vi.mock("@/ladybug-wasm/client", () => ({
  stageLadybugWasmDatabase: mockStageLadybugWasmDatabase,
}));

vi.mock("@/core/StateProvider/useResetState", () => ({
  default: () => mockResetState,
}));

vi.mock("@/modules/CreateConnection", () => ({
  default: () => <div>CreateConnection</div>,
}));

describe("useOpenLadybugFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStageLadybugWasmDatabase.mockResolvedValue(
      "/graph-explorer-ladybug/runtime.lbug",
    );
  });

  test("stages the selected file in OPFS and selects a local Ladybug config", async () => {
    const state = new DbState();
    const { result } = renderHookWithState(() => useOpenLadybugFile(), state);
    const lastModified = new Date("2026-05-24T12:00:00.000Z").getTime();
    const file = new File(["ladybug-file-content"], "graph.lbug", {
      type: "application/octet-stream",
      lastModified,
    });

    await act(async () => {
      await result.current(file);
    });

    const configs = getAppStore().get(configurationAtom);
    const activeConfigId = getAppStore().get(activeConfigurationAtom);
    const openedConfig =
      activeConfigId == null ? undefined : configs.get(activeConfigId);

    expect(configs.size).toBe(2);
    expect(activeConfigId).not.toBe(state.activeConfig.id);
    expect(openedConfig).toBeDefined();
    expect(mockStageLadybugWasmDatabase).toHaveBeenCalledOnce();
    expect(mockStageLadybugWasmDatabase).toHaveBeenCalledWith(
      String(activeConfigId),
      file,
    );
    expect(openedConfig?.displayLabel).toBe("graph.lbug");
    expect(openedConfig?.connection).toStrictEqual({
      backend: "ladybug-wasm-local-file",
      url: `/ladybug-wasm/${encodeURIComponent(String(activeConfigId))}`,
      queryEngine: "openCypher",
      proxyConnection: false,
      ladybug: {
        fileName: "graph.lbug",
        fileSize: file.size,
        lastModified,
        runtimeId: String(activeConfigId),
      },
    });
    expect(JSON.stringify(openedConfig)).not.toContain("ladybug-file-content");
    expect(mockResetState).toHaveBeenCalledOnce();
  });
});

describe("AvailableConnections Ladybug file button", () => {
  test("renders Ladybug .lbug file inputs without changing JSON import inputs", () => {
    const store = getAppStore();
    store.set(configurationAtom, new Map());
    const queryClient = createQueryClient();

    const { container } = render(
      <TestProvider client={queryClient} store={store}>
        <TooltipProvider>
          <AvailableConnections isSync={false} />
        </TooltipProvider>
      </TestProvider>,
    );

    expect(
      screen.getAllByRole("button", { name: "Open Ladybug file" }),
    ).toHaveLength(2);
    const fileInputs = Array.from(
      container.querySelectorAll("input[type=file]"),
    );
    expect(fileInputs.map(input => input.getAttribute("accept"))).toEqual([
      "application/json",
      ".lbug",
      "application/json",
      ".lbug",
    ]);
  });
});

describe("ConnectionRow Ladybug metadata", () => {
  test("shows the local file backend and file name instead of the synthetic URL", () => {
    const state = new DbState();
    const store = getAppStore();
    state.applyTo(store);

    render(
      <TestProvider client={createQueryClient()} store={store}>
        <ConnectionRow
          connection={{
            id: state.activeConfig.id,
            displayLabel: "Local graph",
            connection: {
              backend: "ladybug-wasm-local-file",
              url: "/ladybug-wasm/runtime-1",
              queryEngine: "openCypher",
              proxyConnection: false,
              ladybug: {
                fileName: "graph.lbug",
                fileSize: 3,
                lastModified: 1,
                runtimeId: "runtime-1",
              },
            } as NonNullable<typeof state.activeConfig.connection>,
          }}
          isSelected={false}
          isDisabled={false}
        />
      </TestProvider>,
    );

    expect(screen.getByText(/Ladybug local file/)).toBeInTheDocument();
    expect(screen.getByText(/graph\.lbug/)).toBeInTheDocument();
    expect(
      screen.queryByText(/\/ladybug-wasm\/runtime-1/),
    ).not.toBeInTheDocument();
  });
});
