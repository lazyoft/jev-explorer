import { chromium } from 'playwright';
import type { Browser, BrowserContext, Frame, Locator, Page } from 'playwright';
import { readPage, stackOrder } from './page-script.js';
import { blocked } from '../domain/errors.js';
import type { Action, Observation, TextBlock } from '../domain/types.js';

const ACTION_LIMIT = 400;
const TEXT_LIMIT = 300;
const ACTION_TIMEOUT = 5000;

export async function launchBrowser(headed: boolean): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: process.env.JEV_LOCALE ?? 'en-US' });
  context.setDefaultTimeout(ACTION_TIMEOUT);
  const page = await context.newPage();
  page.on('dialog', dialog => void dialog.dismiss().catch(() => {}));
  return { browser, context, page };
}

export async function goto(page: Page, url: string) {
  const address = new URL(url);
  if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password) {
    throw blocked('INVALID_URL', 'Use an http or https address without a user name or a password in it.');
  }
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
}

async function frameStackOrder(frame: Frame): Promise<number> {
  let top = 0;
  for (let current: Frame | null = frame; current?.parentFrame(); current = current.parentFrame()) {
    const element = await current.frameElement().catch(() => null);
    if (!element) break;
    const own = await element.evaluate(stackOrder).catch(() => 0);
    if (own > top) top = own;
  }
  return top;
}

export async function readObservation(page: Page): Promise<Observation> {
  const found: { action: Action; base: number; z: number }[] = [];
  const blocks: { text: TextBlock; base: number; z: number }[] = [];
  let busy = false;
  let scrollable = false;
  let scrollableUp = false;
  const frames = page.frames();
  for (const [index, frame] of frames.entries()) {
    const raw = await frame.evaluate(readPage, { actions: ACTION_LIMIT, texts: TEXT_LIMIT }).catch(() => null);
    if (!raw) continue;
    busy ||= raw.busy;
    if (index === 0) { scrollable = raw.scrollable; scrollableUp = raw.scrollableUp; }
    const base = index === 0 ? 0 : await frameStackOrder(frame);
    for (const { z, ...item } of raw.actions) found.push({ action: { ...item, ref: index + ':' + item.ref, frame: index }, base, z });
    for (const { z, ...item } of raw.texts) blocks.push({ text: { ...item, ref: index + ':' + item.ref, frame: index }, base, z });
  }
  const topFirst = (left: { base: number; z: number }, right: { base: number; z: number }) => right.base - left.base || right.z - left.z;
  found.sort(topFirst);
  blocks.sort(topFirst);
  const actions: Action[] = found.slice(0, ACTION_LIMIT).map(entry => entry.action);
  const texts: TextBlock[] = blocks.slice(0, TEXT_LIMIT).map(entry => entry.text);
  if (scrollable) actions.push({ ref: 'scroll', kind: 'scroll', onScreen: true, role: 'page', name: 'scroll further down this page', context: '', frame: 0 });
  if (scrollableUp) actions.push({ ref: 'scroll-up', kind: 'scroll', onScreen: true, role: 'page', name: 'scroll back up this page', context: '', frame: 0 });
  const main = frames[0];
  if (main && page.url() !== 'about:blank') {
    const canGoBack = await main.evaluate(() => history.length > 1).catch(() => false);
    if (canGoBack) actions.push({ ref: 'back', kind: 'back', onScreen: true, role: 'page', name: 'go back to the previous page', context: '', frame: 0 });
  }
  if (page.context().pages().filter(other => !other.isClosed()).length > 1) {
    actions.push({ ref: 'close-tab', kind: 'close-tab', onScreen: true, role: 'page', name: 'close this tab and return to the previous one', context: '', frame: 0 });
  }
  const title = await page.title().catch(() => '');
  if (title) texts.unshift({ ref: 'title', role: 'title', text: title, context: page.url(), frame: 0 });
  return { url: page.url(), title, busy, actions, texts };
}

function locate(page: Page, action: Action): Locator {
  const frame: Frame | undefined = page.frames()[action.frame];
  if (!frame) throw blocked('STALE_PAGE', 'The part of the page that held this control is gone. Look at the page again.');
  const local = action.ref.slice(action.ref.indexOf(':') + 1);
  return frame.locator(`[data-jev-ref="${local}"]`);
}

export async function perform(page: Page, action: Action, value?: string): Promise<void> {
  if (action.kind === 'scroll') { await page.mouse.wheel(0, action.ref === 'scroll-up' ? -700 : 700); return; }
  if (action.kind === 'back') { await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {}); return; }
  if (action.kind === 'close-tab') {
    if (page.context().pages().filter(other => !other.isClosed()).length > 1) await page.close();
    return;
  }
  const locator = locate(page, action);
  if (await locator.count() !== 1) throw blocked('STALE_CONTROL', 'The chosen control is no longer on the page. Look at the page again.');
  if (action.kind === 'click') {
    await locator.click({ timeout: ACTION_TIMEOUT }).catch(() => {
      throw blocked('CLICK_BLOCKED', 'Something lying over the page caught the click. Look at the page again.');
    });
  }
  else if (action.kind === 'type') {
    const wanted = value ?? '';
    await locator.fill('', { timeout: ACTION_TIMEOUT });
    await locator.pressSequentially(wanted, { timeout: ACTION_TIMEOUT, delay: 30 });
    if ((await readBack(page, action) ?? '').trim() !== wanted.trim()) await locator.fill(wanted, { timeout: ACTION_TIMEOUT });
  }
  else if (action.kind === 'select') await locator.selectOption({ label: value ?? '' }, { timeout: ACTION_TIMEOUT });
  else if (action.kind === 'check') await locator.check({ timeout: ACTION_TIMEOUT });
  else if (action.kind === 'uncheck') await locator.uncheck({ timeout: ACTION_TIMEOUT });
}

export async function readBack(page: Page, action: Action): Promise<string | null> {
  const locator = locate(page, action);
  if (await locator.count() !== 1) return null;
  return locator.evaluate(node => {
    if (node instanceof HTMLSelectElement) return Array.from(node.selectedOptions).map(option => option.label).join(', ');
    if (node instanceof HTMLInputElement) return node.type === 'checkbox' || node.type === 'radio' ? String(node.checked) : node.value;
    if (node instanceof HTMLTextAreaElement) return node.value;
    return node.getAttribute('aria-checked') ?? (node.textContent ?? '').replace(/\s+/g, ' ').trim();
  }, undefined, { timeout: ACTION_TIMEOUT }).catch(() => null);
}

export async function settle(page: Page, ms: number) {
  await page.waitForLoadState('domcontentloaded', { timeout: ms }).catch(() => {});
  await page.waitForTimeout(Math.min(ms, 400));
}
