// Run with Playwright installed: node scripts/test_gallery_performance.cjs
// --baseline serves HEAD's app/CSS for an optional before/after comparison.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const baseline = process.argv.includes('--baseline');
const originals = new Map(baseline ? ['assets/app.js', 'assets/style.css'].map(file =>
  [file, execFileSync('git', ['show', `HEAD:${file}`], { cwd: root })]) : []);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try {
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(originals.get(relative) || fs.readFileSync(file));
  } catch { res.writeHead(404).end(); }
});

(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.cardLoadListeners = 0;
      const add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function(type, ...args) {
        if (type === 'load' && this instanceof HTMLImageElement && this.classList.contains('card-img')) window.cardLoadListeners++;
        return add.call(this, type, ...args);
      };
      window.transitionTimings = [];
      if (document.startViewTransition) {
        const start = document.startViewTransition.bind(document);
        document.startViewTransition = update => start(async () => {
          const t = performance.now();
          await update();
          window.transitionTimings.push(performance.now() - t);
        });
      }
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('.card-img').naturalWidth > 0);
    await page.locator('.card').first().click();
    await page.waitForFunction(() => !document.querySelector('#lightbox').hidden && !document.documentElement.dataset.figureTransition);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'lb-close');

    // Simulate a slow decoder independently of network/cache speed.
    await page.evaluate(() => {
      window.originalDecode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function() { return new Promise(resolve => setTimeout(resolve, 900)); };
      window.transitionTimings = [];
    });
    const previous = await page.locator('#lb-title').textContent();
    const started = Date.now();
    await page.locator('#lb-next').click();
    await page.waitForFunction(title => document.querySelector('#lb-title').textContent !== title && !document.documentElement.dataset.figureTransition, previous);
    const slowStepMs = Date.now() - started;
    const frozenCallbackMs = await page.evaluate(() => Math.max(0, ...window.transitionTimings));
    console.log(JSON.stringify({ mode: baseline ? 'baseline' : 'fixed', slowStepMs, frozenCallbackMs }));
    if (!baseline) {
      assert.ok(slowStepMs < 750, 'Slow decode must not lock navigation for 900ms');
      assert.ok(frozenCallbackMs < 100, 'Snapshot callback must not wait for decoding');
    }
    await page.locator('#lb-prev').click();
    await page.waitForFunction(title => document.querySelector('#lb-title').textContent === title && !document.documentElement.dataset.figureTransition, previous);
    await page.evaluate(() => { HTMLImageElement.prototype.decode = window.originalDecode; });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#lightbox').hidden && !document.documentElement.dataset.figureTransition);
    assert.equal(await page.evaluate(() => document.body.style.overflow), '');
    assert.equal(await page.evaluate(() => location.hash), '');

    // Repeat with a decoder that never settles: timeout must still leave Close usable.
    if (!baseline) {
      await page.evaluate(() => { HTMLImageElement.prototype.decode = () => new Promise(() => {}); });
      await page.locator('.card').first().click();
      await page.waitForFunction(() => !document.querySelector('#lightbox').hidden, null, { timeout: 1000 });
      await page.locator('#lb-close').click();
      await page.waitForFunction(() => document.querySelector('#lightbox').hidden && !document.documentElement.dataset.figureTransition);
      await page.evaluate(() => { HTMLImageElement.prototype.decode = window.originalDecode; });
    }

    // Block requests so listener counts remain measurable on unloaded old images.
    await page.route('**/images/**', route => route.abort());
    await page.reload();
    const initialCards = await page.locator('.card').count();
    for (let i = 0; i < 10 && await page.locator('.card').count() < initialCards + 120; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(150);
    }
    const cards = await page.locator('.card').count();
    const listeners = await page.evaluate(() => window.cardLoadListeners);
    console.log(JSON.stringify({ cards, listeners }));
    assert.ok(cards > initialCards, 'Infinite scroll must append cards');
    if (!baseline) assert.equal(listeners, cards, 'Old cards must not acquire duplicate listeners');
    await page.unroute('**/images/**');
    await page.goto(url + '?v=icml');
    assert.ok(await page.locator('.card').count() > 0);
    const id = await page.locator('.card').first().getAttribute('data-id');
    await page.goto(url + '?v=icml#f=' + id);
    await page.waitForFunction(() => !document.querySelector('#lightbox').hidden && !document.documentElement.dataset.figureTransition);
    await page.goto(url);
    await page.locator('.card').first().click();
    await page.waitForFunction(() => !document.querySelector('#lightbox').hidden && !document.documentElement.dataset.figureTransition);
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('#lightbox').hidden && !document.documentElement.dataset.figureTransition);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.card').first().click();
    await page.waitForFunction(() => !document.querySelector('#lightbox').hidden);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.figureTransition), undefined);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#lightbox').hidden);
    assert.deepEqual(errors, []);
    console.log('PASS: open, next/prev, slow/hung decode, close, infinite scroll, shared URL, Back, reduced motion');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
