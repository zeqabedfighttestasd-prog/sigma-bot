import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const mode = process.argv[2];

if (mode !== "start" && mode !== "migrate") {
  console.error("Usage: node scripts/local-bot.mjs <start|migrate>");
  process.exit(2);
}

try {
  process.loadEnvFile(path.join(workspaceRoot, ".env"));
} catch {
  console.error(
    "Missing .env file. Copy .env.example to .env and fill in your local values.",
  );
  process.exit(1);
}

const requiredVariables =
  mode === "start" ? ["DISCORD_BOT_TOKEN", "DATABASE_URL"] : ["DATABASE_URL"];
const missingVariables = requiredVariables.filter(
  (name) => !process.env[name]?.trim(),
);

if (missingVariables.length > 0) {
  console.error(`Missing required .env values: ${missingVariables.join(", ")}`);
  process.exit(1);
}

if (mode === "start" && !process.env.PORT) {
  process.env.PORT = "8080";
}

const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const commandArguments =
  mode === "start"
    ? ["--filter", "@workspace/api-server", "run", "dev"]
    : ["--filter", "@workspace/db", "run", "push"];

const child = spawn(packageManager, commandArguments, {
  cwd: workspaceRoot,
  env: process.env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`Could not start pnpm: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`pnpm stopped after receiving ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});