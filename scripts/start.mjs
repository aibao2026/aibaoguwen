import { spawn, spawnSync } from "node:child_process";
import net from "node:net";

const apiPort = 3001;
const webPort = 4173;
const host = "127.0.0.1";
const children = [];

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function assertPortFree(port, label) {
  if (await isPortOpen(port)) {
    throw new Error(`${label} port ${port} is already in use. Stop that process first.`);
  }
}

function run(name, command, args, env = {}) {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    shell: false,
    stdio: ["inherit", "pipe", "pipe"],
  });
  children.push(child);
  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.once("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      shutdown(code);
    }
  });
  return child;
}

function runOnce(name, command, args) {
  const result = spawnSync(command, args, {
    shell: false,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${name} failed with code ${result.status ?? 1}.`);
  }
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  process.exit(code);
}

async function waitForPort(port, label) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (await isPortOpen(port)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not start on port ${port}.`);
}

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));

try {
  await assertPortFree(apiPort, "API");
  await assertPortFree(webPort, "Web");
  runOnce("web build", "npm", ["run", "build"]);
  run("api", "npm", ["run", "api"]);
  run("web", "npm", ["run", "preview"]);
  await waitForPort(apiPort, "API");
  await waitForPort(webPort, "Web");
  console.log(`\nAI保顾问已启动: http://${host}:${webPort}/\n按 Ctrl+C 停止。`);
  if (process.platform === "darwin") {
    spawn("open", [`http://${host}:${webPort}/`], { stdio: "ignore", detached: true }).unref();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  shutdown(1);
}
