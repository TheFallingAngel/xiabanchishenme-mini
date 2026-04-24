/**
 * @vercel/kv in-memory mock —— L2 路由测试用。
 *
 * 只实现 reviews/ dish-photos 两条路由真正调到的那几个动词:
 *   lrange / lpush / ltrim / del
 * 其它暂时抛 "not mocked" 保护自己,后续谁加新调用一眼看出来。
 *
 * 用法:
 *   import { resetKv, kvStore } from "@/../tests/mocks/kv";
 *   vi.mock("@vercel/kv", () => import("@/../tests/mocks/kv").then(m => m.mockModule));
 *
 * 不过 vi.mock 不支持动态 import() 语法 —— 我们让测试文件直接:
 *   vi.mock("@vercel/kv", () => ({ kv: require(".../tests/mocks/kv").mockKv }))
 * 或者更简单:每个测试用 setupKvMock() 函数挂钩。
 */

type ListStore = Map<string, string[]>;
type KvStore = Map<string, string>;

/** 共享的内存存储。测试开头调 resetKv() 清干净。 */
export const kvStore: { lists: ListStore; kvs: KvStore } = {
  lists: new Map(),
  kvs: new Map(),
};

export function resetKv() {
  kvStore.lists.clear();
  kvStore.kvs.clear();
}

/** 对齐 @vercel/kv 导出的 kv 对象签名(只实现用到的那几个动词)。 */
export const mockKv = {
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = kvStore.lists.get(key) || [];
    // @vercel/kv 的 lrange 语义: stop=-1 表示到末尾
    const end = stop === -1 ? list.length : stop + 1;
    return list.slice(start, end);
  },

  async lpush(key: string, ...values: string[]): Promise<number> {
    const cur = kvStore.lists.get(key) || [];
    // lpush 是头插,等价于 reverse 后 concat
    const next = [...values.slice().reverse(), ...cur];
    kvStore.lists.set(key, next);
    return next.length;
  },

  async ltrim(key: string, start: number, stop: number): Promise<"OK"> {
    const cur = kvStore.lists.get(key) || [];
    const end = stop === -1 ? cur.length : stop + 1;
    kvStore.lists.set(key, cur.slice(start, end));
    return "OK";
  },

  async del(key: string): Promise<number> {
    const had = kvStore.lists.delete(key) || kvStore.kvs.delete(key);
    return had ? 1 : 0;
  },

  /** 简单 key/value —— image-tag.ts 三级缓存用。 */
  async get<T = unknown>(key: string): Promise<T | null> {
    const v = kvStore.kvs.get(key);
    return (v ?? null) as T | null;
  },

  async set(
    key: string,
    value: string,
    _opts?: { ex?: number }
  ): Promise<"OK"> {
    kvStore.kvs.set(key, String(value));
    return "OK";
  },
};

/**
 * 一个可控的"受伤"实例 —— 在需要模拟 KV 挂掉的用例里 replace kvStore 的函数引用。
 * kv.lrange / lpush 直接抛错,触发路由的 try/catch 兜底分支。
 */
export function makeFailingKv(op: "read" | "write" | "all" = "all") {
  const fail = () => Promise.reject(new Error("KV mock failure"));
  return {
    lrange: op === "write" ? mockKv.lrange : fail,
    lpush: op === "read" ? mockKv.lpush : fail,
    ltrim: op === "read" ? mockKv.ltrim : fail,
    get: op === "write" ? mockKv.get : fail,
    set: op === "read" ? mockKv.set : fail,
    del: fail,
  };
}
