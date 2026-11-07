// E2E: node tests/e2e.js  (нужен playwright; Supabase и курсы валют подменяются моками)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };

const srv = http.createServer((q, r) => {
  let f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(d); } });
});

// курсы к USD; кросс-курсы считаем через них
const USD = { USD: 1, PLN: 0.25, EUR: 1.1, GBP: 1.25 };
const rate = (a, b) => USD[a] / USD[b];


const FAKE_SB = `
window.__db={settings:null,tx:[]};window.__log=[];
(function(){
  let user=null;const ls=[];
  const emit=(ev)=>ls.forEach(cb=>cb(ev,user?{user}:null));
  window.supabase={createClient:()=>({
    auth:{
      getSession:async()=>({data:{session:user?{user}:null}}),
      onAuthStateChange:cb=>{ls.push(cb);return{data:{subscription:{unsubscribe(){}}}}},
      signInWithPassword:async({email})=>{user={id:'u1',email};setTimeout(()=>emit('SIGNED_IN'),0);return{data:{user,session:{user}},error:null}},
      signUp:async({email,options})=>{window.__log.push(['signUp',options&&options.data]);user={id:'u1',email};setTimeout(()=>emit('SIGNED_IN'),0);return{data:{user,session:{user}},error:null}},
      signOut:async()=>{user=null;emit('SIGNED_OUT');return{error:null}},
      resetPasswordForEmail:async()=>({error:null}),updateUser:async()=>({data:{},error:null})
    },
    rpc:async(n)=>{window.__log.push(['rpc',n]);return{data:n==='is_admin'?false:null,error:null}},
    from:(t)=>{const q={};q.select=()=>q;q.gt=(c,v)=>{q.g=v;return q};q.order=()=>q;q.limit=()=>q;
      q.maybeSingle=()=>Promise.resolve({data:window.__db.settings,error:null});
      q.then=(res,rej)=>Promise.resolve({data:window.__db.tx.filter(r=>r.u>(q.g||0)),error:null}).then(res,rej);
      q.upsert=async(rows)=>{window.__log.push(['upsert',t,JSON.parse(JSON.stringify(rows))]);
        if(t==='settings'){window.__db.settings={data:rows.data,u:rows.u}}
        else rows.forEach(r=>{const i=window.__db.tx.findIndex(x=>x.id===r.id);if(i<0)window.__db.tx.push(r);else window.__db.tx[i]=r});
        return{error:null}};
      return q}
  })};
})();`;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m); } };
const norm = s => (s || '').replace(/[  \s]+/g, ' ').trim();

async function newPage(browser, { rates = true, cfg = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.rateOn = rates; page.rateCalls = 0;
  await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: cfg || 'window.FIN_CONFIG={}' }));
  await page.route(/api\.frankfurter\.(dev|app)/, r => {
    const u = new URL(r.request().url());
    if (!page.rateOn) return r.abort();
    page.rateCalls++;
    const a = u.searchParams.get('base') || u.searchParams.get('from'), b = u.searchParams.get('symbols') || u.searchParams.get('to');
    if (!USD[a] || !USD[b]) return r.fulfill({ status: 404, body: '{}' });
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ base: a, date: '2026-11-05', rates: { [b]: rate(a, b) } }) });
  });
  await page.route(/open\.er-api\.com/, r => r.abort());
  page.errors = errors;
  return page;
}
async function addTx(page, amount, cur, note) {
  await page.click('#addBtn');
  await page.fill('#fAmount', String(amount));
  await page.selectOption('#fCurSel', cur);
  if (note) await page.fill('#fNote', note);
  await page.click('#fSave');
  await page.waitForTimeout(300);
}
const sum = async page => norm(await page.textContent('#sum'));

(async () => {
  await new Promise(r => srv.listen(0, r));
  const base = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch();
  try {
    console.log('1. Ручное добавление в разных валютах');
    let page = await newPage(browser);
    await page.goto(base); await page.waitForSelector('#addBtn');
    ok(/0/.test(await sum(page)), 'пустой итог');
    await page.click('#addBtn');
    ok(await page.locator('#fCurSel').inputValue() === 'USD', 'валюта по умолчанию USD');
    await page.fill('#fAmount', '100'); await page.selectOption('#fCurSel', 'PLN');
    await page.waitForFunction(() => /≈/.test(document.getElementById('fConv').textContent));
    ok(/25,00/.test(norm(await page.textContent('#fConv'))), 'превью конвертации 100 PLN ≈ 25,00 $');
    await page.fill('#fNote', 'Biedronka'); await page.click('#fSave'); await page.waitForTimeout(400);
    ok(/25,00/.test(await sum(page)), 'итог 25,00 в долларах: ' + await sum(page));
    const row = norm(await page.textContent('#list .tx'));
    ok(/100,00/.test(row) && /zł/.test(row) && /≈ 25,00/.test(row), 'строка: 100,00 zł и ≈ 25,00: ' + row);
    ok(/Продукты/.test(row), 'категория угадана: Продукты');
    await addTx(page, 10, 'EUR', 'Hotel');
    ok(/36,00/.test(await sum(page)), 'итог 25 + 11 = 36,00: ' + await sum(page));
    await addTx(page, 5, 'USD', 'Coffee');
    ok(/41,00/.test(await sum(page)), 'итог 41,00 (USD без конвертации): ' + await sum(page));

    console.log('2. Сохранение после перезагрузки');
    await page.reload(); await page.waitForSelector('#list .tx');
    ok(/41,00/.test(await sum(page)), 'итог сохранился');
    ok(await page.locator('#list .tx').count() === 3, '3 траты в списке');

    console.log('3. Правка и удаление');
    await page.locator('#list .tx', { hasText: 'Hotel' }).click();
    await page.fill('#fAmount', '20'); await page.click('#fSave'); await page.waitForTimeout(400);
    ok(/52,00/.test(await sum(page)), 'после правки 25+22+5=52,00: ' + await sum(page));
    await page.locator('#list .tx', { hasText: 'Coffee' }).click();
    page.once('dialog', d => d.accept());
    await page.click('#fDel'); await page.waitForTimeout(300);
    ok(/47,00/.test(await sum(page)) && await page.locator('#list .tx').count() === 2, 'после удаления 47,00, 2 траты');

    console.log('4. Смена основной валюты');
    await page.click('#gear'); await page.selectOption('#sBase', 'EUR'); await page.click('#sClose');
    await page.waitForTimeout(800);
    const s2 = await sum(page);
    ok(/42,73/.test(s2), '47 USD в EUR = 42,73: ' + s2);
    await page.click('#gear'); await page.selectOption('#sBase', 'USD'); await page.click('#sClose'); await page.waitForTimeout(500);
    ok(/47,00/.test(await sum(page)), 'возврат в USD: 47,00');

    console.log('5. Apple Pay по ссылке');
    await page.click('#gear'); await page.selectOption('#sDef', 'PLN'); await page.click('#sClose');
    await page.goto(base + '#add?amount=241,89&merchant=PayU');
    await page.waitForTimeout(800);
    let all = norm(await page.textContent('#list'));
    ok(/241,89/.test(all) && /PayU/.test(all), 'трата 241,89 PayU записана: ' + all.slice(0, 80));
    ok(/zł/.test(norm(await page.textContent('#list .tx:has-text("PayU")'))), 'валюта по умолчанию PLN применена');
    await page.goto(base + '#add?amount=12.5&merchant=Uber&cur=EUR'); await page.waitForTimeout(600);
    ok(/€/.test(norm(await page.textContent('#list .tx:has-text("Uber")'))), 'параметр cur=EUR');
    await page.goto(base + '#add?amount=7.2%20GBP&merchant=Tube'); await page.waitForTimeout(600);
    ok(/£/.test(norm(await page.textContent('#list .tx:has-text("Tube")'))), 'валюта из текста суммы (GBP)');
    ok(!(await page.evaluate(() => location.hash)), 'хеш очищен после записи');
    ok((await page.locator('#list .tx:has-text("PayU")').count()) === 1, 'PayU записан ровно один раз');

    console.log('6. Курс недоступен, потом появляется');
    const p2 = await newPage(browser, { rates: false });
    await p2.goto(base); await p2.waitForSelector('#addBtn');
    await addTx(p2, 100, 'PLN', 'Offline');
    const r2 = norm(await p2.textContent('#list .tx'));
    ok(/курс ожидается/.test(r2), 'без курса: «курс ожидается»');
    ok(/без курса/.test(norm(await p2.textContent('#delta'))), 'подсказка «без курса» наверху');
    p2.rateOn = true;
    await p2.evaluate(() => window.dispatchEvent(new Event('online')));
    await p2.waitForFunction(() => /25,00/.test(document.getElementById('sum').textContent.replace(/\s/g, '')) || /25,00/.test(document.getElementById('sum').textContent), null, { timeout: 8000 }).catch(() => {});
    ok(/25,00/.test(await sum(p2)), 'курс догрузился, итог 25,00: ' + await sum(p2));

    console.log('7. Календарь');
    await page.click('#monthBtn'); await page.waitForTimeout(300);
    ok(await page.locator('#calSheet.on').count() === 1, 'календарь открывается по нажатию на дату');

    console.log('8. Разбор чека (Stokrotka)');
    const texts = JSON.parse(fs.readFileSync(path.join(__dirname, 'receipt-texts.json'), 'utf8'));
    const r = await page.evaluate(t => parseReceipt(t), texts);
    ok(r.amount === 51.5, 'сумма 51,50: ' + r.amount);
    ok(/STOKROTKA/.test(r.note), 'магазин: ' + r.note);
    ok(r.date === '2026-11-05', 'дата: ' + r.date);
    ok(r.cur === 'PLN', 'валюта: ' + r.cur);
    ok(await page.evaluate(() => guessCat('STOKROTKA S.C.')) === 'Продукты', 'категория Продукты');

    console.log('9. Парсинг сумм');
    const pa = await page.evaluate(() => [parseAmount('1 234,56'), parseAmount('1,234.56'), parseAmount('7.2'), parseAmount('241,89')]);
    ok(JSON.stringify(pa) === '[1234.56,1234.56,7.2,241.89]', 'parseAmount ' + JSON.stringify(pa));


    console.log('10. Облако: вход, отправка cur/rates, получение с другого устройства');
    const p3 = await newPage(browser, { cfg: "window.FIN_CONFIG={url:'https://x.supabase.co',key:'k'}" });
    await p3.route(/cdn\.jsdelivr\.net\/npm\/@supabase/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE_SB }));
    await p3.goto(base);
    await p3.waitForSelector('#auth:not([hidden])');
    ok(await p3.locator('#app').isHidden(), 'без входа приложение закрыто экраном входа');
    await p3.fill('#aEmail', 'me@test.dev'); await p3.fill('#aPass', 'secret123'); await p3.click('#aGo');
    await p3.waitForSelector('#addBtn', { state: 'visible' });
    ok(true, 'вход выполнен, приложение открылось');
    await addTx(p3, 100, 'PLN', 'Cloud test');
    await p3.waitForFunction(() => window.__log.some(l => l[0] === 'upsert' && l[1] === 'transactions' && l[2].some(r => r.rates)), null, { timeout: 8000 }).catch(() => {});
    const up = await p3.evaluate(() => window.__db.tx);
    ok(up.length === 1 && up[0].cur === 'PLN' && Math.abs(up[0].rates.USD - 0.25) < 1e-9 && up[0].amount === 100, 'в облако ушла трата с cur=PLN и курсом: ' + JSON.stringify(up[0]));
    const st = await p3.evaluate(() => window.__db.settings);
    ok(st && st.data.base === 'USD' && st.data.defCur, 'настройки валют в облаке: ' + JSON.stringify(st && st.data));
    await p3.evaluate(() => window.__db.tx.push({ id: 'remote1', user_id: 'u1', amount: 20, note: 'FromPhone', cat: 'Другое', date: new Date().toISOString().slice(0, 10), src: 'manual', deleted: false, u: Date.now() + 5000, cur: 'EUR', rates: { USD: 1.1 } }));
    await p3.click('#gear'); await p3.click('#aSync'); await p3.waitForTimeout(800); await p3.click('#sClose');
    const rem = norm(await p3.textContent('#list'));
    ok(/FromPhone/.test(rem) && /€/.test(rem), 'трата с другого устройства подтянулась в EUR');
    ok(/47,00/.test(await sum(p3)), 'итог 25 + 22 = 47,00: ' + await sum(p3));
    p3.on('dialog', d => d.accept());
    await p3.click('#gear'); await p3.click('#aDel'); await p3.waitForTimeout(600);
    ok(await p3.evaluate(() => window.__log.some(l => l[0] === 'rpc' && l[1] === 'delete_my_account')), 'кнопка удаления аккаунта вызывает delete_my_account');

    ok(page.errors.length === 0 && p2.errors.length === 0, 'нет ошибок JS на страницах ' + page.errors.concat(p2.errors).join('|'));
  } catch (e) { fail++; console.log('  CRASH', e.message); }
  finally { await browser.close(); srv.close(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
