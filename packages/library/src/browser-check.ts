/**
 * Browser check: open one artifact in Chromium, the way a lesson frames it,
 * and record a browser report plus the desktop thumbnail.
 *
 * The harness does not talk to Supabase. A draft passes a preview URL. A
 * fixture passes its files, which are served here with the artifact headers.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { chromium, type Browser, type ConsoleMessage, type Page, type Request, type Response } from "playwright";
import type { ArtifactManifest } from "@eco/contracts";
import { defaultParams, type BrowserCheckResult, type BrowserFinding, type BrowserReport, type BrowserViewportReport } from "./browser-report";
import type { InMemoryFile } from "./import/types";

export type { BrowserCheckResult, BrowserFinding, BrowserReport, BrowserViewportReport } from "./browser-report";

/** The lesson player gives up after this long. ADR-002. */
export const READY_TIMEOUT_MS = 8000;

const PHONE = { name: "phone", width: 390, height: 844 } as const;
const DESKTOP = { name: "desktop", width: 1280, height: 800 } as const;
const VIEWPORTS = [PHONE, DESKTOP] as const;

const BLOCKING = new Set([
  "ready_timeout",
  "uncaught_exception",
  "console_error",
  "fatal_error",
  "foreign_request",
  "failed_request",
  "missing_webgl",
]);

export interface BrowserCheckInput {
  manifest: ArtifactManifest;
  bundleSha256: string;
  /** Fixture files. The harness serves them. */
  files?: InMemoryFile[];
  /** A draft's signed preview URL. Used when `files` is absent. */
  url?: string;
  /** Defaults to the player's 8 seconds. Tests pass a shorter limit. */
  readyTimeoutMs?: number;
  /**
   * Paths the fixture server accepts and never answers. A page waiting on
   * one of them does not become ready, and the browser stays closeable.
   */
  holdPaths?: string[];
}

interface Served {
  origin: string;
  close(): Promise<void>;
}

export async function runBrowserCheck(input: BrowserCheckInput): Promise<BrowserCheckResult> {
  const timeout = input.readyTimeoutMs ?? READY_TIMEOUT_MS;
  const params = defaultParams(input.manifest);
  const served = input.files ? await serve(input.files, input.holdPaths ?? []) : null;
  const entry = served ? `${served.origin}/${input.manifest.entry}` : input.url;
  if (!entry) throw new Error("runBrowserCheck needs files or a url");
  const origin = new URL(entry).origin;

  const browser = await chromium.launch({ headless: true });
  try {
    const viewports: BrowserViewportReport[] = [];
    let thumbnail: Uint8Array | null = null;
    for (const viewport of VIEWPORTS) {
      const result = await runViewport(browser, { entry, origin, viewport, params, timeout, webgl: input.manifest.rendering.webgl });
      viewports.push(result.report);
      if (viewport.name === "desktop" && result.thumbnail) thumbnail = result.thumbnail;
    }
    const report: BrowserReport = {
      ok: viewports.every((viewport) => viewport.findings.every((finding) => !BLOCKING.has(finding.code))),
      bundleSha256: input.bundleSha256,
      webgl: input.manifest.rendering.webgl,
      params,
      thumbnailPath: null,
      viewports,
    };
    return { report, thumbnail };
  } finally {
    await browser.close();
    if (served) await served.close();
  }
}

async function serve(files: InMemoryFile[], holdPaths: string[]): Promise<Served> {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const held = new Set(holdPaths);
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => respond(req, res, byPath, held, originOf(server)));
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = originOf(server);
  return {
    origin,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

function originOf(server: ReturnType<typeof createServer>): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function respond(
  req: IncomingMessage,
  res: ServerResponse,
  files: Map<string, InMemoryFile>,
  holdPaths: Set<string>,
  origin: string,
): void {
  const pathname = decodeURIComponent(new URL(req.url ?? "/", origin).pathname).replace(/^\//, "");
  if (holdPaths.has(pathname)) return;
  const file = files.get(pathname);
  if (!file) {
    res.writeHead(404, artifactHeaders(origin, "text/plain", 0));
    res.end();
    return;
  }
  const headers = artifactHeaders(origin, file.mime, file.bytes.byteLength);
  res.writeHead(200, headers);
  res.end(file.bytes);
}

/** ADR-001 headers for a fixture file. The artifact origin is this server. */
function artifactHeaders(origin: string, contentType: string, contentLength: number): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Content-Length": String(contentLength),
    "Content-Security-Policy": [
      "sandbox allow-scripts",
      `default-src ${origin}`,
      `script-src ${origin} 'unsafe-inline'`,
      `style-src ${origin} 'unsafe-inline'`,
      `img-src ${origin} data: blob:`,
      `media-src ${origin} data: blob:`,
      `font-src ${origin} data:`,
      `connect-src ${origin}`,
      "frame-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
    ].join("; "),
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "private, no-store",
  };
}

interface ViewportRun {
  report: BrowserViewportReport;
  thumbnail: Uint8Array | null;
}

async function runViewport(
  browser: Browser,
  input: {
    entry: string;
    origin: string;
    viewport: (typeof VIEWPORTS)[number];
    params: Record<string, unknown>;
    timeout: number;
    webgl: boolean;
  },
): Promise<ViewportRun> {
  const context = await browser.newContext({ viewport: { width: input.viewport.width, height: input.viewport.height } });
  await context.addInitScript(() => {
    const created = { webgl: false };
    (window as unknown as { __browserCheck: typeof created }).__browserCheck = created;
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      const result = original.apply(this, [type, ...args] as unknown as [string, CanvasRenderingContext2DSettings?]);
      if ((type === "webgl" || type === "webgl2" || type === "experimental-webgl") && result) created.webgl = true;
      return result;
    } as typeof original;
  });

  const findings: BrowserFinding[] = [];
  const page = await context.newPage();
  const started = Date.now();
  let open = true;
  const note = (finding: BrowserFinding) => {
    if (open) findings.push(finding);
  };
  watch(page, input.origin, note);

  let readyMs: number | null = null;
  let webglCreated = false;
  let heapBytes: number | null = null;
  let frameCount: number | null = null;
  let thumbnail: Uint8Array | null = null;

  try {
    await page.setContent("<!doctype html><html><body></body></html>", { waitUntil: "domcontentloaded" });
    await page.evaluate(installParent, { entry: input.entry, params: input.params, nonce: nonce() });
    readyMs = await waitForReady(page, input.timeout);
    if (readyMs === null) {
      note({ code: "ready_timeout", message: `The page was not ready within ${input.timeout}ms.` });
    } else {
      const frame = page.frames().find((candidate) => candidate.url().startsWith(input.origin));
      if (frame) {
        await frame.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(0))));
        const probe = await frame.evaluate(() => {
          const mark = (window as unknown as { __browserCheck?: { webgl: boolean } }).__browserCheck;
          const memory = (performance as { memory?: { usedJSHeapSize?: number } }).memory;
          return { webgl: !!mark?.webgl, heap: memory?.usedJSHeapSize ?? null };
        });
        webglCreated = probe.webgl;
        heapBytes = probe.heap;
        if (input.webgl && !webglCreated) note({ code: "missing_webgl", message: "The page did not create a WebGL context." });
        if (input.viewport.name === "desktop") thumbnail = await page.locator("iframe").screenshot();
      }
    }
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
    const errors = await page.evaluate(
      () => (window as unknown as { __akErrors?: { fatal: boolean; message: string }[] }).__akErrors ?? [],
    );
    for (const error of errors) note({ code: error.fatal ? "fatal_error" : "ak_error", message: error.message.slice(0, 500) });
  } finally {
    open = false;
    await context.close();
  }

  return {
    thumbnail,
    report: {
      name: input.viewport.name,
      width: input.viewport.width,
      height: input.viewport.height,
      readyMs: readyMs === null ? null : readyMs - started,
      webglCreated,
      heapBytes,
      frameCount,
      findings,
    },
  };
}

function watch(page: Page, origin: string, note: (finding: BrowserFinding) => void): void {
  page.on("pageerror", (error) => note({ code: "uncaught_exception", message: error.message }));
  page.on("console", (message) => note(consoleFinding(message, origin)));
  page.on("response", (response) => {
    const finding = responseFinding(response, origin);
    if (finding) note(finding);
  });
  page.on("requestfailed", (request) => {
    const finding = failedRequestFinding(request, origin);
    if (finding) note(finding);
  });
}

function consoleFinding(message: ConsoleMessage, origin: string): BrowserFinding {
  const text = message.text().slice(0, 500);
  const located = message.location().url;
  if (text.includes("Blocked autofocusing")) return { code: "autofocus", message: text };
  if (isFaviconUrl(located)) return { code: "favicon", message: text };
  if (message.type() === "error" && mentionsForeignOrigin(text, origin)) return { code: "foreign_request", message: text };
  if (message.type() === "error") return { code: "console_error", message: text };
  if (message.type() === "warning") return { code: "console_warn", message: text };
  return { code: "console_log", message: text };
}

function responseFinding(response: Response, origin: string): BrowserFinding | null {
  let url: URL;
  try {
    url = new URL(response.url());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin !== origin) return { code: "foreign_request", message: response.url().slice(0, 500) };
  if (response.status() < 400) return null;
  if (isFavicon(url)) return { code: "favicon", message: `${response.status()} ${url.pathname}` };
  return { code: "failed_request", message: `${response.status()} ${url.pathname}` };
}

function failedRequestFinding(request: Request, origin: string): BrowserFinding | null {
  let url: URL;
  try {
    url = new URL(request.url());
  } catch {
    return null;
  }
  if (url.protocol === "data:" || url.protocol === "blob:") return null;
  if (url.origin === origin) {
    if (isFavicon(url)) return { code: "favicon", message: request.failure()?.errorText ?? url.pathname };
    return { code: "failed_request", message: request.failure()?.errorText ?? url.pathname };
  }
  return { code: "foreign_request", message: request.url() };
}

function mentionsForeignOrigin(text: string, origin: string): boolean {
  const matches = text.match(/https?:\/\/[^\s'")]+/g) ?? [];
  return matches.some((raw) => {
    try {
      return new URL(raw).origin !== origin;
    } catch {
      return false;
    }
  });
}

function isFavicon(url: URL): boolean {
  return url.pathname === "/favicon.ico";
}

function isFaviconUrl(raw: string): boolean {
  try {
    return isFavicon(new URL(raw));
  } catch {
    return false;
  }
}

function nonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function waitForReady(page: Page, timeout: number): Promise<number | null> {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const ready = await page.evaluate(() => (window as unknown as { __akReady?: number }).__akReady ?? null);
    if (ready !== null) return ready;
    await page.waitForTimeout(25);
  }
  return null;
}

/**
 * Parent page. Listens for ArtifactKit messages from the iframe and sends
 * ak-init once the page is ready, matching the lesson player.
 */
function installParent(input: { entry: string; params: Record<string, unknown>; nonce: string }): void {
  const mark = window as unknown as { __akReady?: number };
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.referrerPolicy = "no-referrer";
  frame.style.width = "100%";
  frame.style.height = "min(60vh, 480px)";
  frame.style.border = "0";
  window.addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow) return;
    const data = event.data as { source?: string; v?: number; kind?: string; fatal?: boolean; message?: string };
    if (!data || data.source !== "artifactkit" || data.v !== 1) return;
    if (data.kind === "ak-ready" && mark.__akReady === undefined) mark.__akReady = Date.now();
    if (data.kind === "ak-ready") {
      frame.contentWindow?.postMessage(
        { source: "artifactkit-host", v: 1, kind: "ak-init", nonce: input.nonce, params: input.params, reducedMotion: false },
        "*",
      );
    }
    if (data.kind === "ak-error") {
      const list = (window as unknown as { __akErrors?: { fatal: boolean; message: string }[] }).__akErrors ?? [];
      list.push({ fatal: !!data.fatal, message: String(data.message ?? "") });
      (window as unknown as { __akErrors: typeof list }).__akErrors = list;
    }
  });
  document.body.appendChild(frame);
  frame.src = input.entry;
}
