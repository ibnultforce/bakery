/**
 * Screenshots of a page as it would be published, for Claude to look at its own design
 * (edit-page.js's design review). The site is built with the proposed page in place
 * (build.js --proposal, the same build the Twinstack web app previews with), served from
 * a loopback port so its links and clean URLs work, and photographed in headless Chrome
 * at a computer's and a phone's width, one screen at a time, top to bottom.
 *
 * Nothing in the site is touched: the build goes to a folder inside .git (or a dot
 * folder that's removed afterwards), and the web app's own preview and dist/ stay as
 * they are, because this runs inside the job that holds the site's lock.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from './content.js';
import { findChrome, launch } from './render-check.js';

// A computer and a phone, each one screen high: 100vh stays a real screen's height.
export const REVIEW_SCREENS = [
  { width: 1280, height: 900, label: 'a computer, 1280 px wide' },
  { width: 390, height: 844, label: 'a phone, 390 px wide' },
];
// Screens per width: a longer page is shown at evenly spaced points, first and last included.
const MAX_SHOTS = 10;
const BUILD_TIMEOUT_MS = 180000;
const SHOOT_TIMEOUT_MS = 120000;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Where the review builds: inside .git when it's a folder (never a change), else a dot folder. */
function workDir() {
  const git = path.join(ROOT, '.git');
  try {
    if (fs.statSync(git).isDirectory()) return { dir: path.join(git, 'twinstack-design-review'), temporary: false };
  } catch {}
  return { dir: path.join(ROOT, '.twinstack-design-review'), temporary: true };
}

/** Runs build.js with the proposal into `out`, without the base path (the server serves it at /). */
function build(proposalFile, out) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, NODE_ENV: 'production', BASE_PATH: '' };
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts/build.js'), `--proposal=${proposalFile}`, `--out=${out}`], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    const timer = setTimeout(() => child.kill(), BUILD_TIMEOUT_MS);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`the build failed: ${output.trim().split('\n').slice(-3).join(' ').slice(0, 300)}`));
    });
  });
}

/** A static server for the built site on a free loopback port, with GitHub Pages' clean URLs. */
function serve(root) {
  const server = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      pathname = '/';
    }
    const candidates = pathname.endsWith('/') ? [`${pathname}index.html`] : [pathname, `${pathname}.html`, `${pathname}/index.html`];
    for (const candidate of candidates) {
      const file = path.resolve(root, `.${candidate}`);
      if (!file.startsWith(root + path.sep)) break;
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
        return;
      }
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** The page's screens at one width, top to bottom, as base64 JPEGs. */
async function shoot(client, url, screen) {
  await client.send('Emulation.setDeviceMetricsOverride', { width: screen.width, height: screen.height, deviceScaleFactor: 1, mobile: screen.width < 600 });
  // Entrance animations are written motion-safe, so with reduced motion everything is in place.
  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const loaded = client.once('Page.loadEventFired');
  await client.send('Page.navigate', { url });
  await Promise.race([loaded, sleep(20000)]);
  await client.evaluate('Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 8000))]).then(() => true)');
  // Scrolled through once, so anything a script reveals on scroll is shown, then images settle.
  await client.evaluate(`(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 400) { scrollTo(0, y); await new Promise(r => setTimeout(r, 50)); } scrollTo(0, 0); return true; })()`).catch(() => {});
  await client.evaluate(`Promise.race([Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))), new Promise(r => setTimeout(r, 8000))]).then(() => true)`).catch(() => {});
  await client.evaluate('(() => { document.getAnimations().forEach(a => { try { a.finish(); } catch {} }); return true; })()').catch(() => {});
  const height = await client.evaluate('document.documentElement.scrollHeight');
  const last = Math.max(0, height - screen.height);
  const count = Math.min(MAX_SHOTS, Math.max(1, Math.ceil(height / screen.height)));
  const positions = count === 1 ? [0] : Array.from({ length: count }, (_, i) => Math.round((last * i) / (count - 1)));
  const shots = [];
  for (const y of positions) {
    await client.evaluate(`(() => { scrollTo(0, ${y}); return true; })()`);
    await sleep(250);
    const res = await client.send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
    if (res.result?.data) shots.push({ y, data: res.result.data });
  }
  return { ...screen, pageHeight: height, shots };
}

/**
 * Builds the site with `proposal` ({ file, content, files }) in place and photographs the page
 * at the address the build gives it (its .proposal.json `url`) at each REVIEW_SCREENS width.
 * Resolves to { ran: true, screens: [{ width, height, label, pageHeight, shots: [{ y, data }] }] }
 * or { ran: false, reason } when there's no browser or something failed. Never throws.
 */
export async function screenshotProposal(proposal) {
  if (typeof WebSocket === 'undefined') return { ran: false, reason: 'this Node has no built-in WebSocket (Node 22 or later has one)' };
  const chrome = findChrome();
  if (!chrome) return { ran: false, reason: 'no Chrome or Chromium was found (install one, or set CHROME_PATH)' };
  const { dir, temporary } = workDir();
  const out = path.join(dir, 'site');
  const proposalFile = path.join(dir, 'proposal.json');
  let server = null;
  let client = null;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(proposalFile, JSON.stringify({ ...proposal, createdAt: new Date().toISOString() }));
    await build(path.relative(ROOT, proposalFile), path.relative(ROOT, out));
    const built = JSON.parse(fs.readFileSync(path.join(out, '.proposal.json'), 'utf8'));
    if (!built.url) return { ran: false, reason: "the page wasn't in the built site" };
    server = await serve(out);
    const url = `http://127.0.0.1:${server.address().port}${built.url}`;
    const timer = new Promise((_, reject) => setTimeout(() => reject(new Error(`taking the screenshots took over ${SHOOT_TIMEOUT_MS / 1000} seconds`)), SHOOT_TIMEOUT_MS).unref());
    const screens = await Promise.race([timer, (async () => {
      client = await launch(chrome);
      const list = [];
      for (const screen of REVIEW_SCREENS) list.push(await shoot(client, url, screen));
      return list;
    })()]);
    return { ran: true, screens };
  } catch (error) {
    return { ran: false, reason: error.message };
  } finally {
    client?.close();
    server?.close();
    // The build stays inside .git for a look afterwards; a dot folder in the site is removed.
    if (temporary) setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }, 1000).unref();
  }
}
