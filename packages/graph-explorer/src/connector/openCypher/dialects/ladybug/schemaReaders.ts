import type {
  LadybugRecord,
  LadybugValue,
} from "@graph-explorer/shared/ladybug";

import type { EdgeConnection, AttributeConfig } from "@/core";

import { createEdgeConnection } from "@/core";

export type LadybugTableKind = "node" | "edge";

export type LadybugTable = {
  name: string;
  kind: LadybugTableKind;
  count?: number;
};
export type LadybugPrimaryKeyInfo = {
  name: string;
  type?: string;
  dataType?: string;
};

const TABLE_NAME_FIELDS = ["name", "table_name", "table name"] as const;
const TABLE_TYPE_FIELDS = ["type", "table_type", "table type"] as const;
const COUNT_FIELDS = [
  "count",
  "total",
  "rows",
  "row_count",
  "row count",
] as const;

const ATTRIBUTE_NAME_FIELDS = [
  "property",
  "column_name",
  "column name",
  "name",
  "property name",
] as const;
const ATTRIBUTE_TYPE_FIELDS = ["data_type", "data type", "type"] as const;

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

const SOURCE_FIELDS = [
  "src",
  "source",
  "source table name",
  "source_table_name",
  "from",
  "from table name",
] as const;
const TARGET_FIELDS = [
  "dst",
  "destination",
  "destination table name",
  "destination_table_name",
  "target",
  "target table name",
  "to",
  "to table name",
] as const;

export function parseShowTablesRows(
  rows: readonly LadybugRecord[],
): LadybugTable[] {
  return rows.flatMap((row, index) => {
    const table = parseShowTablesRow(row, index);
    return table == null ? [] : [table];
  });
}

export function parseShowTablesRow(
  row: LadybugRecord,
  index = 0,
): LadybugTable | undefined {
  const record = unwrapSingletonRecord(
    row,
    TABLE_NAME_FIELDS,
    TABLE_TYPE_FIELDS,
  );
  const type = readString(record, ...TABLE_TYPE_FIELDS)?.toUpperCase();
  if (type == null || type.length === 0) {
    throw new Error(
      `Malformed Ladybug show_tables row ${index}: missing table type`,
    );
  }

  const kind = readTableKind(type);
  if (kind == null) {
    return undefined;
  }

  const name = readString(record, ...TABLE_NAME_FIELDS);
  if (name == null || name.length === 0) {
    throw new Error(
      `Malformed Ladybug show_tables row ${index}: missing table name for ${type}`,
    );
  }

  const count = readNumber(record, ...COUNT_FIELDS);
  return { name, kind, ...(count != null && { count }) };
}

export function parseTableInfoRows(
  rows: readonly LadybugRecord[],
): AttributeConfig[] {
  return rows.map((row, index) => parseTableInfoRow(row, index));
}

export function parseTableInfoRow(
  row: LadybugRecord,
  index = 0,
): AttributeConfig {
  const record = unwrapSingletonRecord(row, ATTRIBUTE_NAME_FIELDS);
  const name = readString(record, ...ATTRIBUTE_NAME_FIELDS);
  if (name == null || name.length === 0) {
    throw new Error(
      `Malformed Ladybug table_info row ${index}: missing property name`,
    );
  }

  const dataType = readString(record, ...ATTRIBUTE_TYPE_FIELDS);
  return { name, ...(dataType != null && dataType.length > 0 && { dataType }) };
}

export function readTablePrimaryKey(
  rows: readonly LadybugRecord[],
): string | undefined {
  return readTablePrimaryKeyInfo(rows)?.name;
}

export function readTablePrimaryKeyInfo(
  rows: readonly LadybugRecord[],
): LadybugPrimaryKeyInfo | undefined {
  for (const row of rows) {
    const record = unwrapSingletonRecord(row, PRIMARY_KEY_NAME_FIELDS);
    const name = readString(record, ...PRIMARY_KEY_NAME_FIELDS);
    if (name == null || name.length === 0) {
      continue;
    }

    if (
      PRIMARY_KEY_INDICATOR_FIELDS.some(field =>
        isPrimaryKeyIndicator(record, field),
      )
    ) {
      const dataType = readString(record, ...ATTRIBUTE_TYPE_FIELDS);
      return {
        name,
        ...(dataType != null &&
          dataType.length > 0 && { type: dataType, dataType }),
      };
    }
  }

  return undefined;
}

export function parseShowConnectionRows(
  rows: readonly LadybugRecord[],
  edgeType: string,
): EdgeConnection[] {
  return rows.map((row, index) => parseShowConnectionRow(row, edgeType, index));
}

export function parseShowConnectionRow(
  row: LadybugRecord,
  edgeType: string,
  index = 0,
): EdgeConnection {
  const record = unwrapSingletonRecord(row, SOURCE_FIELDS, TARGET_FIELDS);
  const source = readString(record, ...SOURCE_FIELDS);
  if (source == null || source.length === 0) {
    throw new Error(
      `Malformed Ladybug show_connection row ${index}: missing source table for ${edgeType}`,
    );
  }

  const target = readString(record, ...TARGET_FIELDS);
  if (target == null || target.length === 0) {
    throw new Error(
      `Malformed Ladybug show_connection row ${index}: missing target table for ${edgeType}`,
    );
  }

  const count = readNumber(record, ...COUNT_FIELDS);
  return createEdgeConnection({
    source,
    edge: edgeType,
    target,
    ...(count != null && { count }),
  });
}

export function normalizeResponseRecords(response: unknown): LadybugRecord[] {
  if (!isRecord(response)) {
    return [];
  }

  const results = response.results;
  if (!Array.isArray(results)) {
    return [];
  }

  return results.flatMap(value => (isRecord(value) ? [value] : []));
}

export function readString(
  record: LadybugRecord | undefined,
  ...names: readonly string[]
): string | undefined {
  if (record == null) {
    return undefined;
  }

  for (const name of names) {
    const value = readField(record, name);
    if (value != null) {
      return stringifyValue(value);
    }
  }

  return undefined;
}

export function readNumber(
  record: LadybugRecord | undefined,
  ...names: readonly string[]
): number | undefined {
  if (record == null) {
    return undefined;
  }

  for (const name of names) {
    const value = readField(record, name);
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "bigint") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

export function readField(record: LadybugRecord, name: string): LadybugValue {
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

export function escapeLadybugString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function readTableKind(type: string): LadybugTableKind | undefined {
  if (type.includes("NODE") || type.includes("VERTEX")) {
    return "node";
  }
  if (type.includes("REL") || type.includes("EDGE")) {
    return "edge";
  }
  return undefined;
}

function unwrapSingletonRecord(
  row: LadybugRecord,
  ...fieldGroups: readonly (readonly string[])[]
): LadybugRecord {
  if (
    fieldGroups.some(fields =>
      fields.some(field => readField(row, field) != null),
    )
  ) {
    return row;
  }

  const values = Object.values(row);
  return values.length === 1 && isRecord(values[0]) ? values[0] : row;
}

function isPrimaryKeyIndicator(record: LadybugRecord, name: string): boolean {
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

function stringifyValue(value: LadybugValue): string {
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

function isRecord(value: unknown): value is LadybugRecord {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
