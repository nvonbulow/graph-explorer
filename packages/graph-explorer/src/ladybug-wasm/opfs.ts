export const LADYBUG_OPFS_MOUNT_POINT = "/graph-explorer-ladybug";

export type LadybugWasmBytes = Blob | Uint8Array | ArrayBuffer;

type OpfsWritableFileStream = {
  write(data: Blob | Uint8Array): Promise<void>;
  close(): Promise<void>;
};

type OpfsSyncAccessHandle = {
  write(data: Uint8Array, options?: { at?: number }): number;
  truncate(size: number): Promise<void> | void;
  flush(): Promise<void> | void;
  close(): Promise<void> | void;
};

type OpfsFileHandle = {
  createSyncAccessHandle?: () => Promise<OpfsSyncAccessHandle>;
  createWritable?: () => Promise<OpfsWritableFileStream>;
};

type OpfsDirectoryHandle = {
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<OpfsFileHandle>;
  removeEntry?: (name: string) => Promise<void>;
};

type OpfsNavigator = Navigator & {
  storage?: {
    getDirectory?: () => Promise<OpfsDirectoryHandle>;
  };
};

export function getLadybugWasmDatabaseFileName(runtimeId: string): string {
  if (!runtimeId) {
    throw new Error("Ladybug WASM runtime ID is required.");
  }

  return `${encodeURIComponent(runtimeId)}.lbug`;
}

export function getLadybugWasmDatabasePath(runtimeId: string): string {
  return `${LADYBUG_OPFS_MOUNT_POINT}/${getLadybugWasmDatabaseFileName(runtimeId)}`;
}

export async function stageLadybugWasmDatabaseFile(
  runtimeId: string,
  data: LadybugWasmBytes,
): Promise<string> {
  const fileHandle = await getOpfsDatabaseFileHandle(runtimeId);

  if (typeof fileHandle.createSyncAccessHandle === "function") {
    const bytes = await toUint8Array(data);
    const accessHandle = await fileHandle.createSyncAccessHandle();
    try {
      await accessHandle.truncate(0);
      const bytesWritten = accessHandle.write(bytes, { at: 0 });
      if (bytesWritten !== bytes.byteLength) {
        throw new Error(
          `Ladybug OPFS staging wrote ${bytesWritten} of ${bytes.byteLength} bytes.`,
        );
      }
      await accessHandle.truncate(bytes.byteLength);
      await accessHandle.flush();
    } finally {
      await accessHandle.close();
    }

    return getLadybugWasmDatabasePath(runtimeId);
  }

  if (typeof fileHandle.createWritable !== "function") {
    throw new Error(
      "Ladybug local file staging requires OPFS file handles with createWritable() or createSyncAccessHandle().",
    );
  }

  const writer = await fileHandle.createWritable();
  try {
    await writer.write(isBlob(data) ? data : await toUint8Array(data));
  } finally {
    await writer.close();
  }

  return getLadybugWasmDatabasePath(runtimeId);
}

export async function deleteLadybugWasmDatabaseFile(
  runtimeId: string,
): Promise<boolean> {
  const storage = getOpfsStorage();
  const getDirectory = storage?.getDirectory;
  if (typeof getDirectory !== "function") {
    return false;
  }

  const directory = await getDirectory.call(storage);
  if (typeof directory.removeEntry !== "function") {
    return false;
  }

  try {
    await directory.removeEntry(getLadybugWasmDatabaseFileName(runtimeId));
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }

    throw error;
  }
}

async function getOpfsDatabaseFileHandle(
  runtimeId: string,
): Promise<OpfsFileHandle> {
  const storage = getOpfsStorage();
  const getDirectory = storage?.getDirectory;
  if (typeof getDirectory !== "function") {
    throw new Error(
      "Ladybug local file staging requires browser OPFS support. In tests, mock navigator.storage.getDirectory().",
    );
  }

  const directory = await getDirectory.call(storage);
  return directory.getFileHandle(getLadybugWasmDatabaseFileName(runtimeId), {
    create: true,
  });
}

function getOpfsStorage(): OpfsNavigator["storage"] | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }

  return (navigator as OpfsNavigator).storage;
}

async function toUint8Array(data: LadybugWasmBytes): Promise<Uint8Array> {
  if (data instanceof Uint8Array) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  if (isBlob(data)) {
    return new Uint8Array(await data.arrayBuffer());
  }

  return new Uint8Array(data);
}

function isBlob(data: LadybugWasmBytes): data is Blob {
  return typeof Blob !== "undefined" && data instanceof Blob;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "NotFoundError"
  );
}
