import { spawn } from "node:child_process";

const commands = [
  {
    name: "api",
    command: "cmd.exe",
    args: ["/c", "npm", "run", "dev:api"],
  },
  {
    name: "ui",
    command: "cmd.exe",
    args: ["/c", "npm", "run", "dev:ui"],
  },
];

const children = [];
let shuttingDown = false;

function stopAll(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGINT");
    }
  }

  setTimeout(() => process.exit(code), 200);
}

for (const entry of commands) {
  const child = spawn(entry.command, entry.args, {
    stdio: "inherit",
    shell: false,
  });

  children.push(child);

  child.on("exit", (code) => {
    if (!shuttingDown && code && code !== 0) {
      console.error(`[${entry.name}] exited with code ${code}`);
      stopAll(code);
    }
  });
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
