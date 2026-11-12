import { translate } from "../i18n";
import { invoke as nativeInvoke } from "@tauri-apps/api/core";
import {
  StorageAdapter,
  recordKey,
  type Records,
  type Session,
  type Store,
  type StorageInfo,
} from "./adapter";

async function invoke<T>(...args: Parameters<typeof nativeInvoke>): Promise<T> {
  try {
    return await nativeInvoke<T>(...args);
  } catch (cause) {
    throw new Error(translate("暂时无法访问本机文件，请检查可用空间后重试。"), {
      cause,
    });
  }
}

type FileRef = { $file: string; size: number; type: string; text?: boolean };
type Encoded =
  null | boolean | number | string | Encoded[] | { [key: string]: Encoded };
type Row = { key: string; value: Encoded };
type Change = {
  store: Store;
  key?: string;
  value?: Encoded;
  files?: string[];
  kind: "put" | "delete" | "clear";
};
const chunkSize = 4 * 1024 ** 2;

export class DesktopStorage extends StorageAdapter {
  // Each callback sees prior commits; read/modify/write operations cannot interleave.
  private queue: Promise<unknown> = Promise.resolve();
  getStorageInfo() {
    return invoke<StorageInfo>("storage_info");
  }
  moveStorage(directory: string): Promise<StorageInfo> {
    // Migration waits for complete uploads/commits and blocks later transactions.
    const pending = this.queue.then(async () => {
      try {
        return await nativeInvoke<StorageInfo>("storage_move", { directory });
      } catch (cause) {
        const messages: Record<string, string> = {
          storage_directory_overlap: "请选择当前存储目录之外的空文件夹。",
          storage_directory_not_empty: "请选择空文件夹，避免覆盖已有数据。",
          storage_directory_busy: "请等待文件保存完成后再修改目录。",
        };
        throw new Error(translate(messages[String(cause)] || "迁移没有完成，原目录未改变。请检查文件夹权限和可用空间后重试。"), { cause });
      }
    });
    this.queue = pending.catch(() => {});
    return pending;
  }
  transaction<T>(
    stores: Store[],
    mode: "readonly" | "readwrite",
    run: (tx: Session) => Promise<T>,
  ): Promise<T> {
    const pending = this.queue.then(() => this.run(stores, mode, run));
    this.queue = pending.catch(() => {});
    return pending;
  }
  private async run<T>(
    stores: Store[],
    mode: "readonly" | "readwrite",
    run: (tx: Session) => Promise<T>,
  ): Promise<T> {
    const changes: Change[] = [];
    const staged: string[] = [];
    const check = (store: Store, write = false) => {
      if (!stores.includes(store) || (write && mode !== "readwrite"))
        throw new Error("Invalid storage transaction");
    };
    const encode = async (
      value: unknown,
      files: string[],
    ): Promise<Encoded> => {
      if (
        value instanceof Blob ||
        (typeof value === "string" && value.startsWith("data:image/"))
      ) {
        const text = typeof value === "string";
        const blob = text
          ? new Blob([value], { type: "text/plain" })
          : (value as Blob);
        const id = await invoke<string>("storage_create_file");
        staged.push(id);
        files.push(id);
        for (let offset = 0; offset < blob.size; offset += chunkSize) {
          const bytes = await blob
            .slice(offset, offset + chunkSize)
            .arrayBuffer();
          await invoke("storage_write_file", bytes, {
            headers: { "x-file-id": id, "x-file-offset": String(offset) },
          });
        }
        return {
          $file: id,
          size: blob.size,
          type: blob.type,
          ...(text ? { text: true } : {}),
        };
      }
      if (Array.isArray(value))
        return Promise.all(value.map((item) => encode(item, files)));
      if (value && typeof value === "object") {
        const result: Record<string, Encoded> = {};
        for (const [key, item] of Object.entries(value))
          if (item !== undefined) result[key] = await encode(item, files);
        return result;
      }
      return value as Encoded;
    };
    const decode = async (value: Encoded): Promise<unknown> => {
      if (Array.isArray(value)) return Promise.all(value.map(decode));
      if (value && typeof value === "object") {
        if (typeof value.$file === "string") {
          const ref = value as FileRef;
          const chunks: BlobPart[] = [];
          for (let offset = 0; offset < ref.size; offset += chunkSize) {
            const bytes = await invoke<ArrayBuffer>("storage_read_file", {
              id: ref.$file,
              offset,
              length: Math.min(chunkSize, ref.size - offset),
            });
            if (bytes.byteLength !== Math.min(chunkSize, ref.size - offset))
              throw new Error("Incomplete stored file");
            chunks.push(bytes);
          }
          const blob = new Blob(chunks, { type: ref.type });
          return ref.text ? blob.text() : blob;
        }
        return Object.fromEntries(
          await Promise.all(
            Object.entries(value).map(async ([key, item]) => [
              key,
              await decode(item),
            ]),
          ),
        );
      }
      return value;
    };
    const rows = async (store: Store, key?: string) => {
      check(store);
      const records = new Map(
        (await invoke<Row[]>("storage_read", { store, key })).map((row) => [
          row.key,
          row.value,
        ]),
      );
      for (const change of changes.filter((change) => change.store === store)) {
        if (change.kind === "clear") records.clear();
        else if (key === undefined || change.key === key) {
          if (change.kind === "delete") records.delete(change.key!);
          else records.set(change.key!, change.value!);
        }
      }
      return records;
    };
    const session: Session = {
      get: async <S extends Store>(store: S, key: string) => {
        const value = (await rows(store, key)).get(key);
        return value === undefined
          ? undefined
          : ((await decode(value)) as Records[S]);
      },
      getAll: async <S extends Store>(store: S) =>
        Promise.all(
          [...(await rows(store)).values()].map(
            async (value) => (await decode(value)) as Records[S],
          ),
        ),
      put: async (store, value, key) => {
        check(store, true);
        const id = recordKey(store, value, key);
        const files: string[] = [];
        changes.push({
          kind: "put",
          store,
          key: id,
          value: await encode(value, files),
          files,
        });
      },
      delete: async (store, key) => {
        check(store, true);
        changes.push({ kind: "delete", store, key });
      },
      clear: async (store) => {
        check(store, true);
        changes.push({ kind: "clear", store });
      },
      count: async (store) => (await rows(store)).size,
      romSize: async (key) =>
        ((await rows("roms", key)).get(key) as FileRef | undefined)?.size ?? 0,
    };
    try {
      const result = await run(session);
      if (changes.length) await invoke("storage_commit", { changes });
      return result;
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      // The backend removes only unreferenced files, even if commit succeeded but its reply was lost.
      if (staged.length)
        await invoke("storage_discard_files", { ids: staged }).catch(
          console.error,
        );
    }
  }
  async estimate() {
    return invoke<StorageEstimate>("storage_estimate");
  }
}
