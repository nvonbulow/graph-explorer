import type { LadybugNeptuneAdapterOptions } from "./neptune.ts";
import type {
  LadybugQueryResult,
  LadybugQueryResultChain,
  LadybugRawResultSet,
  LadybugRecord,
  LadybugRuntime,
  NeptuneOpenCypherResponse,
} from "./types.ts";

import { adaptLadybugRecordsToNeptuneResponse } from "./neptune.ts";
import {
  readLadybugColumnNames,
  readLadybugColumnTypes,
  readLadybugObjects,
  readLadybugRows,
  readLadybugSummary,
} from "./readers.ts";
import { normalizeLadybugResultSetToRecords } from "./records.ts";

export async function queryLadybugResultSets(
  runtime: LadybugRuntime,
  statement: string,
  options: LadybugNeptuneAdapterOptions = { primaryKeys: {} },
): Promise<NeptuneOpenCypherResponse> {
  const records: LadybugRecord[] = [];
  const closedResults = new Set<LadybugQueryResult>();
  let initialResults: readonly LadybugQueryResult[] = [];
  let queryError: unknown;
  let closeError: unknown;

  try {
    const firstResult = await runtime.query(statement);
    initialResults = readInitialResults(firstResult);

    for (const result of initialResults) {
      await collectLadybugResultChain(
        result,
        statement,
        records,
        closedResults,
      );
    }
  } catch (error) {
    queryError = error;
  }

  try {
    await closeLadybugQueryResults(initialResults, closedResults);
  } catch (error) {
    closeError = error;
  }

  if (queryError != null) {
    throw toError(queryError);
  }
  if (closeError != null) {
    throw toError(closeError);
  }

  return adaptLadybugRecordsToNeptuneResponse(records, options);
}

async function collectLadybugResultChain(
  firstResult: LadybugQueryResult,
  statement: string,
  records: LadybugRecord[],
  closedResults: Set<LadybugQueryResult>,
): Promise<void> {
  const results: LadybugQueryResult[] = [firstResult];
  let result: LadybugQueryResult | null | undefined = firstResult;
  let chainError: unknown;
  let closeError: unknown;

  try {
    while (result != null) {
      const linkedResult = result.nextQueryResult;
      if (linkedResult != null && !results.includes(linkedResult)) {
        results.push(linkedResult);
      }

      if (result.isSuccess != null && !(await result.isSuccess())) {
        throw new Error(`Ladybug graph query reported failure: ${statement}`);
      }

      const normalizedRecords = normalizeLadybugResultSetToRecords(
        await readLadybugRawResultSet(result),
      ) as readonly LadybugRecord[];
      records.push(...normalizedRecords);

      result = await readNextLadybugQueryResult(result);
      if (result != null && !results.includes(result)) {
        results.push(result);
      }
    }
  } catch (error) {
    chainError = error;
  }

  try {
    await closeLadybugQueryResults(results, closedResults);
  } catch (error) {
    closeError = error;
  }

  if (chainError != null) {
    throw toError(chainError);
  }
  if (closeError != null) {
    throw toError(closeError);
  }
}

async function readLadybugRawResultSet(
  result: LadybugQueryResult,
): Promise<LadybugRawResultSet> {
  const columnNames = await readLadybugColumnNames(result);
  const columnTypes = await readLadybugColumnTypes(result);
  const rows = await readLadybugRows(result);
  const summary = await readLadybugSummary(result);
  const objects = rows !== undefined ? [] : await readLadybugObjects(result);

  return {
    columnNames,
    columnTypes,
    rows,
    objects,
    summary,
  };
}

async function readNextLadybugQueryResult(
  result: LadybugQueryResult,
): Promise<LadybugQueryResult | null | undefined> {
  const nextQueryResult: LadybugQueryResult | null | undefined =
    result.nextQueryResult;
  if (nextQueryResult != null) {
    return nextQueryResult;
  }

  if (result.getNextQueryResult == null) {
    return undefined;
  }

  if (
    result.hasNextQueryResult != null &&
    !(await result.hasNextQueryResult())
  ) {
    return undefined;
  }

  return result.getNextQueryResult();
}

async function closeLadybugQueryResult(
  result: LadybugQueryResult,
  closedResults: Set<LadybugQueryResult>,
): Promise<void> {
  if (closedResults.has(result)) {
    return;
  }

  closedResults.add(result);
  await result.close();
}

async function closeLadybugQueryResults(
  results: readonly LadybugQueryResult[],
  closedResults: Set<LadybugQueryResult>,
): Promise<void> {
  let closeError: unknown;
  for (const result of results) {
    try {
      await closeLadybugQueryResult(result, closedResults);
    } catch (error) {
      closeError ??= error;
    }
  }

  if (closeError != null) {
    throw toError(closeError);
  }
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  return new Error(String(value), { cause: value });
}

function isLadybugQueryResultChain(
  result: LadybugQueryResultChain,
): result is readonly LadybugQueryResult[] {
  return Array.isArray(result);
}

function readInitialResults(
  result: LadybugQueryResultChain | null | undefined,
): readonly LadybugQueryResult[] {
  if (result == null) {
    return [];
  }

  return isLadybugQueryResultChain(result) ? result : [result];
}
