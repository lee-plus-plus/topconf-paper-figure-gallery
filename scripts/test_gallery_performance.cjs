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
      window.viewTransitionCalls = 0;
      if (document.startViewTransition) {
        const start = document.startViewTransition.bind(document);
        document.startViewTransition = update => {
          window.viewTransitionCalls++;
          return start(async () => {
          const t = performance.now();
          await update();
          window.transitionTimings.push(performance.now() - t);
          });
        };
      }
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('.card-img').naturalWidth > 0);
    if (!baseline) {
      await page.locator('#venue-filter').selectOption('icml');
      await page.locator('#year-filter').selectOption('2024');
      assert.ok(await page.locator('.card').count() > 0);
      assert.ok((await page.locator('.card-badges').allTextContents()).every(t => t.includes('ICML') && t.includes('2024')));
      await page.locator('#tier-filter').selectOption('oral');
      assert.ok(await page.locator('.card').count() > 0);
      assert.equal(await page.locator('.card:not(.is-oral)').count(), 0);
      await page.locator('#lang-toggle').click();
      assert.equal(await page.locator('#tier-filter').inputValue(), 'oral');
      await page.reload();
      assert.equal(await page.locator('#venue-filter').inputValue(), 'icml');
      assert.equal(await page.locator('#year-filter').inputValue(), '2024');
      await page.goto(url);
      await page.locator('.card-title').first().click();
      assert.ok(await page.locator('#lightbox').evaluate(el => el.hidden));
      assert.equal(await page.locator('.card-title').first().evaluate(el => getComputedStyle(el).cursor), 'text');
      for (const selector of ['.card-link-open', '.card-link-paper']) {
        const link = page.locator(selector).first();
        assert.equal(await link.evaluate(el => getComputedStyle(el).cursor), 'pointer');
        const expected = await link.evaluate(el => el.href);
        await page.context().route(expected, route => route.fulfill({contentType: 'text/html', body: 'Link target verified'}));
        const popupPromise = page.waitForEvent('popup');
        await link.click();
        const popup = await popupPromise;
        await popup.waitForLoadState();
        assert.equal(popup.url(), expected);
        assert.ok(await page.locator('#lightbox').evaluate(el => el.hidden));
        await popup.close();
        await page.context().unroute(expected);
      }
      await page.locator('.card-link-image').first().focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.querySelector('#lightbox').hidden && !document.documentElement.dataset.figureTransition);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('#lightbox').hidden && !document.documentElement.dataset.figureTransition);
    }
    const opening = await page.evaluate(() => {
      document.querySelector('.card .img-slot').click();
      return {
        visible: !document.querySelector('#lightbox').hidden,
        effects: document.querySelector('#lightbox').getAnimations({ subtree: true })
          .map(animation => animation.effect.getKeyframes().map(frame => Object.keys(frame))),
      };
    });
    if (!baseline) {
      assert.equal(opening.visible, true, 'Opening must show the preview synchronously, without decode waits');
      assert.equal(opening.effects.length, 2, 'Only the dialog and backdrop should animate');
      const allowed = new Set(['offset', 'computedOffset', 'easing', 'composite', 'transform', 'opacity']);
      assert.ok(opening.effects.flat(2).every(key => allowed.has(key)), 'Opening must not animate layout or paint properties');
    }
    await page.waitForFunction(() => !document.querySelector('#lightbox').hidden && !document.documentElement.dataset.figureTransition);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'lb-close');
    if (!baseline) assert.equal(await page.evaluate(() => document.querySelector('#lightbox').getAnimations({ subtree: true }).length), 0);

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
      await page.locator('.card .img-slot').first().click();
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
    await page.locator('.card .img-slot').first().click();
    await page.waitForFunction(() => !document.querySelector('#lightbox').hidden && !document.documentElement.dataset.figureTransition);
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('#lightbox').hidden && !document.documentElement.dataset.figureTransition);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.card .img-slot').first().click();
    await page.waitForFunction(() => !document.querySelector('#lightbox').hidden);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.figureTransition), undefined);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#lightbox').hidden);
    if (!baseline) {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('.card .img-slot').first().click();
      await page.waitForFunction(() => !document.documentElement.dataset.figureTransition);
      const rect = await page.locator('.lightbox-dialog').boundingBox();
      assert.ok(rect.x >= 0 && rect.x + rect.width <= 391, 'Mobile dialog must fit the screen');
      assert.equal(await page.evaluate(() => document.querySelector('#lightbox').getAnimations({ subtree: true }).length), 0);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('#lightbox').hidden && !document.documentElement.dataset.figureTransition);
      assert.equal(await page.evaluate(() => window.viewTransitionCalls), 0, 'Lightbox must not capture document snapshots');
    }
    if (!baseline) {
      const extremes = await page.evaluate(() => {
        const list = [...FIGURES].filter(f => f.w && f.h).sort((a,b) => a.w/a.h-b.w/b.h);
        return [list[0].id, list[list.length-1].id];
      });
      const checkImageBounds = async () => {
        const bounds = await page.evaluate(() => {
          const rect = s => { const r = document.querySelector(s).getBoundingClientRect(); return {top:r.top,bottom:r.bottom,height:r.height}; };
          return {image:rect('#lb-img'), wrap:rect('.lightbox-img-wrap'), content:rect('.lightbox-content'), dialog:rect('.lightbox-dialog')};
        });
        assert.ok(bounds.content.height <= bounds.dialog.height + 1, 'Content must stay inside the dialog');
        assert.ok(bounds.image.top >= bounds.wrap.top - 1 && bounds.image.bottom <= bounds.wrap.bottom + 1, 'Image must stay inside its visible area');
        assert.ok(Math.abs((bounds.image.top+bounds.image.bottom)-(bounds.wrap.top+bounds.wrap.bottom)) <= 2, 'Image must remain vertically centered');
      };
      for (const viewport of [{width:1440,height:900},{width:1280,height:600},{width:390,height:844},{width:320,height:568}]) {
        await page.setViewportSize(viewport);
        for (const id of extremes) {
          await page.goto(url + '#f=' + id);
          await page.waitForFunction(() => !document.querySelector('#lightbox').hidden && !document.documentElement.dataset.figureTransition);
          await checkImageBounds();
          const next = page.locator('#lb-next');
          if (await next.isVisible()) {
            await next.click();
            await page.waitForFunction(() => !document.documentElement.dataset.figureTransition);
            await checkImageBounds();
          }
        }
      }
      console.log('PASS: tall/wide image centering and next-image layout at desktop/mobile sizes');
    }
    assert.deepEqual(errors, []);
    console.log('PASS: open, next/prev, slow/hung decode, close, infinite scroll, shared URL, Back, reduced motion');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
