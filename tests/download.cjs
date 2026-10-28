const {chromium}=require('playwright');
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),output='/tmp/contract-download-check';
fs.mkdirSync(output,{recursive:true});
(async()=>{
 const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(fs.readFileSync(path.join(root,'dist/Договор рассрочки.html')))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({acceptDownloads:true});const errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:'))external.push(r.url())});
  await page.addInitScript(()=>{window.print=()=>{throw Error('The download action must not start browser printing')}});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('#preview [data-bind]');await page.evaluate(()=>ContractApp.flush());
  assert.equal(await page.locator('#print').count(),0);
  assert.equal(await page.locator('#download').textContent(),'Скачать и распечатать');
  assert.equal(await page.inputValue('#city'),'Сочи');
  for(const id of ['fullName','product','total','passport','phone'])assert.equal(await page.inputValue('#'+id),'');
  async function download(name){
   const pending=page.waitForEvent('download');await page.click('#download');const file=await pending;
   assert(file.suggestedFilename().endsWith('.docx'));await file.saveAs(path.join(output,name));
   assert.equal(await page.locator('#fatal').isVisible(),false);
   assert((await page.locator('#busy').textContent()).includes('Word'));
   assert.equal(await page.locator('iframe').count(),0);
  }
  await download('empty.docx');
  await page.fill('#source','Попов Владимир Геннадьевич\nПравое ухо: Terra BTE-SP\nЛевое ухо: Terra BTE-SP\nИтого 74000, сейчас 37000, наша рассрочка на три месяца');
  await page.click('#recognize');await page.fill('#contractDate','28.10.2026');await page.locator('#contractDate').press('Tab');
  await page.fill('#passport','0000 123456');await page.fill('#passportDate','10.10.2020');
  await page.fill('#passportIssuer','Учебный отдел выдачи документов');await page.fill('#address','г. Сочи, Учебная улица, дом 10');await page.fill('#phone','+7 900 000-00-00');
  await page.evaluate(()=>ContractApp.flush());
  assert.equal((await page.inputValue('#total')).replace(/\s/g,''),'74000');
  assert.equal((await page.inputValue('#downPayment')).replace(/\s/g,''),'37000');
  await page.selectOption('#zoom','1');
  for(const [key,value]of [['pay0amount','12 400'],['pay2amount','12 300']]){
   await page.locator('#preview [data-bind="'+key+'"]').first().dblclick();await page.keyboard.type(value);
   await page.locator('#fullName').click();await page.evaluate(()=>ContractApp.flush());
  }
  await download('filled.docx');
  await page.fill('#months','12');await page.evaluate(()=>ContractApp.flush());await download('twelve-months.docx');
  await page.click('#clear');await page.evaluate(()=>ContractApp.flush());assert.equal(await page.inputValue('#fullName'),'');
  assert.equal(await page.inputValue('#city'),'Сочи');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('Passed: no Print button, renamed download, empty/manual/12-month Word downloads, manual preview edits, no browser printing or external requests');
 }finally{await browser.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
