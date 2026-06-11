/**
 * Inspect the actual SLOT_MODEL inside the playable iframe AFTER upload,
 * to compare what the iframe sees vs what the CLI parser extracts.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const PORT = 5201;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const FIXTURES = [
  `${process.env.HOME}/Desktop/GDD/Gates_of_Olympus_1000_GDD.pdf`,
  `${process.env.HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`,
  `${process.env.HOME}/Desktop/GDD/Starlight_Travellers_GDD.pdf`,
  `${process.env.HOME}/Desktop/GDD/Wrath_of_Olympus_GDD.pdf`,
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

for (const pdf of FIXTURES) {
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.setInputFiles('#fileInput', pdf);
  await page.waitForSelector('#previewFrame', { timeout: 20000 });
  let frame = null;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const cands = page.frames();
    frame = cands.find(f => f !== page.mainFrame());
    if (frame) {
      const ready = await frame.evaluate(() => !!document.querySelector('#spinBtn')).catch(() => false);
      if (ready) break;
      frame = null;
    }
  }
  const data = await frame.evaluate(() => {
    const allChips = Array.from(document.querySelectorAll('.ufp-chip[data-ufp-kind]'))
      .map(c => c.getAttribute('data-ufp-kind'));
    const bonusBuyChip = !!document.querySelector('.bb-chip,#bbBtn,#bonusBuyBtn,.bonus-buy-chip,.bb-toggle,#bonusBuyToggle,.bonus-buy');
    const anteBetChip = !!document.querySelector('.ante-btn,#anteBtn,[data-ante],#anteBetToggle,.ante-bet');
    return {
      ufpChips: allChips,
      bonusBuyChip, anteBetChip,
      reels: window.REELS, rows: window.ROWS,
      shape: window.SHAPE,
      FS: window.FREESPINS,
      parsedFeatures: window.__SLOT_MODEL_FEATURES__ || null,
      modelName: window.__SLOT_MODEL_NAME__ || null,
      symbols: window.__SLOT_MODEL_SYMBOLS__ || null,
    };
  });
  console.log('\n===', pdf.split('/').pop(), '===');
  console.log(' name                :', data.modelName);
  console.log(' shape               :', data.shape ? `${data.shape.kind} ${data.shape.reels}×${data.shape.rows}` : 'n/a');
  console.log(' symbols             :', data.symbols);
  console.log(' parsed features     :', (data.parsedFeatures || []).map(f => f.kind || f).join(', '));
  console.log(' UFP chips rendered  :', data.ufpChips.join(', '));
  console.log(' bonus_buy own chip  :', data.bonusBuyChip);
  console.log(' ante_bet  own chip  :', data.anteBetChip);
  // Coverage diff. 'feature_generic' is the parser's catch-all label
  // for un-classified mentions; genericFeatureBanner handles it as a
  // post-spin banner, not a force chip. Exclude from coverage check.
  const NON_FORCEABLE = new Set(['feature_generic', 'reality_check', 'autoplay',
                                  'win_cap', 'session_timeout']);
  const parsedKinds = new Set((data.parsedFeatures || []).map(f => f.kind || f)
    .filter(k => !NON_FORCEABLE.has(k)));
  const chipKinds   = new Set(data.ufpChips);
  if (data.bonusBuyChip) chipKinds.add('bonus_buy');
  if (data.anteBetChip)  chipKinds.add('ante_bet');
  // 'big_win' is always-include — not a parser feature
  chipKinds.delete('big_win');
  const missing = [...parsedKinds].filter(k => !chipKinds.has(k));
  const extra   = [...chipKinds].filter(k => !parsedKinds.has(k));
  console.log(' missing chips       :', missing.length ? missing.join(', ') : 'none');
  console.log(' extra phantom chips :', extra.length ? extra.join(', ') : 'none');
}

server.kill();
await browser.close();
