// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { TooltipProvider } from "@/components";
import { getAppStore, type ConfigurationContextProps } from "@/core";
import { createQueryClient } from "@/core/queryClient";
import { DbState, TestProvider } from "@/utils/testing";

import ConnectionDetail from "./ConnectionDetail";

const mockSaveConfigurationToFile = vi.fn();
vi.mock("@/utils/saveConfigurationToFile", () => ({
  default: (...args: unknown[]) => mockSaveConfigurationToFile(...args),
}));

function toConfigurationContext(
  config: DbState["activeConfig"],
): ConfigurationContextProps {
  return {
    ...config,
    totalVertices: 0,
    vertexTypes: [],
    totalEdges: 0,
    edgeTypes: [],
  };
}

describe("ConnectionDetail", () => {
  beforeEach(() => {
    mockSaveConfigurationToFile.mockClear();
  });

  test("displays local Ladybug file metadata", () => {
    const state = new DbState().withNoActiveSchema();
    state.activeConfig.displayLabel = "Local Ladybug";
    state.activeConfig.connection = {
      backend: "ladybug-wasm-local-file",
      queryEngine: "openCypher",
      url: "",
      ladybug: {
        runtimeId: "runtime-1",
        fileName: "air-routes.lbug",
        fileSize: 1234,
      },
    } as typeof state.activeConfig.connection;
    const store = getAppStore();
    state.applyTo(store);

    render(
      <TestProvider client={createQueryClient()} store={store}>
        <TooltipProvider>
          <ConnectionDetail
            config={toConfigurationContext(state.activeConfig)}
          />
        </TooltipProvider>
      </TestProvider>,
    );

    expect(screen.getByText("Ladybug Local File")).toBeInTheDocument();
    expect(screen.getByText("air-routes.lbug")).toBeInTheDocument();
    expect(screen.getByText("1,234 bytes")).toBeInTheDocument();
    expect(screen.getByText("Runtime ID: runtime-1")).toBeInTheDocument();
  });

  test("disables local Ladybug export with an explicit message", async () => {
    const user = userEvent.setup();
    const state = new DbState().withNoActiveSchema();
    state.activeConfig.connection = {
      backend: "ladybug-wasm-local-file",
      queryEngine: "openCypher",
      url: "",
      ladybug: { runtimeId: "runtime-1", fileName: "air-routes.lbug" },
    } as typeof state.activeConfig.connection;
    const store = getAppStore();
    state.applyTo(store);

    render(
      <TestProvider client={createQueryClient()} store={store}>
        <TooltipProvider>
          <ConnectionDetail
            config={toConfigurationContext(state.activeConfig)}
          />
        </TooltipProvider>
      </TestProvider>,
    );

    const exportButton = screen.getByRole("button", {
      name: "Local Ladybug file connections cannot be exported because OPFS file locality makes the exported config unusable.",
    });
    expect(exportButton).toBeDisabled();

    await user.click(exportButton);
    expect(mockSaveConfigurationToFile).not.toHaveBeenCalled();
  });

  test("does not show save-copy delete action for local Ladybug connections", async () => {
    const user = userEvent.setup();
    const state = new DbState().withNoActiveSchema();
    state.activeConfig.displayLabel = "Local Ladybug";
    state.activeConfig.connection = {
      backend: "ladybug-wasm-local-file",
      queryEngine: "openCypher",
      url: "",
      ladybug: { runtimeId: "runtime-1", fileName: "air-routes.lbug" },
    } as typeof state.activeConfig.connection;
    const store = getAppStore();
    state.applyTo(store);

    render(
      <TestProvider client={createQueryClient()} store={store}>
        <TooltipProvider>
          <ConnectionDetail
            config={toConfigurationContext(state.activeConfig)}
          />
        </TooltipProvider>
      </TestProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Delete connection" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Local Ladybug file connections cannot be exported because OPFS file locality makes the exported config unusable.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save a Copy & Delete" }),
    ).not.toBeInTheDocument();
  });

  test("shows save-copy delete action for non-local connections", async () => {
    const user = userEvent.setup();
    const state = new DbState().withNoActiveSchema();
    state.activeConfig.connection = {
      backend: "remote",
      queryEngine: "gremlin",
      url: "https://example.com",
    } as typeof state.activeConfig.connection;
    const store = getAppStore();
    state.applyTo(store);

    render(
      <TestProvider client={createQueryClient()} store={store}>
        <TooltipProvider>
          <ConnectionDetail
            config={toConfigurationContext(state.activeConfig)}
          />
        </TooltipProvider>
      </TestProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Delete connection" }));

    expect(
      screen.getByRole("button", { name: "Save a Copy & Delete" }),
    ).toBeInTheDocument();
  });

  test("allows remote Ladybug export and displays database name", async () => {
    const user = userEvent.setup();
    const state = new DbState().withNoActiveSchema();
    state.activeConfig.connection = {
      backend: "ladybug-remote",
      queryEngine: "openCypher",
      url: "/ladybug/air-routes",
      ladybug: { databaseName: "air-routes" },
    } as typeof state.activeConfig.connection;
    const store = getAppStore();
    state.applyTo(store);
    const config = toConfigurationContext(state.activeConfig);

    render(
      <TestProvider client={createQueryClient()} store={store}>
        <TooltipProvider>
          <ConnectionDetail config={config} />
        </TooltipProvider>
      </TestProvider>,
    );

    expect(screen.getByText("Ladybug Database")).toBeInTheDocument();
    expect(screen.getByText("air-routes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Export Connection" }));
    expect(mockSaveConfigurationToFile).toHaveBeenCalledWith(config);

    await user.click(screen.getByRole("button", { name: "Delete connection" }));
    expect(
      screen.getByRole("button", { name: "Save a Copy & Delete" }),
    ).toBeInTheDocument();
  });
});
