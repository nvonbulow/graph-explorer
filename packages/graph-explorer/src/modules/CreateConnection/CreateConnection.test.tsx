// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { TooltipProvider } from "@/components";
import {
  activeConfigurationAtom,
  allGraphSessionsAtom,
  configurationAtom,
  getAppStore,
  schemaAtom,
  type ConfigurationContextProps,
} from "@/core";
import { createQueryClient } from "@/core/queryClient";
import { DbState, TestProvider } from "@/utils/testing";

import CreateConnection from "./CreateConnection";

const mockResetState = vi.fn();
vi.mock("@/core/StateProvider/useResetState", () => ({
  default: () => mockResetState,
}));

afterEach(() => {
  cleanup();
});

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

describe("CreateConnection", () => {
  test("creates a remote Ladybug proxy connection", async () => {
    const user = userEvent.setup();
    const store = getAppStore();
    new DbState().applyTo(store);

    render(
      <TestProvider client={createQueryClient()} store={store}>
        <TooltipProvider>
          <CreateConnection onClose={vi.fn()} />
        </TooltipProvider>
      </TestProvider>,
    );

    await user.click(screen.getAllByRole("combobox")[0]);
    await user.keyboard("{ArrowDown}{Enter}");
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Air Routes Ladybug");
    await user.type(
      screen.getByLabelText("Ladybug Database Name"),
      "air-routes",
    );
    await user.click(screen.getByRole("button", { name: "Add Connection" }));

    const activeConfigId = store.get(activeConfigurationAtom);
    if (activeConfigId == null) {
      throw new Error(
        "Expected active configuration after creating connection",
      );
    }
    const createdConfig = store.get(configurationAtom).get(activeConfigId);
    expect(createdConfig?.displayLabel).toBe("Air Routes Ladybug");
    expect(createdConfig?.connection).toMatchObject({
      backend: "ladybug-remote",
      queryEngine: "openCypher",
      url: "/ladybug/air-routes",
      ladybug: { databaseName: "air-routes" },
    });
  });

  test("keeps standard remote graph database creation behavior", async () => {
    const user = userEvent.setup();
    const store = getAppStore();
    new DbState().applyTo(store);

    render(
      <TestProvider client={createQueryClient()} store={store}>
        <TooltipProvider>
          <CreateConnection onClose={vi.fn()} />
        </TooltipProvider>
      </TestProvider>,
    );

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Gremlin Remote");
    const endpointTextarea = screen
      .getAllByLabelText("Public or Proxy Endpoint")
      .find(
        (element): element is HTMLTextAreaElement =>
          element instanceof HTMLTextAreaElement,
      );
    if (!endpointTextarea) {
      throw new Error("Expected endpoint textarea");
    }
    await user.type(endpointTextarea, "https://example.com");
    await user.click(screen.getByRole("button", { name: "Add Connection" }));

    const activeConfigId = store.get(activeConfigurationAtom);
    if (activeConfigId == null) {
      throw new Error(
        "Expected active configuration after creating connection",
      );
    }
    const createdConfig = store.get(configurationAtom).get(activeConfigId);
    expect(createdConfig?.displayLabel).toBe("Gremlin Remote");
    expect(createdConfig?.connection).toMatchObject({
      backend: "remote",
      queryEngine: "gremlin",
      url: "https://example.com",
    });
  });

  test("edits local Ladybug file connections without requiring an HTTP URL", async () => {
    const user = userEvent.setup();
    const store = getAppStore();
    const state = new DbState();
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
    state.applyTo(store);

    render(
      <TestProvider client={createQueryClient()} store={store}>
        <TooltipProvider>
          <CreateConnection
            existingConfig={toConfigurationContext(state.activeConfig)}
            onClose={vi.fn()}
          />
        </TooltipProvider>
      </TestProvider>,
    );

    const localFileDetails = screen.getByText("File: air-routes.lbug");
    const localFileSummary = localFileDetails.parentElement;
    expect(localFileSummary).not.toBeNull();
    expect(
      within(localFileSummary as HTMLElement).getByText("Ladybug local file"),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Public or Proxy Endpoint"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Update Connection" }));

    expect(
      store.get(configurationAtom).get(state.activeConfig.id)?.connection,
    ).toMatchObject({
      backend: "ladybug-wasm-local-file",
      queryEngine: "openCypher",
      url: "",
      ladybug: {
        runtimeId: "runtime-1",
        fileName: "air-routes.lbug",
        fileSize: 1234,
      },
    });
  });

  test("clears cached schema and graph session when remote Ladybug database changes", async () => {
    const user = userEvent.setup();
    const store = getAppStore();
    const state = new DbState();
    state.activeConfig.connection = {
      backend: "ladybug-remote",
      queryEngine: "openCypher",
      url: "/ladybug/air-routes",
      ladybug: { databaseName: "air-routes" },
    } as typeof state.activeConfig.connection;
    state.applyTo(store);
    store.set(
      schemaAtom,
      new Map([[state.activeConfig.id, { vertices: [], edges: [] }]]),
    );
    store.set(
      allGraphSessionsAtom,
      new Map([
        [state.activeConfig.id, { vertices: new Set(), edges: new Set() }],
      ]),
    );

    render(
      <TestProvider client={createQueryClient()} store={store}>
        <TooltipProvider>
          <CreateConnection
            existingConfig={toConfigurationContext(state.activeConfig)}
            onClose={vi.fn()}
          />
        </TooltipProvider>
      </TestProvider>,
    );

    await user.clear(screen.getByLabelText("Ladybug Database Name"));
    await user.type(screen.getByLabelText("Ladybug Database Name"), "movies");
    await user.click(screen.getByRole("button", { name: "Update Connection" }));

    expect(
      store.get(configurationAtom).get(state.activeConfig.id)?.connection,
    ).toMatchObject({
      backend: "ladybug-remote",
      url: "/ladybug/movies",
      ladybug: { databaseName: "movies" },
    });
    expect(store.get(schemaAtom).has(state.activeConfig.id)).toBe(false);
    expect(store.get(allGraphSessionsAtom).has(state.activeConfig.id)).toBe(
      false,
    );
  });

  test("clears cached schema and graph session when changing a remote database to Ladybug remote", async () => {
    const user = userEvent.setup();
    const store = getAppStore();
    const state = new DbState();
    state.activeConfig.connection = {
      backend: "remote",
      queryEngine: "gremlin",
      url: "https://example.com",
    } as typeof state.activeConfig.connection;
    state.applyTo(store);
    store.set(
      schemaAtom,
      new Map([[state.activeConfig.id, { vertices: [], edges: [] }]]),
    );
    store.set(
      allGraphSessionsAtom,
      new Map([
        [state.activeConfig.id, { vertices: new Set(), edges: new Set() }],
      ]),
    );

    render(
      <TestProvider client={createQueryClient()} store={store}>
        <TooltipProvider>
          <CreateConnection
            existingConfig={toConfigurationContext(state.activeConfig)}
            onClose={vi.fn()}
          />
        </TooltipProvider>
      </TestProvider>,
    );

    await user.click(screen.getAllByRole("combobox")[0]);
    await user.keyboard("{ArrowDown}{Enter}");
    await user.type(
      screen.getByLabelText("Ladybug Database Name"),
      "air-routes",
    );
    await user.click(screen.getByRole("button", { name: "Update Connection" }));

    expect(
      store.get(configurationAtom).get(state.activeConfig.id)?.connection,
    ).toMatchObject({
      backend: "ladybug-remote",
      queryEngine: "openCypher",
      url: "/ladybug/air-routes",
      ladybug: { databaseName: "air-routes" },
    });
    expect(store.get(schemaAtom).has(state.activeConfig.id)).toBe(false);
    expect(store.get(allGraphSessionsAtom).has(state.activeConfig.id)).toBe(
      false,
    );
  });
});
