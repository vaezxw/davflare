import { readFileSync } from "node:fs";

const toml = readFileSync(`${process.env.APPDATA}/xdg.config/.wrangler/config/default.toml`, "utf8");
const token = toml.match(/oauth_token\s*=\s*"([^"]+)"/)[1];
const vars = Object.fromEntries(
  readFileSync(".dev.vars", "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    })
);
const response = await fetch(
  "https://api.cloudflare.com/client/v4/accounts/13f26964f627b8ae3c54aeefea9f5d61/pages/projects/davflare",
  {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      deployment_configs: {
        production: {
          env_vars: {
            WEBDAV_USERNAME: { type: "plain_text", value: vars.WEBDAV_USERNAME },
            WEBDAV_PASSWORD: { type: "secret_text", value: vars.WEBDAV_PASSWORD },
            WEBDAV_PUBLIC_READ: { type: "plain_text", value: "0" },
          },
          r2_buckets: { BUCKET: { name: "personal-drive" } },
        },
      },
    }),
  }
);
const json = await response.json();
const env = json.result?.deployment_configs?.production?.env_vars || {};
const summary = Object.entries(env)
  .map(([key, value]) => `${key}:${value.type}${value.type === "plain_text" ? `:${value.value}` : ""}`)
  .join(" ");
console.log(response.status, json.success, summary);
if (!json.success) console.log(JSON.stringify(json.errors));
process.exitCode = json.success ? 0 : 1;
