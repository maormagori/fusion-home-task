import { chromium } from 'playwright';

const BASE_URL = process.argv[2];
const OUT_DIR = process.argv[3];
const FEEDBACK =
  'Love the new dashboard, it is fast. Please add a dark mode and a CSV export of reports, I need them every week.';

const overlayScript = () => {
  window.addEventListener('DOMContentLoaded', () => {
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    cursor.style.cssText =
      'position:fixed;z-index:99999;width:18px;height:18px;border-radius:50%;background:rgba(220,40,40,.85);' +
      'border:2px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.4);pointer-events:none;left:40px;top:40px;' +
      'transition:left .6s ease,top .6s ease;transform:translate(-50%,-50%)';
    const caption = document.createElement('div');
    caption.id = 'demo-caption';
    caption.style.cssText =
      'position:fixed;z-index:99998;left:50%;bottom:28px;transform:translateX(-50%);background:rgba(15,15,25,.88);' +
      'color:#fff;font:600 20px system-ui;padding:10px 20px;border-radius:10px;pointer-events:none;max-width:80%;text-align:center';
    document.body.append(cursor, caption);
  });
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_EXE });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 800 } },
});
await context.addInitScript(overlayScript);
const page = await context.newPage();

const pause = (ms) => page.waitForTimeout(ms);
const caption = (text) => page.evaluate((t) => (document.getElementById('demo-caption').textContent = t), text);

async function glideTo(locator) {
  const box = await locator.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.evaluate(([cx, cy]) => {
    const c = document.getElementById('demo-cursor');
    c.style.left = cx + 'px';
    c.style.top = cy + 'px';
  }, [x, y]);
  await pause(700);
}

async function clickLikeHuman(locator) {
  await locator.scrollIntoViewIfNeeded();
  await glideTo(locator);
  await locator.click();
  await pause(400);
}

async function submitFeedback() {
  const textarea = page.locator('#feedback-content');
  await clickLikeHuman(textarea);
  await textarea.pressSequentially(FEEDBACK, { delay: 25 });
  await pause(500);
  await clickLikeHuman(page.getByRole('button', { name: 'Submit' }));
}

await page.goto(BASE_URL);
await caption('Feedback Insights: submit feedback, an LLM turns it into validated JSON');
await pause(2500);

await caption('Submit feedback that contains feature requests');
await submitFeedback();
await caption('Stored as RECEIVED and queued for async analysis');
await pause(2000);

const row = page.locator('.feedback-row').first();
await caption('Worker claims it: ANALYZING (the UI polls every 2s)');
await row.locator('[data-status="ANALYZING"], [data-status="DONE"]').waitFor({ timeout: 60000 });
await pause(1500);
await row.locator('[data-status="DONE"]').waitFor({ timeout: 120000 });
await caption('DONE: the output passed Zod validation');
await pause(1500);

await caption('Open the detail: sentiment, feature requests with confidence, insight, attempts');
await clickLikeHuman(row);
await pause(4000);
await clickLikeHuman(page.getByText(/^Attempts \(/));
await caption('Every LLM call is stored as an attempt, with its raw response');
await pause(3500);

await caption('Submit the same text again: deduplicated by content hash, no new analysis');
await page.locator('#feedback-content').fill('');
await submitFeedback();
await pause(3500);

await caption('Fastify + SQLite + local Ollama (qwen2.5:7b-instruct)');
await pause(2000);

await context.close();
await browser.close();
