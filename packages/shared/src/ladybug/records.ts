import type {
  LadybugRawResultSet,
  LadybugRecord,
  LadybugRow,
  LadybugValue,
  NeptuneResultRow,
  NeptuneValue,
} from "./types.ts";

import { isLadybugRecord, normalizeLadybugScalar } from "./scalars.ts";

const VALUE_KEY = "value";

export function normalizeLadybugResultSetsToRecords(
  resultSets: readonly LadybugRawResultSet[],
): NeptuneResultRow[] {
  const records: NeptuneResultRow[] = [];
  for (const resultSet of resultSets) {
    records.push(...normalizeLadybugResultSetToRecords(resultSet));
  }
  return records;
}

export function normalizeLadybugResultSetToRecords(
  resultSet: LadybugRawResultSet,
): NeptuneResultRow[] {
  const records: NeptuneResultRow[] = [];
  const rows = resultSet.rows;
  if (rows !== undefined) {
    for (const row of rows) {
      records.push(normalizeLadybugRowToRecord(row, resultSet.columnNames));
    }
    return records;
  }

  const objects = resultSet.objects ?? [];
  for (const value of objects) {
    records.push(normalizeLadybugObjectToRecord(value, resultSet.columnNames));
  }
  return records;
}

export function normalizeLadybugRowToRecord(
  row: LadybugRow,
  columnNames: readonly string[] | undefined,
): NeptuneResultRow {
  if (isLadybugRecord(row)) {
    return normalizeLadybugRecordToNeptuneRow(row);
  }

  if (Array.isArray(row)) {
    const record: NeptuneResultRow = {};
    for (let index = 0; index < row.length; index += 1) {
      record[readValueKey(columnNames, index, row.length)] =
        normalizeLadybugValue(row[index]);
    }
    return record;
  }

  return {
    [readValueKey(columnNames, 0, 1)]: normalizeLadybugValue(row),
  };
}

export function normalizeLadybugObjectToRecord(
  value: LadybugValue,
  columnNames: readonly string[] | undefined,
): NeptuneResultRow {
  if (isLadybugRecord(value)) {
    return normalizeLadybugRecordToNeptuneRow(value);
  }

  return {
    [readValueKey(columnNames, 0, 1)]: normalizeLadybugValue(value),
  };
}

function normalizeLadybugRecordToNeptuneRow(
  record: LadybugRecord,
): NeptuneResultRow {
  const normalized: NeptuneResultRow = {};
  for (const [key, value] of Object.entries(record)) {
    normalized[key] = normalizeLadybugValue(value);
  }
  return normalized;
}

function normalizeLadybugValue(value: LadybugValue): NeptuneValue {
  return normalizeLadybugScalar(value);
}

function readValueKey(
  columnNames: readonly string[] | undefined,
  index: number,
  valueCount: number,
): string {
  const columnName = columnNames?.[index];
  if (columnName != null && columnName.length > 0) {
    return columnName;
  }

  return valueCount === 1 ? VALUE_KEY : `${VALUE_KEY}${index}`;
}
