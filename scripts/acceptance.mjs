import { readFileSync } from "node:fs";

const drive = process.env.DRIVE_URL || "https://davflare-8fq.pages.dev";
const images = "https://personal-drive-img.pages.dev";
const privateR2 = "https://pub-7bae8271294e48a8ad0546796ccada6b.r2.dev/";
const vars = Object.fromEntries(
  readFileSync(new URL("../.dev.vars", import.meta.url), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    })
);
const basic = `Basic ${Buffer.from(`${vars.WEBDAV_USERNAME}:${vars.WEBDAV_PASSWORD}`).toString("base64")}`;
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function call(url, options = {}) {
  const response = await fetch(url, options);
  const body = Buffer.from(await response.arrayBuffer());
  return { status: response.status, headers: response.headers, body, text: body.toString("utf8") };
}

const anon = await call(`${drive}/webdav/`, { method: "PROPFIND", headers: { Depth: "1" } });
check("WebDAV anonymous denied", anon.status === 401, String(anon.status));

const listing = await call(`${drive}/webdav/`, {
  method: "PROPFIND",
  headers: { Authorization: basic, Depth: "1" },
});
check("WebDAV PROPFIND", listing.status === 207, String(listing.status));

const source = `${drive}/webdav/${encodeURIComponent("测试.txt")}`;
const put = await call(source, {
  method: "PUT",
  headers: { Authorization: basic, "Content-Type": "text/plain; charset=utf-8" },
  body: "你好，网盘",
});
check("Chinese filename upload", put.status === 201 || put.status === 204, String(put.status));

const got = await call(source, { headers: { Authorization: basic } });
check("Chinese filename download", got.status === 200 && got.text === "你好，网盘", `${got.status} ${got.text}`);

const anonFile = await call(source);
check("Private file stays private", anonFile.status === 401, String(anonFile.status));

const renamed = `${drive}/webdav/${encodeURIComponent("重命名.txt")}`;
const moved = await call(source, {
  method: "MOVE",
  headers: { Authorization: basic, Destination: renamed, Overwrite: "T" },
});
check("WebDAV rename", moved.status === 201 || moved.status === 204, String(moved.status));
const renamedGet = await call(renamed, { headers: { Authorization: basic } });
check("Renamed file readable", renamedGet.status === 200 && renamedGet.text === "你好，网盘", String(renamedGet.status));

const share = await call(`${drive}/api/shares`, {
  method: "POST",
  headers: { Authorization: basic, "Content-Type": "application/json" },
  body: JSON.stringify({ key: "重命名.txt", expiresInHours: 1, extractCode: "pass" }),
});
let shareJson = {};
try { shareJson = JSON.parse(share.text); } catch { /* reported below */ }
check("Private share created", share.status === 200 && Boolean(shareJson.token), String(share.status));
const landing = shareJson.url ? await call(shareJson.url) : { status: 0, text: "" };
check("Share landing is public", landing.status === 200, String(landing.status));
const locked = shareJson.url ? await call(`${shareJson.url}?download=1`) : { status: 0, text: "" };
check(
  "Share extract code required",
  locked.text !== "你好，网盘" && locked.text.includes("<form"),
  String(locked.status)
);
const unlocked = shareJson.url ? await call(`${shareJson.url}?download=1&code=pass`) : { status: 0, text: "" };
check("Share download with code", unlocked.status === 200 && unlocked.text === "你好，网盘", String(unlocked.status));
if (shareJson.token) {
  const revoked = await call(`${drive}/api/shares?token=${shareJson.token}`, {
    method: "DELETE",
    headers: { Authorization: basic },
  });
  const after = await call(shareJson.url);
  check("Revoked share denied", revoked.status === 204 && after.status === 404, `${revoked.status}/${after.status}`);
}

const folder = `${drive}/webdav/${encodeURIComponent("目录")}/`;
const mkcol = await call(folder, { method: "MKCOL", headers: { Authorization: basic } });
check("WebDAV folder create", mkcol.status === 201 || mkcol.status === 405, String(mkcol.status));

const keyRes = await call(`${drive}/api/keys`, {
  method: "POST",
  headers: { Authorization: basic, "Content-Type": "application/json" },
  body: JSON.stringify({ name: "acceptance", expiresInHours: 1 }),
});
let keyJson = {};
try { keyJson = JSON.parse(keyRes.text || "{}"); } catch { keyJson = {}; }
const chunkPath = "分片上传.txt";
const created = await call(`${drive}/api/upload?uploads&path=${encodeURIComponent(chunkPath)}`, {
  method: "POST",
  headers: { "X-Api-Key": keyJson.key || "", "Content-Type": "text/plain" },
});
let createdJson = {};
try { createdJson = JSON.parse(created.text || "{}"); } catch { createdJson = {}; }
const part = await call(
  `${drive}/api/upload?path=${encodeURIComponent(chunkPath)}&uploadId=${encodeURIComponent(createdJson.uploadId || "")}&partNumber=1`,
  { method: "PUT", headers: { "X-Api-Key": keyJson.key || "" }, body: "chunk-ok" }
);
let partJson = {};
try { partJson = JSON.parse(part.text || "{}"); } catch { partJson = {}; }
const complete = await call(
  `${drive}/api/upload?path=${encodeURIComponent(chunkPath)}&uploadId=${encodeURIComponent(createdJson.uploadId || "")}`,
  {
    method: "POST",
    headers: { "X-Api-Key": keyJson.key || "", "Content-Type": "application/json" },
    body: JSON.stringify({ parts: [{ partNumber: partJson.partNumber, etag: partJson.etag }] }),
  }
);
const chunked = await call(`${drive}/webdav/${encodeURIComponent(chunkPath)}`, { headers: { Authorization: basic } });
check(
  "Chunked upload",
  created.status === 201 && part.status === 200 && (complete.status === 200 || complete.status === 201) && chunked.text === "chunk-ok",
  `${created.status}/${part.status}/${complete.status}/${chunked.status}`
);

const imageKey = encodeURIComponent("图.png");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const deniedUpload = await call(`${images}/${imageKey}`, {
  method: "PUT",
  headers: { "Content-Type": "image/png" },
  body: png,
});
check("Public upload requires token", deniedUpload.status === 401, String(deniedUpload.status));
const uploaded = await call(`${images}/${imageKey}`, {
  method: "PUT",
  headers: { Authorization: `Bearer ${vars.UPLOAD_TOKEN}`, "Content-Type": "image/png" },
  body: png,
});
check("Image upload", uploaded.status === 201, String(uploaded.status));
const image = await call(`${images}/${imageKey}`, {
  headers: { Origin: "https://davflare-8fq.pages.dev", "Cache-Control": "no-cache" },
});
check(
  "Image inline headers",
  image.status === 200 &&
    image.headers.get("content-type")?.startsWith("image/png") &&
    image.headers.get("content-disposition")?.startsWith("inline") &&
    image.headers.get("accept-ranges") === "bytes" &&
    image.headers.get("cache-control")?.includes("max-age=86400") &&
    image.headers.get("access-control-allow-origin") === "*",
  `${image.status} ${image.headers.get("content-type")} ${image.headers.get("content-disposition")}`
);
const ranged = await call(`${images}/${imageKey}`, { headers: { Range: "bytes=0-3" } });
check(
  "Image range",
  ranged.status === 206 && ranged.headers.get("content-range")?.startsWith("bytes 0-3/"),
  `${ranged.status} ${ranged.headers.get("content-range")}`
);
const videoKey = encodeURIComponent("播放.mp4");
await call(`${images}/${videoKey}`, {
  method: "PUT",
  headers: { Authorization: `Bearer ${vars.UPLOAD_TOKEN}`, "Content-Type": "video/mp4" },
  body: Buffer.from("0123456789playback"),
});
const video = await call(`${images}/${videoKey}`, { headers: { Range: "bytes=0-3" } });
check(
  "Video range playback headers",
  video.status === 206 && video.headers.get("content-type") === "video/mp4" && video.headers.get("accept-ranges") === "bytes",
  `${video.status} ${video.headers.get("content-type")} ${video.headers.get("content-range")}`
);
const hotlink = await call(`${images}/${imageKey}`, { headers: { Referer: "https://evil.example/page" } });
check("Hotlink blocked", hotlink.status === 403, String(hotlink.status));
const allowed = await call(`${images}/${imageKey}`, {
  headers: { Referer: "https://davflare-8fq.pages.dev/", "Cache-Control": "no-cache" },
});
check("Drive origin allowed", allowed.status === 200, String(allowed.status));
const download = await call(`${images}/${imageKey}?download=1`);
check("Direct download disposition", download.headers.get("content-disposition")?.startsWith("attachment"), download.headers.get("content-disposition") || "");
const badType = await call(`${images}/bad.exe`, {
  method: "PUT",
  headers: { Authorization: `Bearer ${vars.UPLOAD_TOKEN}`, "Content-Type": "application/octet-stream" },
  body: Buffer.from("MZ"),
});
check("Upload type restricted", badType.status === 415, String(badType.status));
const closed = await call(privateR2);
check("Private r2.dev stays disabled", closed.status !== 200, String(closed.status));

const oversizedSize = 100 * 1024 * 1024 + 1024;
const chunk = Buffer.alloc(1024 * 1024);
let sent = 0;
const oversizedBody = new ReadableStream({
  pull(controller) {
    if (sent >= oversizedSize) {
      controller.close();
      return;
    }
    const count = Math.min(chunk.length, oversizedSize - sent);
    controller.enqueue(chunk.subarray(0, count));
    sent += count;
  },
});
let oversizedStatus = 0;
try {
  const oversized = await fetch(`${drive}/webdav/oversized.bin`, {
    method: "PUT",
    headers: {
      Authorization: basic,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(oversizedSize),
    },
    body: oversizedBody,
    duplex: "half",
  });
  oversizedStatus = oversized.status;
  await oversized.arrayBuffer();
} catch (error) {
  oversizedStatus = 0;
  console.log(`oversized transport: ${error instanceof Error ? error.message : error}`);
}
check("WebDAV over 100 MB rejected", oversizedStatus === 413, String(oversizedStatus));
await call(`${drive}/webdav/oversized.bin`, { method: "DELETE", headers: { Authorization: basic } });

await call(renamed, { method: "DELETE", headers: { Authorization: basic } });
await call(`${drive}/webdav/${encodeURIComponent(chunkPath)}`, { method: "DELETE", headers: { Authorization: basic } });
await call(folder, { method: "DELETE", headers: { Authorization: basic } });
if (keyJson.id) {
  await call(`${drive}/api/keys?id=${keyJson.id}`, { method: "DELETE", headers: { Authorization: basic } });
}
await call(`${images}/${imageKey}`, { method: "DELETE", headers: { Authorization: `Bearer ${vars.UPLOAD_TOKEN}` } });
await call(`${images}/${videoKey}`, { method: "DELETE", headers: { Authorization: `Bearer ${vars.UPLOAD_TOKEN}` } });

const failed = results.filter((item) => !item.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
