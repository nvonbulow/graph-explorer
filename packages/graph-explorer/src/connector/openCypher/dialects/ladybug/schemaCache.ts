import type { SchemaResponse } from "@/connector/useGEFetchTypes";
import type { EdgeConnection } from "@/core";

import type { OpenCypherFetch } from "../../types";

import {
  discoverLadybugSchema,
  type LadybugDiscoveredSchema,
} from "./fetchSchema";
import {
  escapeLadybugString,
  normalizeResponseRecords,
  parseShowConnectionRows,
  parseShowTablesRows,
  readTablePrimaryKeyInfo,
  type LadybugPrimaryKeyInfo,
} from "./schemaReaders";

export type LadybugSchemaCache = ReturnType<typeof createLadybugSchemaCache>;
export type LadybugFetchFactory = () =>
  | OpenCypherFetch
  | Promise<OpenCypherFetch>;

export function createLadybugSchemaCache(fetchFactory: LadybugFetchFactory) {
  let discoveryPromise: Promise<LadybugDiscoveredSchema> | undefined;
  const primaryKeyInfoPromises = new Map<
    string,
    Promise<LadybugPrimaryKeyInfo | undefined>
  >();
  let edgeConnectionsByTypePromise:
    | Promise<ReadonlyMap<string, readonly EdgeConnection[]>>
    | undefined;

  function discovery(): Promise<LadybugDiscoveredSchema> {
    discoveryPromise ??= Promise.resolve(fetchFactory()).then(
      discoverLadybugSchema,
    );
    return discoveryPromise;
  }

  async function schema(): Promise<SchemaResponse> {
    return (await discovery()).schema;
  }

  function primaryKey(label: string): Promise<string | undefined> {
    return primaryKeyInfo(label).then(info => info?.name);
  }

  function primaryKeyInfo(
    label: string,
  ): Promise<LadybugPrimaryKeyInfo | undefined> {
    let promise = primaryKeyInfoPromises.get(label);
    if (promise == null) {
      promise = discoverPrimaryKeyInfo(fetchFactory, label).catch(() =>
        discovery().then(discovered => {
          const name = discovered.primaryKeysByLabel.get(label);
          return name == null ? undefined : { name };
        }),
      );
      primaryKeyInfoPromises.set(label, promise);
    }
    return promise;
  }

  function edgeConnections(
    edgeType?: string,
  ): Promise<readonly EdgeConnection[]> {
    if (edgeType == null) {
      return edgeConnectionsByType().then(byType =>
        Array.from(byType.values()).flatMap(connections => connections),
      );
    }

    return edgeConnectionsByType().then(byType => byType.get(edgeType) ?? []);
  }

  function edgeConnectionsByType(): Promise<
    ReadonlyMap<string, readonly EdgeConnection[]>
  > {
    edgeConnectionsByTypePromise ??= discovery()
      .then(discovered => discovered.edgeConnectionsByType)
      .catch(() => discoverEdgeConnectionsByType(fetchFactory));
    return edgeConnectionsByTypePromise;
  }

  function invalidate(): void {
    discoveryPromise = undefined;
    edgeConnectionsByTypePromise = undefined;
    primaryKeyInfoPromises.clear();
  }

  return {
    schema,
    primaryKey,
    primaryKeyInfo,
    edgeConnections,
    edgeConnectionsByType,
    invalidate,
  };
}

async function discoverPrimaryKeyInfo(
  fetchFactory: LadybugFetchFactory,
  label: string,
): Promise<LadybugPrimaryKeyInfo | undefined> {
  const fetch = await fetchFactory();
  return readTablePrimaryKeyInfo(
    normalizeResponseRecords(
      await fetch(`CALL table_info('${escapeLadybugString(label)}') RETURN *`),
    ),
  );
}

async function discoverEdgeConnectionsByType(
  fetchFactory: LadybugFetchFactory,
): Promise<ReadonlyMap<string, readonly EdgeConnection[]>> {
  const fetch = await fetchFactory();
  const tables = parseShowTablesRows(
    normalizeResponseRecords(await fetch("CALL show_tables() RETURN *")),
  );
  const byType = new Map<string, readonly EdgeConnection[]>();

  for (const table of tables) {
    if (table.kind !== "edge") {
      continue;
    }

    byType.set(
      table.name,
      parseShowConnectionRows(
        normalizeResponseRecords(
          await fetch(
            `CALL show_connection('${escapeLadybugString(table.name)}') RETURN *`,
          ),
        ),
        table.name,
      ),
    );
  }

  return byType;
}
