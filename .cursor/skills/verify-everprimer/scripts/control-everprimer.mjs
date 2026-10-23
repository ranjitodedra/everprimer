#!/usr/bin/env node
// Drive a verification instance of the Everprimer web app.
// Kills only processes this script started. Leaves artifacts/ in place.

import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO = path.resolve(SKILL_DIR, "../../..");
const RUN = path.join(SKILL_DIR, "run");
const PORT = 4173;
const CDP_PORT = 9333;
const BASE = `http://127.0.0.1:${PORT}`;
const READY_TEXT = "Learning tailored to every child.";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function die(message) {
  console.error(message);
  process.exit(1);
}

async function readPid(name) {
  try {
    const text = await readFile(path.join(RUN, name), "utf8");
    const pid = Number(text.trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function commandOf(pid) {
  try {
    const { stdout } = await exec("ps", ["-p", String(pid), "-o", "command="]);
    return stdout.trim();
  } catch {
    return "";
  }
}

async function descendants(root) {
  const { stdout } = await exec("ps", ["-ax", "-o", "pid=,ppid="]);
  const children = new Map();
  for (const line of stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const list = children.get(ppid) ?? [];
    list.push(pid);
    children.set(ppid, list);
  }
  const out = new Set([root]);
  const stack = [root];
  while (stack.length) {
    const pid = stack.pop();
    for (const child of children.get(pid) ?? []) {
      if (out.has(child)) continue;
      out.add(child);
      stack.push(child);
    }
  }
  return out;
}

async function listeners(port) {
  try {
    const { stdout } = await exec("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
    return [...new Set(stdout.split("\n").map((line) => Number(line.trim())).filter(Boolean))];
  } catch {
    return [];
  }
}

async function fetchText(url) {
  const response = await fetch(url, { redirect: "manual" });
  const text = await response.text();
  return { status: response.status, text };
}

async function launch() {
  await mkdir(RUN, { recursive: true });
  const existing = await readPid("next.pid");
  if (existing && alive(existing)) {
    const command = await commandOf(existing);
    if (!command.includes(String(PORT)) && !command.includes("next")) die(`refusing to launch: pid ${existing} is not our next dev`);
    const ready = await waitReady(5_000).catch(() => false);
    if (ready) {
      console.log(`already running ${BASE}`);
      return;
    }
    die(`pid ${existing} is alive but ${BASE} is not serving the landing page`);
  }

  const owners = await listeners(PORT);
  if (owners.length) die(`refusing to launch: port ${PORT} is already owned by pid ${owners.join(",")}`);

  const log = openSync(path.join(RUN, "next.log"), "w");
  const child = spawn(
    "pnpm",
    ["--filter", "web", "exec", "next", "dev", "--hostname", "127.0.0.1", "--port", String(PORT)],
    {
      cwd: REPO,
      detached: true,
      stdio: ["ignore", log, log],
      env: { ...process.env, BROWSER: "none", EVERPRIMER_VERIFY_DIST: ".next-verify" },
    },
  );
  child.unref();
  await writeFile(path.join(RUN, "next.pid"), `${child.pid}\n`);
  const ready = await waitReady(90_000);
  if (!ready) {
    await stopNext();
    die(`next dev did not serve "${READY_TEXT}" within 90s. See ${path.join(RUN, "next.log")}`);
  }
  console.log(`ready ${BASE}`);
}

async function waitReady(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { status, text } = await fetchText(`${BASE}/`);
      if (status === 200 && text.includes(READY_TEXT)) return true;
    } catch {
      /* still booting */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function doctor() {
  const pid = await readPid("next.pid");
  if (!pid || !alive(pid)) die("doctor: verification next dev is not running. Run launch.");
  const command = await commandOf(pid);
  if (!command.includes("next")) die(`doctor: pid ${pid} is not next (${command})`);
  const tree = await descendants(pid);
  const owners = await listeners(PORT);
  if (!owners.length || !owners.every((owner) => tree.has(owner))) {
    die(`doctor: port ${PORT} is not owned by pid ${pid} (listeners ${owners.join(",") || "none"})`);
  }
  const { status, text } = await fetchText(`${BASE}/`);
  if (status !== 200 || !text.includes(READY_TEXT)) die(`doctor: ${BASE}/ returned ${status} without the landing heading`);
  console.log(`ok ${BASE} pid ${pid} landing`);
}

async function stopNext() {
  const pid = await readPid("next.pid");
  if (pid && alive(pid)) {
    const command = await commandOf(pid);
    if (!command.includes("next") && !command.includes("pnpm")) die(`refusing to kill pid ${pid}: ${command}`);
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      process.kill(pid, "SIGTERM");
    }
    const start = Date.now();
    while (alive(pid) && Date.now() - start < 8_000) await new Promise((resolve) => setTimeout(resolve, 200));
    if (alive(pid)) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        process.kill(pid, "SIGKILL");
      }
    }
  }
  await rm(path.join(RUN, "next.pid"), { force: true });
  await rm(path.join(REPO, "apps/web/.next-verify"), { recursive: true, force: true });
}

async function stopChrome() {
  const pid = await readPid("chrome.pid");
  if (pid && alive(pid)) {
    const command = await commandOf(pid);
    if (!command.includes(`remote-debugging-port=${CDP_PORT}`) || !command.includes(path.join(RUN, "chrome"))) {
      die(`refusing to kill pid ${pid}: not our Chrome`);
    }
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      process.kill(pid, "SIGTERM");
    }
    const start = Date.now();
    while (alive(pid) && Date.now() - start < 5_000) await new Promise((resolve) => setTimeout(resolve, 200));
    if (alive(pid)) process.kill(pid, "SIGKILL");
  }
  await rm(path.join(RUN, "chrome.pid"), { force: true });
  await rm(path.join(RUN, "chrome"), { recursive: true, force: true });
}

async function stop() {
  await stopChrome();
  await stopNext();
  console.log("stopped");
}

async function ensureChrome() {
  await mkdir(RUN, { recursive: true });
  const existing = await readPid("chrome.pid");
  if (existing && alive(existing)) return;
  const owners = await listeners(CDP_PORT);
  if (owners.length) die(`refusing to start Chrome: port ${CDP_PORT} is owned by pid ${owners.join(",")}`);
  const profile = path.join(RUN, "chrome");
  await rm(profile, { recursive: true, force: true });
  const child = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--window-size=1280,900",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  await writeFile(path.join(RUN, "chrome.pid"), `${child.pid}\n`);
  const start = Date.now();
  while (Date.now() - start < 15_000) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (response.ok) return;
    } catch {
      /* booting */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  die("Chrome did not open a DevTools port");
}

async function pageSocket() {
  await ensureChrome();
  const list = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((response) => response.json());
  const page = list.find((entry) => entry.type === "page");
  if (!page?.webSocketDebuggerUrl) die("Chrome has no page target");
  return page.webSocketDebuggerUrl;
}

function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error("DevTools socket failed")));
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  return {
    async send(method, params) {
      await opened;
      const id = ++nextId;
      const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      ws.send(JSON.stringify({ id, method, params }));
      return result;
    },
    close() {
      ws.close();
    },
  };
}

async function withPage(fn) {
  const cdp = connect(await pageSocket());
  try {
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    return await fn(cdp);
  } finally {
    cdp.close();
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) die(result.exceptionDetails.text || "page script failed");
  return result.result?.value;
}

function clickExpression(role, name) {
  return `(() => {
    const role = ${JSON.stringify(role)};
    const name = ${JSON.stringify(name)};
    const implicit = { A: "link", BUTTON: "button", SUMMARY: "summary", H1: "heading", H2: "heading" };
    const nodes = [...document.querySelectorAll("a, button, summary, h1, h2, [role]")];
    const hits = nodes.filter((el) => {
      const found = el.getAttribute("role") || implicit[el.tagName] || "";
      if (found !== role) return false;
      const text = (el.getAttribute("aria-label") || el.innerText || "").replace(/\\s+/g, " ").trim();
      return text === name || text.includes(name);
    });
    if (hits.length !== 1) return { ok: false, hits: hits.map((el) => (el.innerText || "").replace(/\\s+/g, " ").trim()) };
    hits[0].click();
    return { ok: true };
  })()`;
}

async function browser(args) {
  const [command, ...rest] = args;
  if (!command) die("browser needs a command: goto, click, assert, snapshot, screenshot");
  if (command === "goto") {
    const target = rest[0];
    if (!target?.startsWith("/")) die("goto needs a path starting with /");
    await withPage(async (cdp) => {
      await cdp.send("Page.navigate", { url: `${BASE}${target}` });
      const start = Date.now();
      while (Date.now() - start < 20_000) {
        const state = await evaluate(cdp, "({ path: location.pathname, ready: document.readyState, text: document.body ? document.body.innerText.slice(0, 400) : '' })");
        if (state?.path === target && state.ready === "complete" && state.text) {
          console.log(`goto ${target}`);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      die(`goto ${target} did not finish`);
    });
    return;
  }
  if (command === "click") {
    const role = flag(rest, "--role");
    const name = flag(rest, "--name");
    await withPage(async (cdp) => {
      const clicked = await evaluate(cdp, clickExpression(role, name));
      if (!clicked?.ok) die(`click --role ${role} --name ${JSON.stringify(name)} matched ${JSON.stringify(clicked?.hits ?? [])}`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      console.log(`click ${role} ${name}`);
    });
    return;
  }
  if (command === "assert") {
    const text = optionalFlag(rest, "--text");
    const label = optionalFlag(rest, "--aria-label");
    if (!text && !label) die("assert needs --text or --aria-label");
    await withPage(async (cdp) => {
      if (text) {
        const body = await evaluate(cdp, "document.body.innerText");
        if (!String(body).includes(text)) die(`assert --text ${JSON.stringify(text)} failed`);
        console.log(`assert text ${text}`);
      }
      if (label) {
        const found = await evaluate(cdp, `!!document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})`);
        if (!found) die(`assert --aria-label ${JSON.stringify(label)} failed`);
        console.log(`assert aria-label ${label}`);
      }
    });
    return;
  }
  if (command === "snapshot") {
    const file = resolveOut(flag(rest, "--path"));
    await withPage(async (cdp) => {
      const lines = await evaluate(cdp, `(() => {
        const implicit = { A: "link", BUTTON: "button", SUMMARY: "summary", H1: "heading", H2: "heading" };
        const lines = [];
        for (const el of document.querySelectorAll("a, button, summary, h1, h2, [role], [aria-label], [aria-live]")) {
          const role = el.getAttribute("role") || implicit[el.tagName] || (el.hasAttribute("aria-label") ? "label" : el.getAttribute("aria-live") ? "status" : "");
          const name = (el.getAttribute("aria-label") || el.innerText || "").replace(/\\s+/g, " ").trim();
          if (!role || !name) continue;
          const pressed = el.getAttribute("aria-pressed");
          lines.push(pressed ? role + " " + JSON.stringify(name) + " pressed=" + pressed : role + " " + JSON.stringify(name));
        }
        return lines.slice(0, 80).join("\\n");
      })()`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `${lines}\n`);
      console.log(`snapshot ${file}`);
    });
    return;
  }
  if (command === "screenshot") {
    const file = resolveOut(flag(rest, "--path"));
    await withPage(async (cdp) => {
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, Buffer.from(shot.data, "base64"));
      console.log(`screenshot ${file}`);
    });
    return;
  }
  die(`unknown browser command ${command}`);
}

function flag(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) die(`missing ${name}`);
  return args[index + 1];
}

function optionalFlag(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return "";
  if (!args[index + 1]) die(`missing ${name}`);
  return args[index + 1];
}

function resolveOut(file) {
  return path.resolve(file);
}

const [action, ...rest] = process.argv.slice(2);
if (action === "launch") await launch();
else if (action === "doctor") await doctor();
else if (action === "stop") await stop();
else if (action === "browser") await browser(rest);
else die("usage: control-everprimer.mjs launch|doctor|stop|browser ...");
