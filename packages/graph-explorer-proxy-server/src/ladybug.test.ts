type MockDatabaseHandle = {
  readonly id: number;
  readonly init: ReturnType<typeof vi.fn>;
  readonly close: ReturnType<typeof vi.fn>;
};

type MockConnectionHandle = {
  readonly id: number;
  readonly database: MockDatabaseHandle;
  readonly init: ReturnType<typeof vi.fn>;
  readonly setMaxNumThreadForExec: ReturnType<typeof vi.fn>;
  readonly query: ReturnType<typeof vi.fn>;
  readonly close: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  nativeModuleLoads: 0,
  databaseConstructorCalls: [] as unknown[][],
  connectionConstructorCalls: [] as unknown[][],
  databases: [] as MockDatabaseHandle[],
  connections: [] as MockConnectionHandle[],
  closeOrder: [] as string[],
  connectionInitError: undefined as Error | undefined,
  queryLadybugResultSets: vi.fn(),
}));

vi.mock("@ladybugdb/core", () => {
  mocks.nativeModuleLoads += 1;

  return {
    Database: class MockDatabase implements MockDatabaseHandle {
      readonly id = mocks.databases.length;
      readonly init = vi.fn();
      readonly close = vi.fn(() => {
        mocks.closeOrder.push(`database:${this.id}`);
      });

      constructor(...args: unknown[]) {
        mocks.databaseConstructorCalls.push(args);
        mocks.databases.push(this);
      }
    },
    Connection: class MockConnection implements MockConnectionHandle {
      readonly id = mocks.connections.length;
      readonly database: MockDatabaseHandle;

      readonly init = vi.fn(() => {
        if (mocks.connectionInitError != null) {
          throw mocks.connectionInitError;
        }
      });
      readonly setMaxNumThreadForExec = vi.fn();
      readonly query = vi.fn();
      readonly close = vi.fn(() => {
        mocks.closeOrder.push(`connection:${this.id}`);
      });

      constructor(database: MockDatabaseHandle, ...args: unknown[]) {
        this.database = database;
        mocks.connectionConstructorCalls.push([database, ...args]);
        mocks.connections.push(this);
      }
    },
  };
});

vi.mock("@graph-explorer/shared/ladybug", () => ({
  queryLadybugResultSets: mocks.queryLadybugResultSets,
}));

const { createLadybugProxyManager } = await import("./ladybug.ts");

describe("createLadybugProxyManager", () => {
  beforeEach(() => {
    mocks.nativeModuleLoads = 0;
    mocks.databaseConstructorCalls.length = 0;
    mocks.connectionConstructorCalls.length = 0;
    mocks.databases.length = 0;
    mocks.connections.length = 0;
    mocks.closeOrder.length = 0;
    mocks.connectionInitError = undefined;
    mocks.queryLadybugResultSets.mockReset();
  });

  it("does not load native handles when no Ladybug databases are configured", () => {
    const manager = createLadybugProxyManager({});

    expect(manager.isConfigured).toBe(false);
    expect(mocks.nativeModuleLoads).toBe(0);
    expect(mocks.databaseConstructorCalls).toHaveLength(0);
    expect(mocks.connectionConstructorCalls).toHaveLength(0);
  });

  it("opens a configured database with read-only native arguments and no zero-thread setter call", async () => {
    mocks.queryLadybugResultSets.mockResolvedValue({ results: [] });
    const manager = createLadybugProxyManager({
      analytics: "/data/analytics.lbug",
    });

    expect(mocks.databaseConstructorCalls).toHaveLength(0);
    expect(mocks.connectionConstructorCalls).toHaveLength(0);

    await manager.query("analytics", "MATCH (n) RETURN n");

    expect(mocks.databaseConstructorCalls).toStrictEqual([
      ["/data/analytics.lbug", 0, true, true],
    ]);
    expect(mocks.connectionConstructorCalls).toHaveLength(1);
    expect(mocks.connectionConstructorCalls[0]).toStrictEqual([
      mocks.databases[0],
      0,
    ]);
    expect(mocks.connections[0].setMaxNumThreadForExec).not.toHaveBeenCalled();
  });

  it("delegates queries to queryLadybugResultSets and returns its response", async () => {
    const response = { results: [{ name: "airport" }] };
    mocks.queryLadybugResultSets.mockResolvedValue(response);
    const manager = createLadybugProxyManager({ sample: "/data/sample.lbug" });

    await expect(manager.query("sample", "RETURN 1")).resolves.toBe(response);
    expect(mocks.queryLadybugResultSets).toHaveBeenCalledWith(
      mocks.connections[0],
      "RETURN 1",
    );
  });

  it("rejects unknown databases without constructing native handles", async () => {
    const manager = createLadybugProxyManager({ known: "/data/known.lbug" });

    await expect(manager.query("missing", "RETURN 1")).rejects.toThrow(
      "Unknown Ladybug database: missing",
    );
    expect(mocks.databaseConstructorCalls).toHaveLength(0);
    expect(mocks.connectionConstructorCalls).toHaveLength(0);
  });

  it("closes created native handles when opening fails", async () => {
    mocks.connectionInitError = new Error("init failed");
    const manager = createLadybugProxyManager({
      analytics: "/data/analytics.lbug",
    });

    await expect(manager.query("analytics", "RETURN 1")).rejects.toThrow(
      'Failed to open Ladybug database "analytics" at "/data/analytics.lbug": init failed',
    );
    expect(mocks.connections[0].close).toHaveBeenCalledTimes(1);
    expect(mocks.databases[0].close).toHaveBeenCalledTimes(1);
    expect(mocks.closeOrder).toStrictEqual(["connection:0", "database:0"]);
  });

  it("closes cached handles in order and reopens after closeAll", async () => {
    mocks.queryLadybugResultSets.mockResolvedValue({ results: [] });
    const manager = createLadybugProxyManager({
      analytics: "/data/analytics.lbug",
    });

    await manager.query("analytics", "RETURN 1");
    await manager.closeAll();
    await manager.query("analytics", "RETURN 2");

    expect(mocks.closeOrder).toStrictEqual(["connection:0", "database:0"]);
    expect(mocks.databaseConstructorCalls).toHaveLength(2);
    expect(mocks.connectionConstructorCalls).toHaveLength(2);
    expect(mocks.queryLadybugResultSets).toHaveBeenNthCalledWith(
      2,
      mocks.connections[1],
      "RETURN 2",
    );
  });
});
