import type {
  LadybugColumn,
  LadybugQueryResult,
  LadybugRawResultSet,
  LadybugRow,
  LadybugValue,
} from "./types.ts";

export async function readLadybugColumnNames(
  resultSet: LadybugRawResultSet | LadybugQueryResult,
): Promise<string[]> {
  const propertyNames = readColumnNames(resultSet.columnNames);
  if (propertyNames.length > 0) {
    return propertyNames;
  }

  const propertyColumns = readColumnNamesFromColumns(resultSet.columns);
  if (propertyColumns.length > 0) {
    return propertyColumns;
  }

  const methodNames = readColumnNames(await readGetColumnNames(resultSet));
  if (methodNames.length > 0) {
    return methodNames;
  }

  return readColumnNamesFromColumns(await readGetColumns(resultSet));
}

export async function readLadybugRows(
  resultSet: LadybugRawResultSet | LadybugQueryResult,
): Promise<LadybugRow[] | undefined> {
  if (resultSet.rows !== undefined) {
    return collectIterable(resultSet.rows);
  }

  if ("getAllRows" in resultSet && resultSet.getAllRows != null) {
    return collectIterable(await resultSet.getAllRows());
  }

  if ("getAll" in resultSet && resultSet.getAll != null) {
    return collectIterable(await resultSet.getAll());
  }

  return undefined;
}

export async function readLadybugObjects(
  resultSet: LadybugRawResultSet | LadybugQueryResult,
): Promise<LadybugValue[]> {
  const propertyObjects = await collectIterable(resultSet.objects);
  if (propertyObjects.length > 0) {
    return propertyObjects;
  }

  return collectIterable(await readGetAllObjects(resultSet));
}

export async function readLadybugColumnTypes(
  resultSet: LadybugRawResultSet | LadybugQueryResult,
): Promise<string[]> {
  return readNonEmptyStrings(
    resultSet.columnTypes ?? (await readGetColumnTypes(resultSet)),
  );
}

export async function readLadybugSummary(
  resultSet: LadybugRawResultSet | LadybugQueryResult,
): Promise<unknown> {
  return resultSet.summary ?? (await readGetQuerySummary(resultSet));
}

function readColumnNames(value: readonly unknown[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(readColumnName);
}

function readColumnNamesFromColumns(
  columns: readonly unknown[] | undefined,
): string[] {
  if (!Array.isArray(columns)) {
    return [];
  }

  const names: string[] = [];
  for (const column of columns) {
    if (typeof column === "string") {
      names.push(column.length > 0 ? column : "");
      continue;
    }

    if (column != null && typeof column === "object" && "name" in column) {
      names.push(readColumnName(column.name));
      continue;
    }

    names.push("");
  }
  return names;
}

async function readGetColumnNames(
  resultSet: LadybugRawResultSet | LadybugQueryResult,
): Promise<readonly string[] | undefined> {
  return "getColumnNames" in resultSet
    ? resultSet.getColumnNames?.()
    : undefined;
}

async function readGetColumns(
  resultSet: LadybugRawResultSet | LadybugQueryResult,
): Promise<readonly (LadybugColumn | string)[] | undefined> {
  return "getColumns" in resultSet ? resultSet.getColumns?.() : undefined;
}

async function readGetAllObjects(
  resultSet: LadybugRawResultSet | LadybugQueryResult,
): Promise<
  | readonly LadybugValue[]
  | Iterable<LadybugValue>
  | AsyncIterable<LadybugValue>
  | undefined
> {
  return "getAllObjects" in resultSet ? resultSet.getAllObjects?.() : undefined;
}

async function readGetColumnTypes(
  resultSet: LadybugRawResultSet | LadybugQueryResult,
): Promise<readonly string[] | undefined> {
  return "getColumnTypes" in resultSet
    ? resultSet.getColumnTypes?.()
    : undefined;
}

async function readGetQuerySummary(
  resultSet: LadybugRawResultSet | LadybugQueryResult,
): Promise<unknown> {
  return await ("getQuerySummary" in resultSet
    ? resultSet.getQuerySummary?.()
    : undefined);
}

async function collectIterable<T>(
  value: readonly T[] | Iterable<T> | AsyncIterable<T> | undefined,
): Promise<T[]> {
  if (value == null) {
    return [];
  }

  if (Array.isArray(value)) {
    return [...value];
  }

  const asyncIterable = value as AsyncIterable<T>;
  if (typeof asyncIterable[Symbol.asyncIterator] === "function") {
    const items: T[] = [];
    for await (const item of asyncIterable) {
      items.push(item);
    }
    return items;
  }

  const iterable = value as Iterable<T>;
  if (typeof iterable[Symbol.iterator] === "function") {
    return [...iterable];
  }

  return [];
}

function readColumnName(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "";
}

function readNonEmptyStrings(value: readonly unknown[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isNonEmptyString);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
