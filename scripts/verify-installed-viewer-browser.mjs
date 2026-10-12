import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

/**
 * UX-E2c2: browser-backed smoke acceptance against actual installed npm binary.
 * Requires separately provisioned Chrome and matching ChromeDriver on the CI
 * runner. Uses native W3C WebDriver and Chrome DevTools Protocol, avoiding
 * runtime/UI dependencies and network downloads inside the artifact harness.
 *
 * Does NOT claim a full WCAG audit or human visual acceptance.
 */
const installed = process.argv[2];
const chrome = process.env.CHROME_BIN;
const driverBinary = process.env.CHROMEDRIVER_BIN;
assert.ok(typeof installed === "string" && path.isAbsolute(installed));
assert.ok(typeof chrome === "string" && chrome.length > 0, "CHROME_BIN required");
assert.ok(typeof driverBinary === "string" && driverBinary.length > 0, "CHROMEDRIVER_BIN required");
const artifacts = path.resolve(process.env.BROWSER_PROOF_DIR || "browser-acceptance-artifacts");
await mkdir(artifacts, { recursive: true });
const token = randomBytes(32).toString("hex");
const binary = path.join(installed, "dist", "product-cli.js");

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const info = server.address();
  assert.ok(info && typeof info !== "string" && info.port > 0);
  await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  return info.port;
}

const viewerPort = await unusedPort();
const driverPort = await unusedPort();
const origin = "http://127.0.0.1:" + viewerPort;
const webdriver = "http://127.0.0.1:" + driverPort;
const env = { ...process.env, ORCH_VIEWER_TOKEN: token, ORCH_VIEWER_PORT: String(viewerPort) };
for (const key of Object.keys(env)) {
  if (key.startsWith("ORCH_") && !["ORCH_VIEWER_TOKEN", "ORCH_VIEWER_PORT"].includes(key)) {
    delete env[key];
  }
}
const viewer = spawn(process.execPath, [binary, "viewer"], {
  env, cwd: installed, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let viewerOutput = "";
let viewerError = "";
viewer.stdout.setEncoding("utf8");
viewer.stderr.setEncoding("utf8");
viewer.stdout.on("data", chunk => { viewerOutput = (viewerOutput + chunk).slice(-8192); });
viewer.stderr.on("data", chunk => { viewerError = (viewerError + chunk).slice(-8192); });
let driver;
let session;

async function http(base, route, method = "GET", payload) {
  const response = await fetch(base + route, {
    method, redirect: "manual",
    headers: payload === undefined ? {} : { "Content-Type": "application/json" },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(7000),
  });
  let data;
  const body = await response.text();
  try { data = JSON.parse(body); }
  catch { data = { value: { error: "invalid response", message: body.slice(0, 500) } }; }
  if (!response.ok || data.value?.error) {
    throw new Error("WebDriver request failed " + method + " " + route + ": "
      + response.status + " " + String(data.value?.message ?? "").slice(0, 500));
  }
  return data;
}
const wd = (method, route, payload) => http(webdriver, route, method, payload);
const api = (method, suffix, payload) => wd(method, "/session/" + session + suffix, payload);
const navigate = async url => api("POST", "/url", { url });
const evaluate = async script => (await api("POST", "/execute/sync", { script, args: [] })).value;
const chromeCommand = async (cmd, params) =>
  (await api("POST", "/goog/cdp/execute", { cmd, params })).value;

async function awaitViewer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (viewer.exitCode !== null || viewer.signalCode !== null) {
      throw new Error("Installed viewer exited unexpectedly: " + viewerError.slice(-300));
    }
    if (viewerOutput.includes('"command": "viewer"')) {
      const response = await fetch(origin + "/viewer", { signal: AbortSignal.timeout(4000) });
      if (response.status === 200) return;
    }
    await delay(100);
  }
  throw new Error("Installed viewer HTTP readiness timed out");
}

async function awaitDriver() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (driver.exitCode !== null || driver.signalCode !== null) {
      throw new Error("ChromeDriver exited before ready");
    }
    try {
      const result = await wd("GET", "/status");
      if (result.value?.ready === true) return;
    } catch {}
    await delay(100);
  }
  throw new Error("ChromeDriver readiness timed out");
}

async function stopChild(child, label) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + " did not exit")), 7000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    if (!child.kill()) {
      clearTimeout(timer);
      reject(new Error("Unable to stop " + label));
    }
  });
}

async function screenshot(name) {
  const data = await api("GET", "/screenshot");
  assert.ok(typeof data.value === "string" && data.value.length > 50);
  await writeFile(path.join(artifacts, name + ".png"), Buffer.from(data.value, "base64"));
}

const result = {
  slice: "M18E-UX-E2c2",
  platform: process.platform,
  installedCliUsed: true,
  chromeHeadless: false,
  realBrowserLogin: false,
  accessibleLandmarks: false,
  keyboardFocus: false,
  desktopResponsive: false,
  mobileResponsive: false,
  evidenceUnavailabilityLabeled: false,
  passiveContentOnly: false,
  screenshots: [],
  humanVisualReviewPending: true,
  fullWcagAuditComplete: false,
  serviceInstalled: false,
  daemonStarted: false,
  releaseAuthorized: false,
};

try {
  await awaitViewer();
  driver = spawn(driverBinary, ["--port=" + driverPort, "--allowed-ips=127.0.0.1"], {
    stdio: "ignore", windowsHide: true,
  });
  await awaitDriver();
  const created = await wd("POST", "/session", {
    capabilities: { alwaysMatch: {
      browserName: "chrome",
      "goog:chromeOptions": { binary: chrome, args: [
        "--headless=new", "--no-sandbox", "--disable-gpu",
        "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check",
        "--window-size=1280,900",
      ] },
    } },
  });
  session = created.value?.sessionId ?? created.sessionId;
  assert.ok(typeof session === "string" && session.length > 4);
  result.chromeHeadless = true;

  await navigate(origin + "/viewer");
  const loginForm = await evaluate("return {title:document.title,main:!!document.querySelector('main'),"
    + "input:document.querySelector('input#local-token')?.type,"
    + "label:document.querySelector('label[for=local-token]')?.innerText,buttons:document.querySelectorAll('button').length};");
  assert.equal(loginForm.main, true);
  assert.equal(loginForm.input, "password");
  assert.match(loginForm.label, /Local viewing token/);
  assert.equal(loginForm.buttons, 1);

  const found = await api("POST", "/element", { using: "css selector", value: "#local-token" });
  const element = found.value["element-6066-11e4-a52e-4f735466cecf"];
  assert.ok(element);
  await api("POST", "/element/" + element + "/value", { text: token });
  const typed = await evaluate("return document.querySelector('#local-token')?.value?.length;");
  assert.equal(typed, token.length, "ChromeDriver did not enter the complete local viewing token");
  const button = await api("POST", "/element", { using: "css selector", value: "button" });
  const buttonId = button.value["element-6066-11e4-a52e-4f735466cecf"];
  await api("POST", "/element/" + buttonId + "/click", {});
  // A genuine browser form POST can navigate asynchronously after WebDriver
  // click returns. Await the exact server success page and HttpOnly cookie;
  // the previous immediate body assertion raced page navigation in Chrome 155.
  let acknowledged = false;
  let observedPage = "login";
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = await evaluate("return {url:location.pathname,"
      + "body:document.body.innerText.slice(0,600),"
      + "loginForm:document.querySelector('form')!==null};");
    if (state.body.includes("Signed in")) {
      acknowledged = true;
      break;
    }
    observedPage = state.loginForm ? "login_form" : String(state.url);
    if (!state.loginForm && /Sign in failed|Forbidden|Action unavailable/.test(state.body)) {
      observedPage = "authentication_rejected";
      break;
    }
    await delay(100);
  }
  assert.ok(acknowledged,
    "Browser did not reach signed-in response after form submission; last page class: " + observedPage);
  const cookies = (await api("GET", "/cookie")).value;
  const sessionCookie = cookies.find(c => c.name === "orch_viewer");
  assert.ok(sessionCookie && sessionCookie.httpOnly && sessionCookie.sameSite === "Strict");
  result.realBrowserLogin = true;

  await navigate(origin + "/viewer");
  const semantic = await evaluate("return {"
    + "title:document.title,"
    + "headings:[...document.querySelectorAll('h1')].map(x=>x.innerText),"
    + "main:document.querySelectorAll('main').length,"
    + "nav:document.querySelector('nav[aria-label=\"Dashboard sections\"]')!==null,"
    + "skip:document.querySelector('a.skip')?.getAttribute('href'),"
    + "sourceText:document.querySelector('#sources')?.innerText,"
    + "actions:document.querySelectorAll('form,button,input,select,textarea,script,iframe').length,"
    + "remoteLinks:[...document.querySelectorAll('a[href]')].filter(x=>!x.getAttribute('href').startsWith('#')).length,"
    + "passwordVisible:document.body.innerText.includes('" + token + "'),"
    + "csp:document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]')?.content,"
    + "focusable:[...document.querySelectorAll('a[href]')].length"
    + "};");
  assert.match(semantic.title, /Cline Orchestrator/);
  assert.deepEqual(semantic.headings, ["Cline Orchestrator"]);
  assert.equal(semantic.main, 1);
  assert.equal(semantic.nav, true);
  assert.equal(semantic.skip, "#main-content");
  assert.match(semantic.sourceText, /unavailable|stale|source_not_connected/i);
  assert.equal(semantic.actions, 0);
  assert.equal(semantic.remoteLinks, 0);
  assert.equal(semantic.passwordVisible, false);
  assert.match(semantic.csp, /script-src 'none'/);
  assert.ok(semantic.focusable > 2);
  result.evidenceUnavailabilityLabeled = true;
  result.passiveContentOnly = true;

  const ax = await chromeCommand("Accessibility.getFullAXTree", {});
  const roles = (ax.nodes ?? []).map(n => n.role?.value);
  assert.ok(roles.includes("main"), "AX tree missing main landmark");
  assert.ok(roles.includes("navigation"), "AX tree missing navigation landmark");
  assert.ok(roles.includes("heading"), "AX tree missing headings");
  result.accessibleLandmarks = true;

  // WebDriver sends genuine keyboard input rather than injecting click events.
  await chromeCommand("Input.dispatchKeyEvent",
    { type: "rawKeyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await chromeCommand("Input.dispatchKeyEvent",
    { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  const focused = await evaluate("return {href:document.activeElement?.getAttribute('href'),"
    + "focusVisible:document.activeElement?.matches(':focus-visible')};");
  assert.ok(focused.href?.startsWith("#"), "Keyboard must reach a local fragment link");
  assert.equal(focused.focusVisible, true);
  result.keyboardFocus = true;

  async function viewport(width, height, name) {
    await chromeCommand("Emulation.setDeviceMetricsOverride",
      { width, height, deviceScaleFactor: 1, mobile: false });
    await delay(180);
    const metrics = await evaluate("return {width:document.documentElement.clientWidth,"
      + "scroll:document.documentElement.scrollWidth,"
      + "inner:window.innerWidth,"
      + "navVisible:getComputedStyle(document.querySelector('.contents')).display!=='none',"
      + "status:document.querySelector('[role=status]')?.innerText,"
      + "inert:document.querySelectorAll('form,button,input,script').length"
      + "};");
    assert.ok(Math.abs(metrics.inner - width) < 12, "Viewport width mismatch");
    assert.ok(metrics.scroll <= metrics.width + 3,
      "Root page overflows horizontally at " + width + "px");
    assert.equal(metrics.navVisible, true);
    assert.match(metrics.status, /unknown/i);
    assert.equal(metrics.inert, 0);
    await screenshot(name);
    result.screenshots.push(name + ".png");
    return metrics;
  }
  await viewport(1280, 900, "dashboard-desktop");
  result.desktopResponsive = true;
  await viewport(390, 844, "dashboard-mobile");
  result.mobileResponsive = true;

  // Browser page-scale smoke is not equivalent to a full 200% zoom/a11y audit.
  await chromeCommand("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  await screenshot("dashboard-pagescale-2x");
  result.screenshots.push("dashboard-pagescale-2x.png");
} catch (error) {
  // Persist diagnostics even on browser failure. Never persist the viewing
  // token, session cookie, raw input value, daemon state or full page HTML.
  const diagnostic = {
    stage: "browser_acceptance",
    error: error instanceof Error ? error.message.replaceAll(token, "[redacted]") : "unknown",
    browserSessionCreated: Boolean(session),
    viewerExitedUnexpectedly: viewer.exitCode !== null,
  };
  if (session) {
    try {
      const state = await evaluate("return {path:location.pathname,"
        + "title:document.title,"
        + "main:!!document.querySelector('main'),"
        + "loginForm:!!document.querySelector('form'),"
        + "passwordFieldLength:document.querySelector('#local-token')?.value?.length??0};");
      Object.assign(diagnostic, { page: state });
      await screenshot("browser-failure");
    } catch {
      diagnostic.browserStateUnavailable = true;
    }
  }
  await writeFile(path.join(artifacts, "failure-diagnostic.json"),
    JSON.stringify(diagnostic, null, 2) + "\n");
  throw error;
} finally {
  if (session) {
    try { await api("DELETE", ""); } catch {}
  }
  await stopChild(driver, "ChromeDriver");
  await stopChild(viewer, "installed viewer");
}
await writeFile(path.join(artifacts, "acceptance.json"), JSON.stringify(result, null, 2) + "\n");
assert.equal(result.realBrowserLogin, true);
assert.equal(result.desktopResponsive, true);
assert.equal(result.mobileResponsive, true);
assert.equal(result.passiveContentOnly, true);
console.log(JSON.stringify(result));
