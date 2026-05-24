// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteLadybugWasmDatabaseFile,
  getLadybugWasmDatabaseFileName,
  getLadybugWasmDatabasePath,
  stageLadybugWasmDatabaseFile,
} from "./opfs";

describe("Ladybug WASM OPFS helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a stable encoded runtime ID for the OPFS .lbug path", () => {
    expect(getLadybugWasmDatabaseFileName("tenant/db 1")).toBe(
      "tenant%2Fdb%201.lbug",
    );
    expect(getLadybugWasmDatabasePath("tenant/db 1")).toBe(
      "/graph-explorer-ladybug/tenant%2Fdb%201.lbug",
    );
  });

  it("writes bytes through a sync access handle and closes it", async () => {
    const close = vi.fn(() => Promise.resolve(undefined));
    const flush = vi.fn(() => Promise.resolve(undefined));
    const truncate = vi.fn(() => Promise.resolve(undefined));
    const write = vi.fn(() => 3);
    const getFileHandle = vi.fn(() =>
      Promise.resolve({
        createSyncAccessHandle: vi.fn(() =>
          Promise.resolve({
            close,
            flush,
            truncate,
            write,
          }),
        ),
      }),
    );
    stubOpfsDirectory({ getFileHandle });

    await expect(
      stageLadybugWasmDatabaseFile("runtime", new Uint8Array([1, 2, 3])),
    ).resolves.toBe("/graph-explorer-ladybug/runtime.lbug");

    expect(getFileHandle).toHaveBeenCalledWith("runtime.lbug", {
      create: true,
    });
    expect(truncate).toHaveBeenNthCalledWith(1, 0);
    expect(write).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), { at: 0 });
    expect(truncate).toHaveBeenNthCalledWith(2, 3);
    expect(flush).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes writable streams when write fails", async () => {
    const close = vi.fn(() => Promise.resolve(undefined));
    const writeError = new Error("write failed");
    stubOpfsDirectory({
      getFileHandle: vi.fn(() =>
        Promise.resolve({
          createWritable: vi.fn(() =>
            Promise.resolve({
              close,
              write: vi.fn(() => Promise.reject(writeError)),
            }),
          ),
        }),
      ),
    });

    await expect(
      stageLadybugWasmDatabaseFile("runtime", new Uint8Array([1])),
    ).rejects.toThrow(writeError);
    expect(close).toHaveBeenCalledOnce();
  });

  it("deletes staged files idempotently", async () => {
    const notFoundError = new Error("missing");
    notFoundError.name = "NotFoundError";
    const removeEntry = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(notFoundError);
    stubOpfsDirectory({
      getFileHandle: vi.fn(),
      removeEntry,
    });

    await expect(deleteLadybugWasmDatabaseFile("runtime")).resolves.toBe(true);
    await expect(deleteLadybugWasmDatabaseFile("runtime")).resolves.toBe(false);
    expect(removeEntry).toHaveBeenCalledWith("runtime.lbug");
  });
});

function stubOpfsDirectory(directory: {
  getFileHandle: ReturnType<typeof vi.fn>;
  removeEntry?: ReturnType<typeof vi.fn>;
}): void {
  const storage = {
    getDirectory: vi.fn(() => Promise.resolve(directory)),
  };
  vi.stubGlobal("navigator", { storage });
}
