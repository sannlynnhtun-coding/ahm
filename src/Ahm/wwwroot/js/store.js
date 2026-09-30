window.ahmStore = (() => {
  let dbPromise;
  function database() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('ahm', 3);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (db.objectStoreNames.contains('ShopCredentialsStore')) db.deleteObjectStore('ShopCredentialsStore');
        for (const name of ['ShopConnectionStore', 'PreferenceStore']) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }
  async function get(store, key) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const request = db.transaction(store, 'readonly').objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }
  async function put(store, key, value) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, 'readwrite');
      transaction.objectStore(store).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
  async function remove(store, key) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, 'readwrite');
      transaction.objectStore(store).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
  return { get, put, remove };
})();

window.ahmUi = {
  focusById(id) {
    document.getElementById(id)?.focus();
  },
  openDialog(id, focusId) {
    const dialog = document.getElementById(id);
    if (!(dialog instanceof HTMLDialogElement)) return;
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => document.getElementById(focusId)?.focus());
  }
};
