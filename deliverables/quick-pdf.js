import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('file:///F:/Projects/Websites/Oak%20Hill/deliverables/UPGRADE_PROPOSAL_1PAGE.html');
  await page.pdf({ path: 'SUMMARY.pdf', format: 'A4', margin: { top: '0.75in', right: '0.75in', bottom: '0.75in', left: '0.75in' }, printBackground: true });
  await browser.close();
  console.log('✓ SUMMARY.pdf created');
})();
