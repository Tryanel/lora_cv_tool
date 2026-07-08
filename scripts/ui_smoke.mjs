import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5173';
const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:8000';
const screenshotRoot = resolve(process.env.SCREENSHOT_DIR ?? join('logs', 'ui-smoke', stamp()));
const cleanupSceneIds = [];
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
    server.on('error', reject);
  });
}

function findChrome() {
  const found = chromeCandidates.find((candidate) => candidate && existsSync(candidate));
  if (!found) {
    throw new Error('未找到 Chrome/Edge，可通过 CHROME_PATH 指定浏览器路径。');
  }
  return found;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolveMessage, rejectMessage } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) rejectMessage(new Error(message.error.message));
        else resolveMessage(message.result ?? {});
      }
    });
    await new Promise((resolveOpen, rejectOpen) => {
      this.ws.addEventListener('open', resolveOpen, { once: true });
      this.ws.addEventListener('error', rejectOpen, { once: true });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveMessage, rejectMessage) => {
      this.pending.set(id, { resolveMessage, rejectMessage });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rejectMessage(new Error(`CDP timeout: ${method}`));
        }
      }, 15000);
    });
  }

  async eval(fn, ...args) {
    const expression = `(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(',')})`;
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? 'Runtime.evaluate failed');
    }
    return result.result?.value;
  }

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 700
    });
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await this.waitFor(() => document.readyState === 'complete', 15000);
    await sleep(600);
  }

  async waitFor(condition, timeoutMs = 8000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        if (await this.eval(condition)) return true;
      } catch {
        // keep polling while the page settles
      }
      await sleep(150);
    }
    throw new Error('等待页面状态超时');
  }

  async screenshot(name) {
    await sleep(350);
    const result = await this.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      fromSurface: true
    });
    const path = join(screenshotRoot, `${name}.png`);
    await writeFile(path, Buffer.from(result.data, 'base64'));
    console.log(`screenshot ${path}`);
    return path;
  }

  async clickText(text, options = {}) {
    const clicked = await this.eval(
      (targetText, selector, exact, nth) => {
        const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
        const elements = Array.from(document.querySelectorAll(selector));
        const matches = elements.filter((element) => {
          const label = normalize(element.innerText || element.textContent || element.getAttribute('aria-label'));
          return exact ? label === targetText : label.includes(targetText);
        });
        const element = matches[nth ?? 0];
        if (!element) return false;
        element.scrollIntoView({ block: 'center', inline: 'center' });
        element.click();
        return true;
      },
      text,
      options.selector ?? 'button,[role="button"],a,.nav-item,.feature-card,.ant-segmented-item',
      Boolean(options.exact),
      options.nth ?? 0
    );
    await sleep(options.wait ?? 500);
    return clicked;
  }

  async clickByAria(label) {
    const clicked = await this.eval((ariaLabel) => {
      const element = document.querySelector(`[aria-label="${ariaLabel}"]`);
      if (!element) return false;
      element.click();
      return true;
    }, label);
    await sleep(500);
    return clicked;
  }

  async focusInputByPlaceholder(text, value = '') {
    const focused = await this.eval((placeholderText, inputValue) => {
      const inputs = Array.from(document.querySelectorAll('input, textarea'));
      const input = inputs.find((element) => (element.getAttribute('placeholder') ?? '').includes(placeholderText));
      if (!input) return false;
      input.scrollIntoView({ block: 'center', inline: 'center' });
      input.focus();
      if (inputValue) {
        input.value = inputValue;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    }, text, value);
    await sleep(450);
    return focused;
  }

  async focusApiKeyInput() {
    const focused = await this.eval(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const input = inputs.find((element) => element.type === 'password' || (element.getAttribute('placeholder') ?? '').includes('sk-'));
      if (!input) return false;
      input.scrollIntoView({ block: 'center', inline: 'center' });
      input.focus();
      return true;
    });
    await sleep(450);
    return focused;
  }

  async pressEscape() {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(350);
  }

  async mouseMove(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await sleep(650);
  }

  async hoverSelector(selector, nth = 0) {
    const center = await this.eval((targetSelector, targetIndex) => {
      const element = document.querySelectorAll(targetSelector)[targetIndex];
      if (!element) return null;
      element.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, selector, nth);
    if (!center) return false;
    await this.mouseMove(center.x, center.y);
    return true;
  }

  async rects(selectors) {
    return this.eval((targetSelectors) => {
      const rectFor = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          selector,
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom,
          scrollX: window.scrollX,
          scrollY: window.scrollY
        };
      };
      return targetSelectors.map(rectFor);
    }, selectors);
  }

  async measureHoverStability(buttonSelector, monitorSelectors) {
    const buttons = await this.eval((selector) => {
      return Array.from(document.querySelectorAll(selector)).map((element, index) => {
        const rect = element.getBoundingClientRect();
        return { index, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });
    }, buttonSelector);
    if (!buttons.length) return { checked: 0, maxDelta: 0, samples: [] };

    const baseline = await this.rects(monitorSelectors);
    const samples = [];
    let maxDelta = 0;
    for (const button of buttons) {
      await this.mouseMove(button.x, button.y);
      await sleep(180);
      const current = await this.rects(monitorSelectors);
      const deltas = current.map((rect, index) => {
        const base = baseline[index];
        if (!rect || !base) return { selector: monitorSelectors[index], delta: 0 };
        const delta = Math.max(
          Math.abs(rect.left - base.left),
          Math.abs(rect.top - base.top),
          Math.abs(rect.width - base.width),
          Math.abs(rect.height - base.height),
          Math.abs(rect.right - base.right),
          Math.abs(rect.bottom - base.bottom),
          Math.abs(rect.scrollX - base.scrollX),
          Math.abs(rect.scrollY - base.scrollY)
        );
        maxDelta = Math.max(maxDelta, delta);
        return { selector: monitorSelectors[index], delta };
      });
      samples.push({ buttonIndex: button.index, deltas });
    }
    return { checked: buttons.length, maxDelta, samples };
  }

  async viewportScrollState() {
    return this.eval(() => {
      const root = document.scrollingElement || document.documentElement;
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        documentClientWidth: document.documentElement.clientWidth,
        documentClientHeight: document.documentElement.clientHeight,
        viewportScrollbarWidth: Math.max(0, window.innerWidth - document.documentElement.clientWidth),
        scrollTop: root.scrollTop,
        scrollLeft: root.scrollLeft,
        scrollHeight: root.scrollHeight,
        clientHeight: root.clientHeight,
        bodyScrollHeight: document.body.scrollHeight,
        bodyClientHeight: document.body.clientHeight
      };
    });
  }

  async measureHoverScrollbarStability(selectors) {
    const targets = await this.eval((targetSelectors) => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      return targetSelectors.flatMap((selector) => {
        return Array.from(document.querySelectorAll(selector)).map((element, index) => {
          const rect = element.getBoundingClientRect();
          const visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
          if (!visible) return null;
          return {
            selector,
            index,
            x: Math.min(Math.max(rect.left + rect.width / 2, 1), viewportWidth - 2),
            y: Math.min(Math.max(rect.top + rect.height / 2, 1), viewportHeight - 2)
          };
        }).filter(Boolean).slice(0, 4);
      });
    }, selectors);
    if (!targets.length) return { checked: 0, maxViewportScrollbarWidth: 0, maxClientWidthDelta: 0, samples: [] };

    const baseline = await this.viewportScrollState();
    const samples = [];
    let maxViewportScrollbarWidth = baseline.viewportScrollbarWidth;
    let maxClientWidthDelta = 0;
    for (const target of targets) {
      await this.mouseMove(target.x, target.y);
      await sleep(220);
      const current = await this.viewportScrollState();
      const clientWidthDelta = Math.abs(current.documentClientWidth - baseline.documentClientWidth);
      maxViewportScrollbarWidth = Math.max(maxViewportScrollbarWidth, current.viewportScrollbarWidth);
      maxClientWidthDelta = Math.max(maxClientWidthDelta, clientWidthDelta);
      samples.push({
        selector: target.selector,
        index: target.index,
        viewportScrollbarWidth: current.viewportScrollbarWidth,
        clientWidthDelta,
        scrollTopDelta: Math.abs(current.scrollTop - baseline.scrollTop),
        scrollHeightDelta: Math.abs(current.scrollHeight - baseline.scrollHeight)
      });
    }
    return { checked: targets.length, maxViewportScrollbarWidth, maxClientWidthDelta, samples };
  }
}

async function waitForChrome(port) {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) return response.json();
    } catch {
      // Chrome is still booting.
    }
    await sleep(150);
  }
  throw new Error('Chrome 调试端口启动超时');
}

async function createTab(port, url) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!response.ok) throw new Error(`创建 Chrome tab 失败：${response.status}`);
  return response.json();
}

async function assertAppReachable() {
  try {
    await fetch(appUrl, { method: 'GET' });
  } catch {
    throw new Error(`无法访问 ${appUrl}，请先启动前端开发服务。`);
  }
}

async function apiRequest(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API ${path} failed: ${response.status} ${body}`);
  }
  return response.json();
}

async function ensurePromptFixture() {
  try {
    const scenes = await apiRequest('/prompt-scenes');
    const staleFixtures = (scenes.items ?? []).filter((scene) => String(scene.name ?? '').startsWith('ui_smoke_scene'));
    for (const scene of staleFixtures) {
      try {
        await apiRequest(`/prompt-scenes/${scene.id}`, { method: 'DELETE' });
      } catch (error) {
        console.warn(`清理旧 UI smoke 提示词场景失败：${error.message}`);
      }
    }

    const scene = await apiRequest('/prompt-scenes', {
      method: 'POST',
      body: JSON.stringify({
        name: `ui_smoke_scene_${Date.now()}`,
        annotation_level: 'behavior',
        description: 'UI 自动化验收用提示词场景，可用于验证列表、版本、展开行和模态框。'
      })
    });
    await apiRequest('/prompt-versions', {
      method: 'POST',
      body: JSON.stringify({
        scene_id: scene.id,
        version: 'v1',
        prompt_text: '请基于连续道路驾驶帧序列，判断主车前方交通参与者、车道/信号、车辆行为和潜在风险，生成一条适合 SFT 训练的问答样本。',
        notes: 'ui smoke fixture'
      })
    });
    cleanupSceneIds.push(scene.id);
  } catch (error) {
    console.warn(`准备提示词库测试数据失败，继续进行 UI 截图：${error.message}`);
  }
}

async function cleanupPromptFixtures() {
  for (const sceneId of cleanupSceneIds.splice(0)) {
    try {
      await apiRequest(`/prompt-scenes/${sceneId}`, { method: 'DELETE' });
    } catch (error) {
      console.warn(`清理 UI smoke 提示词场景 ${sceneId} 失败：${error.message}`);
    }
  }
}

async function run() {
  await assertAppReachable();
  await ensurePromptFixture();
  await mkdir(screenshotRoot, { recursive: true });

  const chromePath = findChrome();
  const port = await freePort();
  const profileDir = await mkdtemp(join(tmpdir(), 'lora-cv-ui-smoke-'));
  const chrome = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ], { stdio: 'ignore' });

  let client;
  try {
    await waitForChrome(port);
    const tab = await createTab(port, appUrl);
    client = new CdpClient(tab.webSocketDebuggerUrl);
    await client.connect();
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.setViewport(1600, 900);
    await client.navigate(appUrl);

    const screenshots = [];
    screenshots.push(await client.screenshot('01-home'));

    if (!(await client.clickText('标注中心'))) throw new Error('未找到顶部标注中心入口');
    screenshots.push(await client.screenshot('02-jobs-list'));

    await client.focusInputByPlaceholder('搜索任务名', '行为级');
    screenshots.push(await client.screenshot('03-jobs-search-focus'));

    await client.clickText('新增', { exact: true });
    screenshots.push(await client.screenshot('04-job-create-modal'));
    await client.pressEscape();

    await client.clickText('人工审核');
    screenshots.push(await client.screenshot('05-review-task-picker'));

    const openedReview = await client.clickText('进入审核');
    if (openedReview) {
      await client.waitFor(() => Boolean(document.querySelector('.workspace-grid')), 10000);
      screenshots.push(await client.screenshot('06-review-workspace'));
      const hoveredAsset = await client.hoverSelector('.asset-row');
      if (hoveredAsset) screenshots.push(await client.screenshot('07-review-asset-tooltip'));
      const jitter = await client.measureHoverStability(
        '.editor-actions .ant-btn',
        ['.editor-panel', '.image-panel', '.app-header', '.workspace-grid']
      );
      console.log(`hover-jitter ${JSON.stringify(jitter)}`);
      if (jitter.maxDelta > 0.75) {
        throw new Error(`右侧工具按钮 hover 仍存在布局抖动：maxDelta=${jitter.maxDelta}`);
      }
      const scrollbar = await client.measureHoverScrollbarStability([
        '.asset-row',
        '.editor-actions .ant-btn',
        '.message-row .ant-select-selector',
        '.message-row .ant-btn'
      ]);
      console.log(`hover-scrollbar ${JSON.stringify(scrollbar)}`);
      if (scrollbar.maxViewportScrollbarWidth > 0 || scrollbar.maxClientWidthDelta > 0) {
        throw new Error(`hover 后页面级滚动条仍会出现：${JSON.stringify(scrollbar)}`);
      }
      screenshots.push(await client.screenshot('08-editor-actions-hover-stable'));

      await client.setViewport(2048, 1152);
      await client.waitFor(() => Boolean(document.querySelector('.workspace-grid')), 5000);
      const wideScrollbar = await client.measureHoverScrollbarStability([
        '.asset-row',
        '.editor-actions .ant-btn',
        '.message-row .ant-select-selector',
        '.message-row .ant-btn'
      ]);
      console.log(`hover-scrollbar-wide ${JSON.stringify(wideScrollbar)}`);
      if (wideScrollbar.maxViewportScrollbarWidth > 0 || wideScrollbar.maxClientWidthDelta > 0) {
        throw new Error(`2048x1152 hover 后页面级滚动条仍会出现：${JSON.stringify(wideScrollbar)}`);
      }
      screenshots.push(await client.screenshot('08-review-hover-wide-stable'));
      await client.setViewport(1600, 900);
    }

    await client.clickText('提示词库');
    screenshots.push(await client.screenshot('06-prompt-library'));

    await client.clickText('新建场景');
    screenshots.push(await client.screenshot('07-prompt-scene-modal'));
    await client.pressEscape();

    const openedVersion = await client.clickText('添加版本');
    screenshots.push(await client.screenshot(openedVersion ? '08-prompt-version-modal' : '08-prompt-version-empty'));
    if (openedVersion) await client.pressEscape();

    await client.eval(() => {
      const expand = document.querySelector('.prompt-library-panel .ant-table-row-expand-icon:not(.ant-table-row-expand-icon-expanded)');
      if (expand) expand.click();
      return Boolean(expand);
    });
    screenshots.push(await client.screenshot('09-prompt-expanded'));

    await client.clickText('Teacher');
    screenshots.push(await client.screenshot('10-teacher-settings'));

    await client.focusApiKeyInput();
    screenshots.push(await client.screenshot('11-teacher-api-key-focus'));

    await client.clickByAria('隐藏侧边栏');
    screenshots.push(await client.screenshot('12-sidebar-collapsed'));
    await client.mouseMove(4, 180);
    screenshots.push(await client.screenshot('13-sidebar-hover'));
    await client.clickByAria('固定侧边栏');
    screenshots.push(await client.screenshot('14-sidebar-pinned'));

    await client.setViewport(1280, 800);
    await client.navigate(`${appUrl.replace(/#.*$/, '')}#/annotation/jobs`);
    screenshots.push(await client.screenshot('15-responsive-1280-jobs'));

    await client.setViewport(390, 844);
    await client.navigate(`${appUrl.replace(/#.*$/, '')}#/`);
    screenshots.push(await client.screenshot('16-responsive-mobile-home'));
    await client.clickText('标注中心');
    screenshots.push(await client.screenshot('17-responsive-mobile-jobs'));

    console.log(JSON.stringify({ ok: true, appUrl, screenshotRoot, screenshots }, null, 2));
  } finally {
    await cleanupPromptFixtures();
    try {
      if (client) await client.send('Browser.close');
    } catch {
      chrome.kill('SIGKILL');
    }
    await sleep(300);
    if (!chrome.killed) chrome.kill('SIGKILL');
    await rm(profileDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
