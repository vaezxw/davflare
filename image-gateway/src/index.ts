export interface Env {
  IMAGES: R2Bucket;
  UPLOAD_TOKEN: string;
  ALLOWED_ORIGINS: string;
}

const MEDIA = /^(image|video|audio)\//;
const ALLOWED_UPLOAD =
  /^(image\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|audio\/[a-z0-9.+-]+|application\/pdf)$/i;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

function cors(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  result.set("Access-Control-Allow-Origin", "*");
  result.set("Access-Control-Allow-Methods", "GET, HEAD, PUT, DELETE, OPTIONS");
  result.set(
    "Access-Control-Allow-Headers",
    "Range, Content-Type, Authorization, If-None-Match"
  );
  result.set(
    "Access-Control-Expose-Headers",
    "ETag, Content-Length, Content-Range, Accept-Ranges, Content-Disposition, Content-Type"
  );
  result.set("Access-Control-Max-Age", "86400");
  result.set("X-Content-Type-Options", "nosniff");
  return result;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: cors({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }),
  });
}

function safeKey(pathname: string): string | null {
  let key = pathname.replace(/^\/+/, "");
  if (!key) return null;
  try {
    key = decodeURIComponent(key);
  } catch {
    return null;
  }
  if (key.includes("\0")) return null;
  const parts = key.split("/").filter((part) => part && part !== ".");
  if (!parts.length || parts.some((part) => part === "..")) return null;
  return parts.join("/");
}

function fileName(key: string): string {
  return key.split("/").pop() || "download";
}

function contentDisposition(key: string, contentType: string, download: boolean): string {
  const raw = fileName(key);
  const ascii = raw.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const kind = download || !MEDIA.test(contentType) ? "attachment" : "inline";
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(raw)}`;
}

function refererAllowed(referer: string | null, host: string, allowedOrigins: string): boolean {
  if (!referer) return true;
  let refererHost = "";
  try {
    refererHost = new URL(referer).host.toLowerCase();
  } catch {
    return false;
  }
  if (refererHost === host.toLowerCase()) return true;
  return allowedOrigins
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .some((item) => refererHost === item);
}

function authorized(request: Request, token: string): boolean {
  if (!token) return false;
  const header = request.headers.get("Authorization") || "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (presented.length !== token.length) return false;
  let mismatch = 0;
  for (let i = 0; i < token.length; i++) mismatch |= presented.charCodeAt(i) ^ token.charCodeAt(i);
  return mismatch === 0;
}

function rangeHeader(object: R2ObjectBody): string | null {
  const range = object.range;
  if (!range) return null;
  const offset = "offset" in range && range.offset !== undefined ? range.offset : undefined;
  const length = "length" in range && range.length !== undefined ? range.length : undefined;
  const suffix = "suffix" in range ? range.suffix : undefined;
  if (suffix !== undefined) {
    const start = Math.max(0, object.size - suffix);
    return `bytes ${start}-${object.size - 1}/${object.size}`;
  }
  if (offset === undefined) return null;
  const end = offset + (length ?? object.size - offset) - 1;
  return `bytes ${offset}-${end}/${object.size}`;
}

async function readObject(request: Request, env: Env, key: string): Promise<Response> {
  const url = new URL(request.url);
  const download = url.searchParams.get("download") === "1";
  const hasRange = request.headers.has("Range");
  let object: R2ObjectBody | null;
  try {
    const result = await env.IMAGES.get(key, hasRange ? { range: request.headers } : undefined);
    object = result && "body" in result ? result : null;
  } catch {
    return new Response("Range Not Satisfiable", { status: 416, headers: cors() });
  }
  if (object === null) {
    return new Response("Not Found", { status: 404, headers: cors({ "Cache-Control": "no-store" }) });
  }

  const headers = cors();
  object.writeHttpMetadata(headers);
  const contentType = headers.get("Content-Type") || "application/octet-stream";
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "public, max-age=86400");
  headers.set("Content-Disposition", contentDisposition(key, contentType, download));
  const contentRange = request.headers.has("Range") ? rangeHeader(object) : null;
  if (contentRange) headers.set("Content-Range", contentRange);
  return new Response(request.method === "HEAD" ? null : object.body, {
    status: contentRange ? 206 : 200,
    headers,
  });
}

async function writeObject(request: Request, env: Env, key: string): Promise<Response> {
  if (!authorized(request, env.UPLOAD_TOKEN)) {
    return json({ error: "Unauthorized" }, 401);
  }
  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (contentLength > MAX_UPLOAD_BYTES) {
    return json({ error: "Upload exceeds the 100 MB request limit" }, 413);
  }
  const contentType = request.headers.get("Content-Type") || "";
  if (!ALLOWED_UPLOAD.test(contentType)) {
    return json({ error: "Only image, audio, video, and PDF uploads are allowed" }, 415);
  }
  if (!request.body) return json({ error: "Missing body" }, 400);
  const object = await env.IMAGES.put(key, request.body, {
    httpMetadata: { contentType },
  });
  return json({ key: object?.key ?? key, size: object?.size ?? contentLength, etag: object?.httpEtag ?? "" }, 201);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    const url = new URL(request.url);
    const key = safeKey(url.pathname);
    if (!key) return new Response("Not Found", { status: 404, headers: cors({ "Cache-Control": "no-store" }) });

    if (request.method === "PUT") return writeObject(request, env, key);
    if (request.method === "DELETE") {
      if (!authorized(request, env.UPLOAD_TOKEN)) return json({ error: "Unauthorized" }, 401);
      await env.IMAGES.delete(key);
      return new Response(null, { status: 204, headers: cors() });
    }
    if (request.method === "DELETE") {
      if (!authorized(request, env.UPLOAD_TOKEN)) return json({ error: "Unauthorized" }, 401);
      await env.IMAGES.delete(key);
      console.log(JSON.stringify({ op: "delete", key, status: 204 }));
      return new Response(null, { status: 204, headers: cors() });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: cors() });
    }
    if (!refererAllowed(request.headers.get("Referer"), url.host, env.ALLOWED_ORIGINS || "")) {
      console.log(JSON.stringify({ op: "hotlink", key, status: 403 }));
      return new Response("Hotlink denied", { status: 403, headers: cors({ "Cache-Control": "no-store" }) });
    }
    const download = url.searchParams.get("download") === "1";
    const cacheable =
      request.method === "GET" &&
      !request.headers.has("Range") &&
      !download &&
      request.headers.get("Cache-Control") !== "no-cache";
    const cacheKey = new Request(url.toString(), { method: "GET" });
    if (cacheable) {
      const hit = await caches.default.match(cacheKey);
      if (hit) {
        console.log(JSON.stringify({ op: "get", key, status: hit.status, cache: "hit" }));
        return hit;
      }
    }
    const response = await readObject(request, env, key);
    console.log(JSON.stringify({ op: request.method.toLowerCase(), key, status: response.status }));
    if (cacheable && response.status === 200) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    return response;
  },
} satisfies ExportedHandler<Env>;
