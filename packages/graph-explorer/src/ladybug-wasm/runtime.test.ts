import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ladybugMock = vi.hoisted(() => {
  const state = {
    databaseArgs: [] as unknown[][],
    connectionArgs: [] as unknown[][],
  };
  const databaseInit = vi.fn();
  const databaseClose = vi.fn();
  const connectionInit = vi.fn();
  const connectionClose = vi.fn();
  const connectionQuery = vi.fn();
  const setMaxNumThreadForExec = vi.fn();
  const setWorkerPath = vi.fn();

  const FS = {
    mountOpfs: vi.fn(),
  };
  return {
    state,
    moduleInit: vi.fn(() => Promise.resolve(undefined)),
    setWorkerPath,
    mountOpfs: FS.mountOpfs,
    FS,
    databaseInit,
    databaseClose,
    connectionInit,
    connectionClose,
    connectionQuery,
    setMaxNumThreadForExec,
    Database: vi.fn(function (
      this: Record<string, unknown>,
      ...args: unknown[]
    ) {
      state.databaseArgs.push(args);
      this.close = databaseClose;
      this.init = databaseInit;
    }),
    Connection: vi.fn(function (
      this: Record<string, unknown>,
      ...args: unknown[]
    ) {
      state.connectionArgs.push(args);
      this.close = connectionClose;
      this.init = connectionInit;
      this.query = connectionQuery;
      this.setMaxNumThreadForExec = setMaxNumThreadForExec;
    }),
  };
});

const syncImport = vi.hoisted(() => vi.fn());
const rootAsyncImport = vi.hoisted(() => vi.fn());
const multithreadedImport = vi.hoisted(() => vi.fn());

vi.mock("@ladybugdb/wasm-core/sync", () => {
  syncImport();
  throw new Error("Ladybug WASM runtime must not import sync Ladybug");
});

vi.mock("@ladybugdb/wasm-core", () => {
  rootAsyncImport();
  throw new Error("Ladybug WASM runtime must not import root async Ladybug");
});

vi.mock("@ladybugdb/wasm-core/multithreaded", () => {
  multithreadedImport();
  return {
    default: {
      init: ladybugMock.moduleInit,
      setWorkerPath: ladybugMock.setWorkerPath,
      FS: ladybugMock.FS,
      Database: ladybugMock.Database,
      Connection: ladybugMock.Connection,
    },
  };
});

import {
  deleteLadybugWasmDatabase,
  openLadybugWasmRuntime as openLadybugWasmClientRuntime,
  stageLadybugWasmDatabase,
} from "./client";
import {
  openLadybugWasmRuntime,
  resetLadybugWasmRuntimeForTests,
} from "./runtime";

function stubWindowOpfs(order: string[]) {
  const truncate = vi.fn(() => {
    order.push("truncate");
    return Promise.resolve(undefined);
  });
  const write = vi.fn((bytes: Uint8Array) => {
    order.push("write");
    return bytes.byteLength;
  });
  const flush = vi.fn(() => {
    order.push("flush");
    return Promise.resolve(undefined);
  });
  const close = vi.fn(() => {
    order.push("access-close");
    return Promise.resolve(undefined);
  });
  const removeEntry = vi.fn(() => {
    order.push("remove");
    return Promise.resolve(undefined);
  });
  const createSyncAccessHandle = vi.fn(() =>
    Promise.resolve({
      truncate,
      write,
      flush,
      close,
    }),
  );
  const getFileHandle = vi.fn(() =>
    Promise.resolve({
      createSyncAccessHandle,
    }),
  );
  const getDirectory = vi.fn(() =>
    Promise.resolve({
      getFileHandle,
      removeEntry,
    }),
  );

  vi.stubGlobal("navigator", {
    serviceWorker: {},
    storage: { getDirectory },
  });

  return {
    close,
    createSyncAccessHandle,
    flush,
    getDirectory,
    getFileHandle,
    removeEntry,
    truncate,
    write,
  };
}

describe("Ladybug WASM runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ladybugMock.state.databaseArgs.length = 0;
    ladybugMock.state.connectionArgs.length = 0;
    ladybugMock.Database.mockImplementation(function (
      this: Record<string, unknown>,
      ...args: unknown[]
    ) {
      ladybugMock.state.databaseArgs.push(args);
      this.close = ladybugMock.databaseClose;
      this.init = ladybugMock.databaseInit;
    });
    ladybugMock.Connection.mockImplementation(function (
      this: Record<string, unknown>,
      ...args: unknown[]
    ) {
      ladybugMock.state.connectionArgs.push(args);
      this.close = ladybugMock.connectionClose;
      this.init = ladybugMock.connectionInit;
      this.query = ladybugMock.connectionQuery;
      this.setMaxNumThreadForExec = ladybugMock.setMaxNumThreadForExec;
    });
    ladybugMock.databaseInit.mockReturnValue(undefined);
    ladybugMock.databaseClose.mockReturnValue(undefined);
    ladybugMock.connectionInit.mockReturnValue(undefined);
    ladybugMock.connectionClose.mockReturnValue(undefined);
    ladybugMock.mountOpfs.mockReturnValue(undefined);
    ladybugMock.FS.mountOpfs = ladybugMock.mountOpfs;
    ladybugMock.setWorkerPath.mockReturnValue(undefined);
    ladybugMock.moduleInit.mockResolvedValue(undefined);
    ladybugMock.setMaxNumThreadForExec.mockReturnValue(undefined);
    resetLadybugWasmRuntimeForTests();
  });

  afterEach(() => {
    resetLadybugWasmRuntimeForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("closes only the in-context runtime before staging a database file", async () => {
    const order: string[] = [];
    const opfs = stubWindowOpfs(order);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    ladybugMock.connectionClose.mockImplementation(() => {
      order.push("connection-close");
      return Promise.resolve(undefined);
    });
    ladybugMock.databaseClose.mockImplementation(() => {
      order.push("database-close");
      return Promise.resolve(undefined);
    });

    await openLadybugWasmClientRuntime("tenant/db");
    const path = await stageLadybugWasmDatabase(
      "tenant/db",
      new Uint8Array([1, 2, 3]),
    );

    expect(path).toBe("/graph-explorer-ladybug/tenant%2Fdb.lbug");
    expect(fetch).not.toHaveBeenCalled();
    expect(opfs.getFileHandle).toHaveBeenCalledWith("tenant%2Fdb.lbug", {
      create: true,
    });
    expect(order).toStrictEqual([
      "connection-close",
      "database-close",
      "truncate",
      "write",
      "truncate",
      "flush",
      "access-close",
    ]);
  });

  it("closes only the in-context runtime before deleting a database file", async () => {
    const order: string[] = [];
    const opfs = stubWindowOpfs(order);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    ladybugMock.connectionClose.mockImplementation(() => {
      order.push("connection-close");
      return Promise.resolve(undefined);
    });
    ladybugMock.databaseClose.mockImplementation(() => {
      order.push("database-close");
      return Promise.resolve(undefined);
    });

    await openLadybugWasmClientRuntime("tenant/db");

    await expect(deleteLadybugWasmDatabase("tenant/db")).resolves.toBe(true);

    expect(fetch).not.toHaveBeenCalled();
    expect(opfs.removeEntry).toHaveBeenCalledWith("tenant%2Fdb.lbug");
    expect(order).toStrictEqual([
      "connection-close",
      "database-close",
      "remove",
    ]);
  });

  it("keeps a failed-close runtime cached so later delete retries close before OPFS mutation", async () => {
    const order: string[] = [];
    const opfs = stubWindowOpfs(order);
    const closeError = new Error("cannot close");

    ladybugMock.connectionClose
      .mockImplementationOnce(() => {
        order.push("connection-close");
        return Promise.reject(closeError);
      })
      .mockImplementation(() => {
        order.push("connection-close-retry");
        return Promise.resolve(undefined);
      });
    ladybugMock.databaseClose.mockImplementation(() => {
      order.push("database-close");
      return Promise.resolve(undefined);
    });

    await openLadybugWasmClientRuntime("tenant/retry");

    await expect(
      stageLadybugWasmDatabase("tenant/retry", new Uint8Array([1, 2, 3])),
    ).rejects.toThrow("cannot close");

    expect(opfs.getFileHandle).not.toHaveBeenCalled();
    expect(opfs.removeEntry).not.toHaveBeenCalled();
    expect(order).toStrictEqual(["connection-close", "database-close"]);

    await expect(deleteLadybugWasmDatabase("tenant/retry")).resolves.toBe(true);

    expect(opfs.removeEntry).toHaveBeenCalledWith("tenant%2Fretry.lbug");
    expect(order).toStrictEqual([
      "connection-close",
      "database-close",
      "connection-close-retry",
      "database-close",
      "remove",
    ]);
  });

  it("initializes the statically imported multithreaded Ladybug module lazily and only once", async () => {
    expect(ladybugMock.moduleInit).not.toHaveBeenCalled();

    const firstRuntime = await openLadybugWasmRuntime("first");
    const secondRuntime = await openLadybugWasmRuntime("second");

    expect(ladybugMock.setWorkerPath).toHaveBeenCalledOnce();
    expect(ladybugMock.setWorkerPath).toHaveBeenCalledWith(
      "/lbug_wasm_worker.js",
    );
    expect(ladybugMock.setWorkerPath.mock.invocationCallOrder[0]).toBeLessThan(
      ladybugMock.moduleInit.mock.invocationCallOrder[0],
    );
    expect(ladybugMock.moduleInit).toHaveBeenCalledOnce();
    expect(syncImport).not.toHaveBeenCalled();
    expect(rootAsyncImport).not.toHaveBeenCalled();
    expect(ladybugMock.mountOpfs).toHaveBeenCalledOnce();

    await firstRuntime.close();
    await secondRuntime.close();
  });

  it("opens the staged database read-only and closes connection before database", async () => {
    const runtime = await openLadybugWasmRuntime("tenant/db");

    expect(syncImport).not.toHaveBeenCalled();
    expect(rootAsyncImport).not.toHaveBeenCalled();
    expect(ladybugMock.mountOpfs).toHaveBeenCalledWith(
      "/graph-explorer-ladybug",
    );
    expect(ladybugMock.state.databaseArgs[0]).toStrictEqual([
      "/graph-explorer-ladybug/tenant%2Fdb.lbug",
      0,
      0,
      true,
      true,
    ]);
    expect(ladybugMock.state.connectionArgs[0]?.[1]).toBe(0);
    expect(ladybugMock.setMaxNumThreadForExec).toHaveBeenCalledWith(0);
    expect(ladybugMock.databaseInit).toHaveBeenCalledOnce();
    expect(ladybugMock.connectionInit).toHaveBeenCalledOnce();

    await runtime.close();

    expect(ladybugMock.connectionClose).toHaveBeenCalledOnce();
    expect(ladybugMock.databaseClose).toHaveBeenCalledOnce();
    expect(
      ladybugMock.connectionClose.mock.invocationCallOrder[0],
    ).toBeLessThan(ladybugMock.databaseClose.mock.invocationCallOrder[0]);
  });

  it("fails clearly when the multithreaded Ladybug module cannot mount OPFS", async () => {
    ladybugMock.FS.mountOpfs = undefined as never;

    await expect(openLadybugWasmRuntime("runtime")).rejects.toThrow(
      "does not expose an OPFS mount API",
    );

    expect(ladybugMock.Database).not.toHaveBeenCalled();
  });

  it("queries through the shared Ladybug Neptune adapter and lets it close results", async () => {
    const resultClose = vi.fn();
    ladybugMock.connectionQuery.mockReturnValue({
      close: resultClose,
      getAllRows: vi.fn(() => [[42]]),
      getColumnNames: vi.fn(() => ["answer"]),
      isSuccess: vi.fn(() => true),
    });

    const runtime = await openLadybugWasmRuntime("runtime");
    await expect(runtime.query("RETURN 42 AS answer")).resolves.toStrictEqual({
      results: [{ answer: 42 }],
    });

    expect(ladybugMock.connectionQuery).toHaveBeenCalledWith(
      "RETURN 42 AS answer",
    );
    expect(resultClose).toHaveBeenCalledOnce();
    await runtime.close();
  });

  it("passes adapter options through to shared Ladybug Neptune adaptation", async () => {
    ladybugMock.connectionQuery.mockReturnValue({
      close: vi.fn(),
      getAllRows: vi.fn(() => [
        [{ _label: "Airport", code: "ANC", city: "Anchorage" }],
      ]),
      getColumnNames: vi.fn(() => ["airport"]),
      isSuccess: vi.fn(() => true),
    });

    const runtime = await openLadybugWasmRuntime("runtime");
    const response = await runtime.query("MATCH (a:Airport) RETURN a", {
      primaryKeys: { Airport: "code" },
    });

    expect(response.results[0]?.airport).toMatchObject({
      "~entityType": "node",
      "~labels": ["Airport"],
      "~properties": {
        city: "Anchorage",
        code: "ANC",
      },
    });
    await runtime.close();
  });

  it("closes the database when read-only open fails", async () => {
    const openError = new Error("cannot open");
    ladybugMock.Database.mockImplementationOnce(function (
      this: Record<string, unknown>,
      ...args: unknown[]
    ) {
      ladybugMock.state.databaseArgs.push(args);
      this.init = ladybugMock.databaseInit;
      this.close = ladybugMock.databaseClose;
    });
    ladybugMock.databaseInit.mockImplementation(() => {
      throw openError;
    });

    await expect(openLadybugWasmRuntime("runtime")).rejects.toThrow(
      "could not be opened read-only",
    );

    expect(ladybugMock.databaseClose).toHaveBeenCalledOnce();
    expect(ladybugMock.Connection).not.toHaveBeenCalled();
  });

  it("closes connection and database when connection initialization fails", async () => {
    ladybugMock.Connection.mockImplementationOnce(function (
      this: Record<string, unknown>,
      ...args: unknown[]
    ) {
      ladybugMock.state.connectionArgs.push(args);
      this.init = ladybugMock.connectionInit;
      this.close = ladybugMock.connectionClose;
      this.query = ladybugMock.connectionQuery;
      this.setMaxNumThreadForExec = ladybugMock.setMaxNumThreadForExec;
    });
    ladybugMock.connectionInit.mockImplementation(() => {
      throw new Error("bad connection");
    });

    await expect(openLadybugWasmRuntime("runtime")).rejects.toThrow(
      "bad connection",
    );

    expect(ladybugMock.connectionClose).toHaveBeenCalledOnce();
    expect(ladybugMock.databaseClose).toHaveBeenCalledOnce();
    expect(
      ladybugMock.connectionClose.mock.invocationCallOrder[0],
    ).toBeLessThan(ladybugMock.databaseClose.mock.invocationCallOrder[0]);
  });
});
