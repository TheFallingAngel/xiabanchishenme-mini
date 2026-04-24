/**
 * @vercel/blob mock —— L2 路由 /api/reviews/upload 用。
 *
 * 默认:put() 返回一个固定 URL,不模拟真实上传。
 * 失败场景:调 setBlobPutToFail() 后 put() 抛错。
 */

type PutResult = { url: string; pathname: string; contentType?: string };
type PutFn = (
  key: string,
  file: Blob,
  opts?: { access?: string; contentType?: string }
) => Promise<PutResult>;

let mode: "ok" | "fail" = "ok";
let lastCall: { key: string; size: number; contentType?: string } | null = null;

export function resetBlob() {
  mode = "ok";
  lastCall = null;
}

export function setBlobPutToFail() {
  mode = "fail";
}

export function getLastPutCall() {
  return lastCall;
}

export const mockPut: PutFn = async (key, file, opts) => {
  lastCall = {
    key,
    size: file.size,
    contentType: opts?.contentType || (file as Blob).type,
  };
  if (mode === "fail") {
    throw new Error("Blob mock failure");
  }
  return {
    url: `https://blob-mock.test/${key}`,
    pathname: key,
    contentType: opts?.contentType,
  };
};
