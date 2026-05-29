import type { PearlWalletStorageAdapter, PearlWalletStoredVault } from '@kaspacom/pearl-wallet';

const DB_NAME = 'oysters.pearl-wallet';
const DB_VERSION = 1;
const VAULT_STORE = 'vaults';

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof window === 'undefined' || !('indexedDB' in window)) {
        reject(new Error('pearl-wallet: this browser does not support IndexedDB'));
        return;
      }
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(VAULT_STORE)) {
          db.createObjectStore(VAULT_STORE, { keyPath: 'walletId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('pearl-wallet: failed to open IndexedDB'));
    });
  }
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => T | Promise<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(VAULT_STORE, mode);
    const store = transaction.objectStore(VAULT_STORE);
    let result: T;
    Promise.resolve(fn(store))
      .then((value) => {
        result = value;
      })
      .catch(reject);
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

/**
 * IndexedDB-backed implementation of the pearl-wallet storage adapter. Persists
 * the full encrypted vault per user across page reloads, browser restarts, and
 * (where the browser allows) device reboots. Cleared if the user clears site
 * data — recovery is via the BIP39 phrase entered through the W6 flow.
 */
export const indexedDbPearlWalletStorage: PearlWalletStorageAdapter = {
  async load(walletId): Promise<PearlWalletStoredVault | undefined> {
    return tx('readonly', (store) => {
      return new Promise<PearlWalletStoredVault | undefined>((resolve, reject) => {
        const req = store.get(walletId);
        req.onsuccess = () => resolve(req.result as PearlWalletStoredVault | undefined);
        req.onerror = () => reject(req.error);
      });
    });
  },
  async save(vault): Promise<void> {
    await tx('readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.put(vault);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  },
  async list(): Promise<PearlWalletStoredVault[]> {
    return tx('readonly', (store) => {
      return new Promise<PearlWalletStoredVault[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result as PearlWalletStoredVault[]);
        req.onerror = () => reject(req.error);
      });
    });
  },
  async delete(walletId): Promise<void> {
    await tx('readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.delete(walletId);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  },
};
