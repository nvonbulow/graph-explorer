import type {
  LadybugNeptuneAdapterOptions,
  NeptuneOpenCypherResponse,
} from "@graph-explorer/shared/ladybug";

import {
  deleteLadybugWasmDatabaseFile,
  type LadybugWasmBytes,
  stageLadybugWasmDatabaseFile,
} from "./opfs";
import {
  openLadybugWasmRuntime as openRuntime,
  type LadybugWasmRuntime,
} from "./runtime";

const runtimes = new Map<string, Promise<LadybugWasmRuntime>>();

export async function stageLadybugWasmDatabase(
  runtimeId: string,
  data: LadybugWasmBytes,
): Promise<string> {
  await closeLadybugWasmRuntime(runtimeId);
  return stageLadybugWasmDatabaseFile(runtimeId, data);
}

export async function deleteLadybugWasmDatabase(
  runtimeId: string,
): Promise<boolean> {
  await closeLadybugWasmRuntime(runtimeId);
  return deleteLadybugWasmDatabaseFile(runtimeId);
}

export async function openLadybugWasmRuntime(
  runtimeId: string,
): Promise<LadybugWasmRuntime> {
  let runtimePromise = runtimes.get(runtimeId);
  if (!runtimePromise) {
    runtimePromise = openRuntime(runtimeId).catch(error => {
      runtimes.delete(runtimeId);
      throw error;
    });
    runtimes.set(runtimeId, runtimePromise);
  }

  return runtimePromise;
}

export async function closeLadybugWasmRuntime(
  runtimeId: string,
): Promise<void> {
  const runtimePromise = runtimes.get(runtimeId);
  if (!runtimePromise) {
    return;
  }

  const runtime = await runtimePromise;
  await runtime.close();
  runtimes.delete(runtimeId);
}

export async function queryLadybugWasmRuntime(
  runtimeId: string,
  query: string,
  options?: LadybugNeptuneAdapterOptions,
): Promise<NeptuneOpenCypherResponse> {
  const runtime = await openLadybugWasmRuntime(runtimeId);
  return runtime.query(query, options);
}

export async function closeAllLadybugWasmRuntimes(): Promise<void> {
  await Promise.all([...runtimes.keys()].map(closeLadybugWasmRuntime));
}
