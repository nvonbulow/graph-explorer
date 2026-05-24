import {
  queryLadybugResultSets,
  type LadybugNeptuneAdapterOptions,
  type LadybugQueryResult,
  type NeptuneOpenCypherResponse,
} from "@graph-explorer/shared/ladybug";
import * as importedLadybugModule from "@ladybugdb/wasm-core/multithreaded";

import { getLadybugWasmDatabasePath, LADYBUG_OPFS_MOUNT_POINT } from "./opfs";

const LADYBUG_WASM_BUFFER_POOL_SIZE = 0;
const LADYBUG_WASM_MAX_NUM_THREADS = 0;
const LADYBUG_WASM_ENABLE_COMPRESSION = true;
const LADYBUG_WASM_READ_ONLY = true;

export type LadybugWasmRuntime = {
  query(
    statement: string,
    options?: LadybugNeptuneAdapterOptions,
  ): Promise<NeptuneOpenCypherResponse>;
  close(): Promise<void>;
};

type Awaitable<T> = T | Promise<T>;

type LadybugDatabase = {
  init?: () => Awaitable<void>;
  close: () => Awaitable<void>;
};

type LadybugConnection = {
  init?: () => Awaitable<void>;
  setMaxNumThreadForExec?: (numThreads: number) => Awaitable<void>;
  query(
    statement: string,
  ): Awaitable<LadybugQueryResult | readonly LadybugQueryResult[]>;
  close: () => Awaitable<void>;
};

type LadybugDatabaseConstructor = new (
  databasePath?: string,
  bufferPoolSize?: number,
  maxNumThreads?: number,
  enableCompression?: boolean,
  readOnly?: boolean,
) => LadybugDatabase;

type LadybugConnectionConstructor = new (
  database: LadybugDatabase,
  numThreads?: number,
) => LadybugConnection;

type LadybugFileSystem = {
  mountOpfs?: (path: string) => Awaitable<void>;
};

type LadybugFileSystemWithMountOpfs = LadybugFileSystem & {
  mountOpfs: (path: string) => Awaitable<void>;
};

type LadybugModule = {
  init(): Promise<void>;
  setWorkerPath(workerPath: string): void;
  FS?: LadybugFileSystem;
  Database: LadybugDatabaseConstructor;
  Connection: LadybugConnectionConstructor;
};

let ladybugModulePromise: Promise<LadybugModule> | undefined;
const mountedOpfsPathPromises = new Map<string, Promise<void>>();

export async function openLadybugWasmRuntime(
  runtimeId: string,
): Promise<LadybugWasmRuntime> {
  const lbug = await loadLadybugModule();
  await ensureOpfsMounted(lbug);

  let database: LadybugDatabase | undefined;
  try {
    database = new lbug.Database(
      getLadybugWasmDatabasePath(runtimeId),
      LADYBUG_WASM_BUFFER_POOL_SIZE,
      LADYBUG_WASM_MAX_NUM_THREADS,
      LADYBUG_WASM_ENABLE_COMPRESSION,
      LADYBUG_WASM_READ_ONLY,
    );
    await database.init?.();
  } catch (error) {
    if (database) {
      try {
        await database.close();
      } catch {
        // Preserve the init failure; it identifies the selected database problem.
      }
    }
    throw new Error(
      `The staged Ladybug file could not be opened read-only. Reselect or reopen the Ladybug file and try again. Original error: ${getErrorMessage(error)}`,
      { cause: error },
    );
  }

  if (!database) {
    throw new Error("Ladybug database initialization failed without an error.");
  }

  let connection: LadybugConnection | undefined;
  try {
    connection = new lbug.Connection(database, LADYBUG_WASM_MAX_NUM_THREADS);
    await connection.init?.();
    await connection.setMaxNumThreadForExec?.(LADYBUG_WASM_MAX_NUM_THREADS);

    return new OpenLadybugWasmRuntime(connection, database);
  } catch (error) {
    if (connection) {
      try {
        await connection.close();
      } catch {
        // Preserve the open failure; it identifies the selected database problem.
      }
    }
    try {
      await database.close();
    } catch {
      // Preserve the open failure; it identifies the selected database problem.
    }
    throw error;
  }
}

export async function loadLadybugModule(): Promise<LadybugModule> {
  if (!ladybugModulePromise) {
    ladybugModulePromise = initLadybugModule();
  }

  return ladybugModulePromise;
}

async function initLadybugModule(): Promise<LadybugModule> {
  const lbugModule = importedLadybugModule as unknown as {
    default?: LadybugModule;
  } & LadybugModule;
  const lbug = lbugModule.default ?? lbugModule;
  lbug.setWorkerPath(getLadybugWorkerPath());
  await lbug.init();
  return lbug;
}

export async function ensureOpfsMounted(lbug: LadybugModule): Promise<void> {
  let mountPromise = mountedOpfsPathPromises.get(LADYBUG_OPFS_MOUNT_POINT);
  if (!mountPromise) {
    const mountOpfs = getLadybugOpfsMounter(lbug);
    if (mountOpfs == null) {
      throw new Error(
        "Ladybug requires OPFS support, but this Ladybug WASM build does not expose an OPFS mount API.",
      );
    }

    mountPromise = (async () => mountOpfs(LADYBUG_OPFS_MOUNT_POINT))().catch(
      (error: unknown) => {
        mountedOpfsPathPromises.delete(LADYBUG_OPFS_MOUNT_POINT);
        throw new Error(
          `Failed to mount OPFS at ${LADYBUG_OPFS_MOUNT_POINT}: ${getErrorMessage(error)}`,
          { cause: error },
        );
      },
    );
    mountedOpfsPathPromises.set(LADYBUG_OPFS_MOUNT_POINT, mountPromise);
  }

  await mountPromise;
}

export function isLadybugLocalFileSupported(): boolean {
  return true;
}

export function assertLadybugLocalFileSupported(): void {
  if (!isLadybugLocalFileSupported()) {
    throw new Error("Ladybug local files are not supported in this browser.");
  }
}

export function resetLadybugWasmRuntimeForTests(): void {
  ladybugModulePromise = undefined;
  mountedOpfsPathPromises.clear();
}

class OpenLadybugWasmRuntime implements LadybugWasmRuntime {
  #closed = false;

  private readonly connection: LadybugConnection;
  private readonly database: LadybugDatabase;

  constructor(connection: LadybugConnection, database: LadybugDatabase) {
    this.connection = connection;
    this.database = database;
  }

  async query(
    statement: string,
    options?: LadybugNeptuneAdapterOptions,
  ): Promise<NeptuneOpenCypherResponse> {
    if (this.#closed) {
      throw new Error("Ladybug WASM runtime is closed.");
    }

    return queryLadybugResultSets(this.connection, statement, options);
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    try {
      await this.connection.close();
    } finally {
      await this.database.close();
    }

    this.#closed = true;
  }
}

function hasLadybugOpfsMounter(
  value: unknown,
): value is LadybugFileSystemWithMountOpfs {
  return (
    typeof value === "object" &&
    value !== null &&
    "mountOpfs" in value &&
    typeof (value as { mountOpfs?: unknown }).mountOpfs === "function"
  );
}

function getLadybugOpfsMounter(
  lbug: LadybugModule,
): ((path: string) => Awaitable<void>) | undefined {
  const fs = lbug.FS;
  if (hasLadybugOpfsMounter(fs)) {
    return fs.mountOpfs.bind(fs);
  }

  return undefined;
}

function getLadybugWorkerPath(): string {
  const baseUrl = import.meta.env.BASE_URL ?? "/";
  return `${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}lbug_wasm_worker.js`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
