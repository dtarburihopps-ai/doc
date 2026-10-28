// Capture the real application at each stage; customer details are fictional.
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http');
const root=path.resolve(__dirname,'../..'),dir=path.join(__dirname,'screens');
fs.mkdirSync(dir,{recursive:true});
(async()=>{
 const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(fs.readFileSync(path.join(root,'dist/Договор рассрочки.html')))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const viewport={width:1600,height:1000};
 const page=await browser.newPage({viewport,deviceScaleFactor:2,acceptDownloads:true});
 page.on('dialog',d=>d.accept());
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const meta={};
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.waitForSelector('#preview [data-bind]');
 const flush=async()=>{await page.evaluate(()=>ContractApp.flush());await page.waitForTimeout(200)};
 const rect=async selector=>{const r=await page.locator(selector).first().boundingBox();if(!r)throw Error('No visible element '+selector);return r};
 const pad=(r,n)=>({x:r.x-n,y:r.y-n,width:r.width+n*2,height:r.height+n*2});
 const union=(...rs)=>({x:Math.min(...rs.map(r=>r.x)),y:Math.min(...rs.map(r=>r.y)),width:Math.max(...rs.map(r=>r.x+r.width))-Math.min(...rs.map(r=>r.x)),height:Math.max(...rs.map(r=>r.y+r.height))-Math.min(...rs.map(r=>r.y))});
 async function capture(name,clip,targets={}){
   const area={x:Math.max(0,Math.floor(clip.x)),y:Math.max(0,Math.floor(clip.y)),width:Math.ceil(clip.width),height:Math.ceil(clip.height)};
   if(area.y+area.height>viewport.height||area.x+area.width>viewport.width)throw Error('Screenshot outside viewport: '+name+' '+JSON.stringify(area));
   const points={};for(const [key,selector]of Object.entries(targets)){const r=await rect(selector);points[key]={x:r.x-area.x,y:r.y-area.y,width:r.width,height:r.height}}
   await page.screenshot({path:path.join(dir,name+'.png'),clip:area});meta[name]={...area,targets:points,file:'screens/'+name+'.png'};
 }
 const overview=async(name,targets)=>{
   await capture(name,{x:0,y:0,...viewport},targets);
   meta[name].state=await page.evaluate(()=>Object.fromEntries(['source','city','documentYear','fullName','product','total','downPayment','months','contractDate','passport'].map(id=>[id,document.getElementById(id).value])));
 };
 const customer=async()=>({name:await page.inputValue('#fullName'),product:await page.inputValue('#product'),total:await page.inputValue('#total'),pv:await page.inputValue('#downPayment'),months:await page.inputValue('#months')});
 const number=n=>Number(n.replace(/\s/g,''));
 // Step 0 starts with the original office and no customer data.
 if(await page.inputValue('#city')!=='Сочи'||await page.inputValue('#fullName')!=='')throw Error('Step 0 must start empty with Sochi');
 await page.locator('details summary').click();await page.locator('details').scrollIntoViewIfNeeded();
 await overview('overview-0',{focus:'details'});
 await page.fill('#city','Москва');await page.fill('#documentYear','2026');await page.click('#saveSettings');await flush();
 await capture('settings',{...pad(await rect('details'),7),height:248},{city:'#city',year:'#documentYear',save:'#saveSettings'});
 await page.locator('details summary').click();
 // No deposit or term in the message: the real defaults will be visible on step 2.
 const sample='Попов Владимир Геннадьевич\nПравое ухо: Terra BTE-SP\nЛевое ухо: Terra BTE-SP\nИтого 74 000 руб., наша рассрочка.\nВ подарок: батарейки и футляр.';
 await page.fill('#source',sample);
 await overview('overview-1',{focus:'.source-panel'});
 const source=await rect('#source');await capture('source',{...pad(source,5),height:205},{text:'#source'});
 await capture('recognize',pad(await rect('#recognize'),5),{recognize:'#recognize'});
 await page.click('#recognize');await flush();
 const parsed=await customer();
 if(parsed.name!=='Попов Владимир Геннадьевич'||parsed.product!=='Terra BTE-SP — 2 шт.'||number(parsed.total)!==74000||number(parsed.pv)!==37000||parsed.months!=='3')throw Error('Unexpected tutorial example '+JSON.stringify(parsed));
 if(/батарей|футляр/i.test(await page.locator('#preview').innerText()))throw Error('Gift leaked into contract');
 await overview('overview-2',{focus:'.fields-panel'});
 // Show the populated purchase fields together, including the term and date controls.
 await page.locator('#product').evaluate(n=>{const body=n.closest('.body');body.scrollTop+=n.closest('.field').getBoundingClientRect().top-body.getBoundingClientRect().top-10});
 const purchase=union(await rect('#product'),await rect('#total'),await rect('#downPayment'),await rect('#months'));
 await capture('purchase',{x:purchase.x-9,y:purchase.y-25,width:purchase.width+18,height:purchase.height+31},{product:'#product',total:'#total',pv:'#downPayment',months:'#months'});
 const schedule=await page.evaluate(()=>ContractApp.schedule(74000,37000,3,new Date(2026,9,28,12)));
 if(schedule.map(r=>r.amount).join(',')!=='12300,12300,12400')throw Error('Rounding example changed');
 await page.fill('#months','4');await flush();
 const four=await page.locator('#preview [data-bind="pay0amount"]').first().innerText();
 await page.fill('#months','3');await flush();
 const three=await page.locator('#preview [data-bind="pay0amount"]').first().innerText();
 if(four===three)throw Error('Term did not recalculate amounts');
 // Manual completion makes step 3 a distinct, completed document state.
 await page.fill('#contractDate','28.10.2026');await page.fill('#passport','0000 123456');await page.fill('#passportDate','10.10.2020');
 await page.fill('#passportIssuer','Учебный отдел МВД');await page.fill('#address','Учебная улица, дом 10');await page.fill('#phone','+7 900 000-00-00');await flush();
 // Return the middle column to the filled customer data for the full overview.
 await page.locator('.fields-panel .body').evaluate(n=>n.scrollTop=0);
 await page.locator('#preview [data-bind="fullName"]').first().scrollIntoViewIfNeeded();
 await overview('overview-3',{focus:'.preview-panel'});
 await page.selectOption('#zoom','1');await page.locator('#preview [data-bind="fullName"]').first().scrollIntoViewIfNeeded();
 const paragraph=selector=>page.locator(selector).first().evaluate(n=>{const r=n.closest('p').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}});
 await capture('document',pad(union(await paragraph('#preview [data-bind="fullName"]'),await paragraph('#preview [data-bind="product"]')),12),{name:'#preview [data-bind="fullName"]',product:'#preview [data-bind="product"]'});
 await page.locator('#preview table').first().scrollIntoViewIfNeeded();
 await capture('calendar',pad(await rect('#preview table'),12),{date:'#preview [data-bind="pay0date"]',amount:'#preview [data-bind="pay0amount"]'});
 await page.selectOption('#zoom','.75');await flush();
 await overview('overview-4',{focus:'#download'});
 await capture('download',pad(await rect('#download'),5),{download:'#download'});
 const pending=page.waitForEvent('download');await page.click('#download');const download=await pending;
 if(await download.failure()||fs.statSync(await download.path()).size<10000)throw Error('Contract download failed');
 await page.reload();await page.waitForSelector('#preview [data-bind]');
 if(await page.inputValue('#city')!=='Москва'||await page.inputValue('#documentYear')!=='2026'||await page.inputValue('#fullName')!=='')throw Error('Saved office/customer reset after reload does not match the guide');
 fs.writeFileSync(path.join(__dirname,'screens.json'),JSON.stringify(meta,null,2));
 for(const file of fs.readdirSync(dir)){if(file.endsWith('.png')&&!meta[file.slice(0,-4)])fs.unlinkSync(path.join(dir,file))}
 if(errors.length)throw Error(errors.join('\n'));
 console.log(JSON.stringify({screenshots:Object.keys(meta),parsed,rounding:schedule.map(r=>r.amount),termRecalculated:four!==three,officeSurvivedReload:true,giftsExcluded:true},null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
