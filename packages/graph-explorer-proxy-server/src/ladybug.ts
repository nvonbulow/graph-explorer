import {
  queryLadybugResultSets,
  type LadybugQueryResult,
  type NeptuneOpenCypherResponse,
} from "@graph-explorer/shared/ladybug";

export type LadybugDatabaseConfig = Readonly<Record<string, string>>;

export type LadybugProxyManager = {
  readonly isConfigured: boolean;
  hasDatabase(databaseName: string): boolean;
  query(
    databaseName: string,
    statement: string,
  ): Promise<NeptuneOpenCypherResponse>;
  closeAll(): Promise<void>;
};

type Awaitable<T> = T | Promise<T>;

type LadybugDatabaseHandle = {
  init?: () => Awaitable<void>;
  close: () => Awaitable<void>;
};

type LadybugConnectionHandle = {
  init?: () => Awaitable<void>;
  setMaxNumThreadForExec?: (numThreads: number) => Awaitable<void>;
  query(
    statement: string,
  ): Awaitable<
    LadybugQueryResult | readonly LadybugQueryResult[] | null | undefined
  >;
  close: () => Awaitable<void>;
};

type LadybugDatabaseConstructor = new (
  databasePath: string,
  bufferPoolSize: number,
  enableCompression: boolean,
  readOnly: boolean,
) => LadybugDatabaseHandle;

type LadybugConnectionConstructor = new (
  database: LadybugDatabaseHandle,
  numThreads: number,
) => LadybugConnectionHandle;

type OpenLadybugDatabase = {
  readonly database: LadybugDatabaseHandle;
  readonly connection: LadybugConnectionHandle;
};

type LadybugNativeModule = {
  readonly Database: LadybugDatabaseConstructor;
  readonly Connection: LadybugConnectionConstructor;
};

const LADYBUG_BUFFER_POOL_SIZE = 0;
const LADYBUG_MAX_NUM_THREADS = 0;
const LADYBUG_ENABLE_COMPRESSION = true;
const LADYBUG_READ_ONLY = true;

let ladybugNativeModulePromise: Promise<LadybugNativeModule> | undefined;

export function createLadybugProxyManager(
  databases: LadybugDatabaseConfig,
): LadybugProxyManager {
  return new NativeLadybugProxyManager(databases);
}

class NativeLadybugProxyManager implements LadybugProxyManager {
  readonly isConfigured: boolean;

  readonly #databases: LadybugDatabaseConfig;
  readonly #openDatabases = new Map<string, Promise<OpenLadybugDatabase>>();

  constructor(databases: LadybugDatabaseConfig) {
    this.#databases = { ...databases };
    this.isConfigured = Object.keys(this.#databases).length > 0;
  }

  hasDatabase(databaseName: string): boolean {
    return Object.hasOwn(this.#databases, databaseName);
  }

  async query(
    databaseName: string,
    statement: string,
  ): Promise<NeptuneOpenCypherResponse> {
    const openDatabase = await this.#getOpenDatabase(databaseName);
    return queryLadybugResultSets(openDatabase.connection, statement);
  }

  async closeAll(): Promise<void> {
    const openDatabases = [...this.#openDatabases.values()];
    this.#openDatabases.clear();

    const closeErrors: unknown[] = [];
    for (const openDatabasePromise of openDatabases) {
      try {
        const openDatabase = await openDatabasePromise;
        await closeOpenLadybugDatabase(openDatabase);
      } catch (error) {
        closeErrors.push(error);
      }
    }

    if (closeErrors.length > 0) {
      throw new AggregateError(
        closeErrors,
        "Failed to close one or more Ladybug databases.",
      );
    }
  }

  #getOpenDatabase(databaseName: string): Promise<OpenLadybugDatabase> {
    const existingOpenDatabase = this.#openDatabases.get(databaseName);
    if (existingOpenDatabase != null) {
      return existingOpenDatabase;
    }

    const databasePath = this.#readConfiguredDatabasePath(databaseName);
    const openDatabasePromise = openConfiguredLadybugDatabase(
      databaseName,
      databasePath,
    ).catch((error: unknown) => {
      this.#openDatabases.delete(databaseName);
      throw error;
    });
    this.#openDatabases.set(databaseName, openDatabasePromise);
    return openDatabasePromise;
  }

  #readConfiguredDatabasePath(databaseName: string): string {
    if (!this.hasDatabase(databaseName)) {
      throw new Error(`Unknown Ladybug database: ${databaseName}`);
    }

    const databasePath = this.#databases[databaseName];
    if (databasePath == null || databasePath.length === 0) {
      throw new Error(
        `Ladybug database "${databaseName}" has no configured path.`,
      );
    }

    return databasePath;
  }
}

function loadLadybugNativeModule(): Promise<LadybugNativeModule> {
  ladybugNativeModulePromise ??= import("@ladybugdb/core")
    .then(nativeModule => ({
      Database: nativeModule.Database as unknown as LadybugDatabaseConstructor,
      Connection:
        nativeModule.Connection as unknown as LadybugConnectionConstructor,
    }))
    .catch((error: unknown) => {
      throw new Error(
        `The native Ladybug package could not be loaded: ${getErrorMessage(error)}`,
        { cause: error },
      );
    });

  return ladybugNativeModulePromise;
}

async function openConfiguredLadybugDatabase(
  databaseName: string,
  databasePath: string,
): Promise<OpenLadybugDatabase> {
  let database: LadybugDatabaseHandle | undefined;
  let connection: LadybugConnectionHandle | undefined;

  try {
    const { Database, Connection } = await loadLadybugNativeModule();

    database = new Database(
      databasePath,
      LADYBUG_BUFFER_POOL_SIZE,
      LADYBUG_ENABLE_COMPRESSION,
      LADYBUG_READ_ONLY,
    );
    await database.init?.();

    connection = new Connection(database, LADYBUG_MAX_NUM_THREADS);
    await connection.init?.();
    if (LADYBUG_MAX_NUM_THREADS > 0) {
      await connection.setMaxNumThreadForExec?.(LADYBUG_MAX_NUM_THREADS);
    }

    return { database, connection };
  } catch (error) {
    await closeCreatedLadybugHandles(connection, database);
    throw new Error(
      `Failed to open Ladybug database "${databaseName}" at "${databasePath}": ${getErrorMessage(error)}`,
      { cause: error },
    );
  }
}

async function closeOpenLadybugDatabase(
  openDatabase: OpenLadybugDatabase,
): Promise<void> {
  const closeErrors: unknown[] = [];

  try {
    await openDatabase.connection.close();
  } catch (error) {
    closeErrors.push(error);
  }

  try {
    await openDatabase.database.close();
  } catch (error) {
    closeErrors.push(error);
  }

  if (closeErrors.length > 0) {
    throw new AggregateError(closeErrors, "Failed to close Ladybug database.");
  }
}

async function closeCreatedLadybugHandles(
  connection: LadybugConnectionHandle | undefined,
  database: LadybugDatabaseHandle | undefined,
): Promise<void> {
  if (connection != null) {
    try {
      await connection.close();
    } catch {
      // Preserve the open failure; it identifies the configured database problem.
    }
  }

  if (database != null) {
    try {
      await database.close();
    } catch {
      // Preserve the open failure; it identifies the configured database problem.
    }
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
