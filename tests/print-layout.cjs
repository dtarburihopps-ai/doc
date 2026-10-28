const {chromium}=require('playwright');
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const output=process.env.CONTRACT_TEST_OUTPUT||'/tmp/contract-print-check';
fs.mkdirSync(output,{recursive:true});
fs.rmSync(path.join(output,'results.json'),{force:true});
const message='Попов Владимир Геннадьевич\nПравое ухо: Terra BTE-SP\nСер.номер: 2609X3VHL\nЛевое ухо: Terra BTE-SP\nСер.номер: 2613X0K7Y\nИтого 74000, сейчас 37000, наша рассрочка на три месяца';
(async()=>{
 const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(fs.readFileSync(path.join(root,'dist/Договор рассрочки.html')))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try {
 const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
 const errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:'))requests.push(r.url())});
 page.on('dialog',d=>d.accept());
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.waitForSelector('#preview [data-bind]');await page.evaluate(()=>ContractApp.flush());
 assert.equal(await page.inputValue('#city'),'Сочи');assert.equal(await page.inputValue('#documentYear'),'2026');
 for(const id of ['surname','firstname','patronymic','fullName','product','total','downPayment','contractDate','passport','passportDate','passportIssuer','address','phone'])assert.equal(await page.inputValue('#'+id),'','Initial template has customer data in '+id);
 assert((await page.locator('#preview').textContent()).includes('Сочи'));assert(!(await page.locator('#preview').textContent()).includes('Москва'));
 await page.locator('details summary').click();await page.fill('#city','Тюмень');await page.fill('#documentYear','2027');await page.click('#saveSettings');
 assert.equal(await page.locator('#settingsStatus').textContent(),'Сохранено');
 await page.fill('#source',message);await page.click('#recognize');await page.fill('#contractDate','28.10.2027');await page.locator('#contractDate').press('Tab');await page.evaluate(()=>ContractApp.flush());
 assert.equal((await page.inputValue('#total')).replace(/\s/g,''),'74000');
 assert.equal((await page.inputValue('#downPayment')).replace(/\s/g,''),'37000');
 await page.fill('#passport','0000 123456');await page.fill('#passportDate','10.10.2020');
 await page.fill('#passportIssuer','Учебный отдел выдачи документов');await page.fill('#address','г. Тюмень, Учебная улица, дом 10');await page.fill('#phone','+7 900 000-00-00');
 await page.evaluate(()=>ContractApp.flush());
 const results=[];
 async function capture(label) {
   await page.click('#print');
   await page.waitForFunction(()=>document.querySelector('#contractPrintFrame')?.contentDocument?.querySelector('section.docx')&&!document.querySelector('#print').disabled);
   assert.equal(await page.locator('#fatal').isVisible(),false);
   const data=await page.evaluate(()=>{
     const d=document.querySelector('#contractPrintFrame').contentDocument;
     const serialize=n=>n.nodeType===3?[3,n.nodeValue]:n.nodeType===1?[1,n.namespaceURI,n.localName,[...n.attributes].map(a=>[a.namespaceURI,a.name,a.value]),[...n.childNodes].map(serialize).filter(Boolean)]:null;
     return {tree:serialize(d.documentElement),scrollWidth:d.documentElement.scrollWidth,overflow:[...d.body.querySelectorAll('*')].filter(p=>p.getBoundingClientRect().right>795).map(p=>[p.tagName,p.className.baseVal??p.className,p.getBoundingClientRect().right]),pages:[...d.querySelectorAll('section.docx')].map(p=>{
       const rect=p.getBoundingClientRect(),a=p.querySelector('article'),f=p.querySelector('footer');
       return {width:rect.width,height:rect.height,articleBottom:a?.getBoundingClientRect().bottom-rect.top,footerTop:f?.getBoundingClientRect().top-rect.top,footerFields:[...p.querySelectorAll('footer [data-word-field="PAGE"]')].map(n=>n.textContent),footerImages:[...p.querySelectorAll('footer img')].map(n=>({loaded:n.complete&&n.naturalWidth>0,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})),paragraphs:[...a.querySelectorAll('p')].map(p=>p.textContent)};
     })};
   });
   assert(data.pages.length>=2);
   assert(data.scrollWidth<=795,'Document must not cause shrink-to-fit');assert.equal(data.overflow.length,0);
   for(const [index,p]of data.pages.entries()){
     assert(Math.abs(p.width-210*96/25.4)<1);assert(Math.abs(p.height-297*96/25.4)<1);assert(p.articleBottom<=p.footerTop,'Contract text must fit above its footer');
     assert.deepEqual(p.footerFields,index?[String(index+1)]:[],'Word PAGE field must count real pages');
     assert.equal(p.footerImages.length,1);assert(p.footerImages[0].loaded,'Footer strip must be decoded before print');
     assert(Math.abs(p.footerImages[0].width-467.45*96/72)<.1,'Keep original Word drawing dimensions');
   }
   const printable=await browser.newPage();
   // Preserve the renderer's DOM, including its SVG nesting. Re-parsing outerHTML
   // would let the HTML parser rearrange blocks inside Word paragraphs.
   await printable.evaluate(tree=>{
     function build(n){if(n[0]===3)return document.createTextNode(n[1]);const el=document.createElementNS(n[1],n[2]);for(const [ns,key,val]of n[3])el.setAttributeNS(ns,key,val);for(const child of n[4])el.append(build(child));return el}
     document.replaceChild(build(tree),document.documentElement);
   },data.tree);await printable.evaluate(()=>document.fonts.ready);
   await printable.pdf({path:path.join(output,label+'.pdf'),preferCSSPageSize:true,printBackground:false});
   await printable.close();results.push({label,...data,tree:undefined});
 }
 for(const [zoom,width]of [['.6',900],['.75',1440],['.9',1920],['1',1100]]){
   await page.setViewportSize({width,height:1000});await page.selectOption('#zoom',zoom);await capture('zoom-'+zoom);
 }
 // Real typing in the editable preview must reach both printing and Word.
 await page.selectOption('#zoom','1');
 const amount=page.locator('#preview [data-bind="pay0amount"]').first();
 await amount.dblclick();await page.keyboard.type('12 400');await page.locator('#fullName').click();await page.evaluate(()=>ContractApp.flush());
 assert.equal(await page.locator('#preview [data-bind="pay0amount"]').first().textContent(),'12 400');
 await page.locator('#preview [data-bind="pay2amount"]').first().dblclick();await page.keyboard.type('12 300');await page.locator('#fullName').click();await page.evaluate(()=>ContractApp.flush());
 await capture('manual');
 const downloadPromise=page.waitForEvent('download');await page.click('#download');const download=await downloadPromise;await download.saveAs(path.join(output,'filled.docx'));
 await page.fill('#months','12');await page.fill('#product','Oticon Xceed 3 BTE SP — 1 шт., Phonak Audeo L50-R — 1 шт.');
 await page.fill('#passportIssuer','Учебный отдел выдачи документов, подразделение регистрации и учёта, Тюменская область, город Тюмень');
 await page.fill('#address','г. Тюмень, Учебная улица, дом 10, корпус 2, квартира 150, второй подъезд, этаж 12');
 await page.evaluate(()=>ContractApp.flush());await capture('twelve-months');
 await page.fill('#passportIssuer','Учебный отдел выдачи документов и регистрации населения. '.repeat(12));
 await page.fill('#address','Учебный город, Учебная улица, дом 10, корпус 2, квартира 150. '.repeat(8));
 await page.evaluate(()=>ContractApp.flush());await capture('three-pages');
 assert(results.at(-1).pages.length>=3,'Exercise automatic PAGE 3 and following pages');
 // Printing after clearing must not leak data from the previous customer.
 await page.click('#clear');await page.evaluate(()=>ContractApp.flush());
 assert.equal(await page.inputValue('#fullName'),'');assert.equal(await page.inputValue('#city'),'Тюмень');
 await capture('empty');
 // The normal browser print shortcut must not include the editor or the hidden frame.
 await page.pdf({path:path.join(output,'browser-shortcut.pdf'),preferCSSPageSize:true,printBackground:false});
 let localFile='passed';
 const fileContext=await browser.newContext({offline:true});
 try{
   const local=await fileContext.newPage();
   try{await local.goto('file://'+path.join(root,'dist/Договор рассрочки.html'))}
   catch(e){if(!e.message.includes('ERR_BLOCKED_BY_ADMINISTRATOR'))throw e;localFile='blocked by cloud browser policy'}
   if(localFile==='passed'){
     await local.waitForSelector('#preview [data-bind]');await local.click('#print');
     await local.waitForFunction(()=>document.querySelector('#contractPrintFrame')?.contentDocument?.querySelector('section.docx')&&!document.querySelector('#print').disabled);
     assert.equal(await local.locator('#fatal').isVisible(),false);
   }
 }finally{await fileContext.close()}
 const offline=await browser.newContext({offline:true});
 try{
   // Serve the initial HTML from memory while every network connection is offline.
   await offline.route('http://127.0.0.1/offline',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:fs.readFileSync(path.join(root,'dist/Договор рассрочки.html'))}));
   const local=await offline.newPage();await local.goto('http://127.0.0.1/offline');
   await local.waitForSelector('#preview [data-bind]');await local.fill('#fullName','Учебный Покупатель');await local.fill('#total','160000');
   await local.click('#print');await local.waitForFunction(()=>document.querySelector('#contractPrintFrame')?.contentDocument?.querySelector('section.docx')&&!document.querySelector('#print').disabled);
   assert.equal(await local.locator('#fatal').isVisible(),false);
   assert((await local.frameLocator('#contractPrintFrame').locator('body').textContent()).includes('Учебный Покупатель'));
 }finally{await offline.close()}
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify({scenarios:results.length,pages:results.map(r=>[r.label,r.pages.length]),pageErrors:errors,externalRequests:requests,offline:'passed',localFile,output},null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
