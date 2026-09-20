import { chromium } from 'playwright';
import type { Browser, BrowserContext, Frame, Locator, Page } from 'playwright';
import { readPage } from './page-script.js';
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

export async function readObservation(page: Page): Promise<Observation> {
  const actions: Action[] = [];
  const texts: TextBlock[] = [];
  let busy = false;
  const frames = page.frames();
  for (const [index, frame] of frames.entries()) {
    if (actions.length >= ACTION_LIMIT && texts.length >= TEXT_LIMIT) break;
    const raw = await frame.evaluate(readPage, { actions: ACTION_LIMIT - actions.length, texts: TEXT_LIMIT - texts.length }).catch(() => null);
    if (!raw) continue;
    busy ||= raw.busy;
    for (const item of raw.actions) actions.push({ ...item, ref: index + ':' + item.ref, frame: index });
    for (const item of raw.texts) texts.push({ ...item, ref: index + ':' + item.ref, frame: index });
    if (index === 0 && raw.scrollable) actions.push({ ref: 'scroll', kind: 'scroll', role: 'page', name: 'scroll further down this page', context: '', frame: 0 });
  }
  const main = frames[0];
  if (main && page.url() !== 'about:blank') {
    const canGoBack = await main.evaluate(() => history.length > 1).catch(() => false);
    if (canGoBack) actions.push({ ref: 'back', kind: 'back', role: 'page', name: 'go back to the previous page', context: '', frame: 0 });
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
  if (action.kind === 'scroll') { await page.mouse.wheel(0, 700); return; }
  if (action.kind === 'back') { await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {}); return; }
  const locator = locate(page, action);
  if (await locator.count() !== 1) throw blocked('STALE_CONTROL', 'The chosen control is no longer on the page. Look at the page again.');
  if (action.kind === 'click') await locator.click({ timeout: ACTION_TIMEOUT });
  else if (action.kind === 'type') await locator.fill(value ?? '', { timeout: ACTION_TIMEOUT });
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
