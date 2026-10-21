import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Renders the 2-page executive summary to a one-off PDF. Paths are resolved
// relative to this script, so it works from any working directory and on any
// machine -- the previous version hardcoded an absolute local path.
const INPUT = 'UPGRADE_PROPOSAL_1PAGE.html';
const OUTPUT = 'SUMMARY.pdf';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  const filePath = `file:///${path.resolve(__dirname, INPUT).replace(/\\/g, '/')}`;
  await page.goto(filePath, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.pdf({
    path: path.resolve(__dirname, OUTPUT),
    format: 'A4',
    margin: { top: '0.75in', right: '0.75in', bottom: '0.75in', left: '0.75in' },
    printBackground: true
  });
  await browser.close();
  console.log(`✓ ${OUTPUT} created`);
})();
