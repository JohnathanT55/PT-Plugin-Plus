export interface StorageAreaLike {
  get(
    keys: string | string[] | null,
    callback: (items: { [key: string]: any }) => void
  ): void;
  set(items: { [key: string]: any }, callback?: () => void): void;
  remove(keys: string | string[], callback?: () => void): void;
}

function runtimeError(): Error | undefined {
  if (typeof chrome === "undefined" || !chrome.runtime) {
    return undefined;
  }
  const error = chrome.runtime && chrome.runtime.lastError;
  return error ? new Error(error.message) : undefined;
}

export class ChromeStorageAdapter {
  constructor(private area: StorageAreaLike = chrome.storage.local) {}

  public get(keys: string | string[] | null): Promise<{ [key: string]: any }> {
    return new Promise((resolve, reject) => {
      this.area.get(keys, items => {
        const error = runtimeError();
        if (error) {
          reject(error);
          return;
        }
        resolve(items || {});
      });
    });
  }

  public set(items: { [key: string]: any }): Promise<void> {
    return new Promise((resolve, reject) => {
      this.area.set(items, () => {
        const error = runtimeError();
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  public remove(keys: string | string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.area.remove(keys, () => {
        const error = runtimeError();
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}
