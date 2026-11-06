const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { parseArgs } = require("node:util");

const root = path.resolve(__dirname, "..");

function collectModules(outputFile) {
  if (path.extname(outputFile) !== ".js" || !fs.statSync(outputFile).isFile()) {
    throw new Error("Upload requires a built JavaScript entry file");
  }
  return Object.fromEntries(
    fs
      .readdirSync(path.dirname(outputFile), { withFileTypes: true })
      .filter((file) => file.isFile() && /\.(js|wasm)$/.test(file.name))
      .map((file) => {
        const content = fs.readFileSync(path.join(path.dirname(outputFile), file.name));
        return file.name.endsWith(".wasm")
          ? [file.name, { binary: content.toString("base64") }]
          : [file.name.slice(0, -3), content.toString("utf8")];
      }),
  );
}

async function upload(
  {
    destination,
    outputFile = path.join(root, "dist/main.js"),
    configFile = path.join(root, "screeps.json"),
  },
  { fetch = globalThis.fetch } = {},
) {
  if (!destination) throw new Error("An explicit --destination is required");
  let destinations;
  try {
    destinations = JSON.parse(fs.readFileSync(configFile, "utf8"));
  } catch {
    throw new Error("Cannot read Screeps destination configuration");
  }
  if (!destinations || !Object.hasOwn(destinations, destination)) {
    throw new Error("Unknown Screeps destination");
  }
  const config = destinations[destination];
  if (!config || typeof config.branch !== "string" || !config.branch.trim()) {
    throw new Error("Screeps destination requires a branch");
  }
  let token = config.token;
  if (token !== undefined && (typeof token !== "string" || !token.trim())) {
    throw new Error("Invalid Screeps authentication token");
  }
  if (
    !token &&
    !(
      typeof config.email === "string" &&
      config.email &&
      typeof config.password === "string" &&
      config.password
    )
  ) {
    throw new Error("Screeps destination requires a token or email/password");
  }
  let base;
  try {
    const protocol = config.protocol || "https";
    if (!["http", "https"].includes(protocol)) throw new Error();
    base = new URL(`${protocol}://${config.hostname || "screeps.com"}`);
    if (base.username || base.password || base.pathname !== "/" || base.search || base.hash)
      throw new Error();
    if (config.port !== undefined) {
      if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
        throw new Error();
      base.port = String(config.port);
    }
    if (config.path !== undefined && typeof config.path !== "string") throw new Error();
    base.pathname = "/" + (config.path || "").replace(/^\/+|\/+$/g, "");
    if (!base.pathname.endsWith("/")) base.pathname += "/";
  } catch {
    throw new Error("Invalid Screeps server configuration");
  }
  const branch =
    config.branch === "auto"
      ? execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim()
      : config.branch;
  if (!branch) throw new Error("Cannot determine the upload branch");
  const modules = collectModules(path.resolve(outputFile));

  async function request(method, endpoint, body) {
    let response;
    try {
      response = await fetch(new URL(`api/${endpoint}`, base), {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "X-Token": token, "X-Username": token } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      // Never print request bodies or server responses: they may contain credentials.
      throw new Error(`Screeps ${method} ${endpoint}: request failed`);
    }
    if (!response.ok) throw new Error(`Screeps ${method} ${endpoint}: HTTP ${response.status}`);
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(`Screeps ${method} ${endpoint}: invalid JSON response`);
    }
    if (data?.ok !== 1 || data.error)
      throw new Error(`Screeps ${method} ${endpoint}: API rejected request`);
    token = response.headers.get("x-token") || token;
    return data;
  }

  if (!token) {
    const auth = await request("POST", "auth/signin", {
      email: config.email,
      password: config.password,
    });
    if (typeof auth.token !== "string" || !auth.token)
      throw new Error("Screeps authentication returned no token");
    token = auth.token;
  }
  const branches = await request("GET", "user/branches");
  if (!Array.isArray(branches.list)) throw new Error("Screeps returned an invalid branch list");
  if (branches.list.some((item) => item.branch === branch)) {
    await request("POST", "user/code", { branch, modules });
  } else {
    await request("POST", "user/clone-branch", {
      branch: "",
      newName: branch,
      defaultModules: modules,
    });
  }
  return { branch, moduleCount: Object.keys(modules).length };
}

if (require.main === module) {
  async function main() {
    const { values } = parseArgs({
      options: {
        destination: { type: "string" },
        output: { type: "string", default: path.join(root, "dist/main.js") },
        config: { type: "string", default: path.join(root, "screeps.json") },
      },
    });
    const result = await upload({
      destination: values.destination,
      outputFile: values.output,
      configFile: values.config,
    });
    console.log(`Uploaded ${result.moduleCount} module(s) to branch ${result.branch}`);
  }
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { collectModules, upload };
