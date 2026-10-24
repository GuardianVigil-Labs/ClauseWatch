// Extension storage on this device, over a small key-value interface so the
// code that uses it can be tested without a browser.

export interface KV {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export const kv: KV = {
  get: async (key) => (await browser.storage.local.get(key))[key],
  set: (key, value) => browser.storage.local.set({ [key]: value }),
  remove: (key) => browser.storage.local.remove(key),
};
