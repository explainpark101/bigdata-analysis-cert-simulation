/** Lightweight IndexedDB KV + per-asset body store for project / exam persistence. */

const DB_NAME = 'bigdata-knight-simulation';
const DB_VERSION = 2;
const STORE = 'kv';
const ASSET_STORE = 'assetBodies';

export type IdbKey =
  | 'project'
  | 'examSession'
  | 'theme'
  | 'aiSettings'
  | 'variantChats'
  | 'authorChats'
  | 'gradeResult';

export interface AssetBodyRecord {
  encoding: 'utf-8' | 'base64';
  /**
   * Preferred: binary Blob (avoids UTF-16 string clone OOM in WebView2 IDB).
   * Legacy records may still have `content` string.
   */
  blob?: Blob;
  content?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
      if (!db.objectStoreNames.contains(ASSET_STORE)) {
        db.createObjectStore(ASSET_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
  return dbPromise;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB tx failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB tx aborted'));
  });
}

export async function idbGet<T>(key: IdbKey): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'));
  });
}

export async function idbSet(key: IdbKey, value: unknown): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(value, key);
  await txDone(tx);
}

export async function idbDelete(key: IdbKey): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(key);
  await txDone(tx);
}

export async function idbPutAssetBody(
  id: string,
  body: AssetBodyRecord,
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(ASSET_STORE, 'readwrite');
  tx.objectStore(ASSET_STORE).put(body, id);
  await txDone(tx);
}

export async function idbGetAssetBody(
  id: string,
): Promise<AssetBodyRecord | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE, 'readonly');
    const req = tx.objectStore(ASSET_STORE).get(id);
    req.onsuccess = () => resolve(req.result as AssetBodyRecord | undefined);
    req.onerror = () =>
      reject(req.error ?? new Error('IndexedDB asset get failed'));
  });
}

export async function idbDeleteAssetBody(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(ASSET_STORE, 'readwrite');
  tx.objectStore(ASSET_STORE).delete(id);
  await txDone(tx);
}

export async function idbClearAssetBodies(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(ASSET_STORE, 'readwrite');
  tx.objectStore(ASSET_STORE).clear();
  await txDone(tx);
}

export async function idbDeleteAssetBodies(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await openDb();
  const tx = db.transaction(ASSET_STORE, 'readwrite');
  const store = tx.objectStore(ASSET_STORE);
  for (const id of ids) store.delete(id);
  await txDone(tx);
}

/** One-time migrate legacy localStorage keys into IndexedDB, then remove them. */
export async function migrateLocalStorageToIdb(): Promise<void> {
  if (typeof localStorage === 'undefined') return;

  const map: Array<{ ls: string; idb: IdbKey; parseJson: boolean }> = [
    { ls: 'bks.project.v1', idb: 'project', parseJson: true },
    { ls: 'bks.examSession.v1', idb: 'examSession', parseJson: true },
    { ls: 'bks.theme.v1', idb: 'theme', parseJson: false },
  ];

  for (const { ls, idb, parseJson } of map) {
    const raw = localStorage.getItem(ls);
    if (raw == null) continue;
    const existing = await idbGet(idb);
    if (existing === undefined) {
      try {
        const value = parseJson ? JSON.parse(raw) : raw;
        await idbSet(idb, value);
      } catch {
        /* ignore corrupt legacy */
      }
    }
    localStorage.removeItem(ls);
  }
}

let migrateOnce: Promise<void> | null = null;

export function ensureIdbReady(): Promise<void> {
  if (!migrateOnce) {
    migrateOnce = migrateLocalStorageToIdb().catch(() => {
      /* storage may be blocked */
    });
  }
  return migrateOnce;
}
