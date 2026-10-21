import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function convertSingleFile(input, output) {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  const filePath = `file:///${path.resolve(__dirname, input).replace(/\\/g, '/')}`;

  await page.goto(filePath, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.pdf({
    path: path.resolve(__dirname, output),
    format: 'A4',
    margin: { top: '0.75in', right: '0.75in', bottom: '0.75in', left: '0.75in' },
    printBackground: true
  });

  await browser.close();
  return output;
}

async function main() {
  try {
    console.log('Generating UPGRADE_PROPOSAL.pdf...');
    await convertSingleFile('UPGRADE_PROPOSAL.html', 'UPGRADE_PROPOSAL.pdf');
    console.log('✓ UPGRADE_PROPOSAL.pdf created');

    console.log('Generating UPGRADE_PROPOSAL_1PAGE.pdf...');
    await convertSingleFile('UPGRADE_PROPOSAL_1PAGE.html', 'UPGRADE_PROPOSAL_1PAGE.pdf');
    console.log('✓ UPGRADE_PROPOSAL_1PAGE.pdf created');

    console.log('\n✓ All PDFs generated successfully!');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();