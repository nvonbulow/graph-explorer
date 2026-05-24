import type {
  LadybugPrimaryKeyMap,
  NeptuneOpenCypherResponse,
} from "@graph-explorer/shared/ladybug";

import type { NormalizedConnection } from "@/core";

import type { OpenCypherFetchFactory } from "../connector/openCypher/dialect";

import { queryLadybugWasmRuntime } from "./client";

type LadybugLocalConnection = NormalizedConnection & {
  ladybug?: {
    runtimeId?: unknown;
  };
};

type TableInfoRecord = Record<string, unknown>;

const TABLE_INFO_QUERY_PATTERN =
  /^\s*CALL\s+table_info\s*\(\s*'((?:\\.|[^'\\])*)'\s*\)\s*(?:RETURN\s+\*)?\s*;?\s*$/iu;
const PRIMARY_KEY_NAME_FIELDS = [
  "name",
  "property",
  "column_name",
  "column name",
  "property name",
] as const;
const PRIMARY_KEY_INDICATOR_FIELDS = [
  "primary key",
  "primary_key",
  "is primary key",
  "is_primary_key",
  "pk",
  "is_pk",
  "key",
  "constraint",
  "extra",
] as const;

const primaryKeysByRuntimeId = new Map<string, Record<string, string>>();

function getPrimaryKeysForRuntime(runtimeId: string): Record<string, string> {
  const primaryKeys = primaryKeysByRuntimeId.get(runtimeId);
  if (primaryKeys !== undefined) {
    return primaryKeys;
  }

  const emptyPrimaryKeys: Record<string, string> = {};
  primaryKeysByRuntimeId.set(runtimeId, emptyPrimaryKeys);
  return emptyPrimaryKeys;
}

export const createLadybugWasmOpenCypherFetch: OpenCypherFetchFactory = (
  connection,
  _featureFlags,
  options,
) => {
  const signal = options?.signal ?? undefined;
  const runtimeId = getLadybugRuntimeId(connection);
  const primaryKeys = getPrimaryKeysForRuntime(runtimeId);

  return async <TResult = any>(queryTemplate: string): Promise<TResult> => {
    throwIfAborted(signal);

    const tableInfoTableName = readTableInfoTableName(queryTemplate);
    const responsePromise =
      tableInfoTableName == null
        ? queryLadybugWasmRuntime(runtimeId, queryTemplate, {
            primaryKeys: snapshotPrimaryKeys(primaryKeys),
          })
        : queryLadybugWasmRuntime(runtimeId, queryTemplate);
    const response =
      signal === undefined
        ? await responsePromise
        : await runWithAbort(signal, responsePromise);

    if (tableInfoTableName != null) {
      recordTablePrimaryKey(primaryKeys, tableInfoTableName, response);
    }

    return response as TResult;
  };
};

function getLadybugRuntimeId(connection: NormalizedConnection): string {
  if (connection.queryEngine !== "openCypher") {
    throw new Error(
      "Ladybug WASM local files require an openCypher connection.",
    );
  }

  const runtimeId = (connection as LadybugLocalConnection).ladybug?.runtimeId;
  if (typeof runtimeId !== "string" || runtimeId.length === 0) {
    throw new Error(
      "Ladybug WASM local openCypher connection is missing ladybug.runtimeId.",
    );
  }

  return runtimeId;
}

function snapshotPrimaryKeys(
  primaryKeys: Record<string, string>,
): LadybugPrimaryKeyMap {
  return { ...primaryKeys };
}

function readTableInfoTableName(query: string): string | undefined {
  const match = TABLE_INFO_QUERY_PATTERN.exec(query);
  return match == null ? undefined : unescapeLadybugString(match[1]);
}

function unescapeLadybugString(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "\\" && index + 1 < value.length) {
      index += 1;
      result += value[index];
    } else {
      result += char;
    }
  }
  return result;
}

function recordTablePrimaryKey(
  primaryKeys: Record<string, string>,
  tableName: string,
  response: NeptuneOpenCypherResponse,
): void {
  const primaryKey = readTablePrimaryKey(response.results);
  if (primaryKey != null) {
    primaryKeys[tableName] = primaryKey;
  }
}

function readTablePrimaryKey(rows: readonly unknown[]): string | undefined {
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const record = unwrapSingletonRecord(row, PRIMARY_KEY_NAME_FIELDS);
    const name = readString(record, PRIMARY_KEY_NAME_FIELDS);
    if (
      name != null &&
      name.length > 0 &&
      PRIMARY_KEY_INDICATOR_FIELDS.some(field =>
        isPrimaryKeyIndicator(record, field),
      )
    ) {
      return name;
    }
  }

  return undefined;
}

function unwrapSingletonRecord(
  row: TableInfoRecord,
  fields: readonly string[],
): TableInfoRecord {
  if (fields.some(field => readField(row, field) != null)) {
    return row;
  }

  const values = Object.values(row);
  const value = values[0];
  return values.length === 1 && isRecord(value) ? value : row;
}

function readString(
  record: TableInfoRecord,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const value = readField(record, name);
    if (value != null) {
      return stringifyValue(value);
    }
  }

  return undefined;
}

function readField(record: TableInfoRecord, name: string): unknown {
  if (Object.hasOwn(record, name)) {
    return record[name];
  }

  const lowerName = name.toLowerCase();
  for (const [fieldName, value] of Object.entries(record)) {
    if (fieldName.toLowerCase() === lowerName) {
      return value;
    }
  }

  return undefined;
}

function isPrimaryKeyIndicator(record: TableInfoRecord, name: string): boolean {
  const value = readField(record, name);
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && value !== 0;
  }
  if (typeof value === "bigint") {
    return value !== 0n;
  }
  if (typeof value !== "string") {
    return false;
  }

  return /(?:\bPRIMARY(?:\s+KEY)?\b|\bPK\b|\bPRI\b|\bTRUE\b|\bYES\b|\bY\b|^1$)/i.test(
    value.trim(),
  );
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value.toString();
  }
  if (value == null) {
    return value === null ? "null" : "undefined";
  }
  if (value instanceof Date) {
    return value.toString();
  }
  if (
    value instanceof String ||
    value instanceof Number ||
    value instanceof Boolean
  ) {
    return value.valueOf().toString();
  }

  try {
    const json = JSON.stringify(value);
    if (json != null) {
      return json;
    }
  } catch {
    return "[Unserializable Ladybug value]";
  }

  return "[Unserializable Ladybug value]";
}

function isRecord(value: unknown): value is TableInfoRecord {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw toError(createAbortError(signal));
  }
}

function runWithAbort<TResult>(
  signal: AbortSignal,
  operation: Promise<TResult>,
): Promise<TResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(toError(createAbortError(signal)));
      return;
    }

    const onAbort = () => {
      reject(toError(createAbortError(signal)));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

function createAbortError(signal: AbortSignal): unknown {
  return (
    signal.reason ??
    new DOMException("The operation was aborted.", "AbortError")
  );
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  if (value instanceof DOMException) {
    const error = new Error(value.message, { cause: value });
    error.name = value.name;
    return error;
  }

  if (typeof value === "string") {
    return new Error(value);
  }

  return new Error("The operation was aborted.", { cause: value });
}
