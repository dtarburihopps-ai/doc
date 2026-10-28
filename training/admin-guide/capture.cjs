const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http');
const root=path.resolve(__dirname,'../..'),dir=path.join(__dirname,'screens');fs.mkdirSync(dir,{recursive:true});
(async()=>{
 const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(fs.readFileSync(path.join(root,'dist/Договор рассрочки.html')))});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:1600,height:1050},deviceScaleFactor:2,acceptDownloads:true});page.on('dialog',d=>d.accept());
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const meta={};
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('#preview [data-bind]');
 const flush=async()=>{await page.evaluate(()=>ContractApp.flush());await page.waitForTimeout(300)};
 const rect=async selector=>{const r=await page.locator(selector).first().boundingBox();if(!r)throw Error('No visible element '+selector);return r};
 async function capture(name,clip,targets={}){
   const area={x:Math.max(0,Math.floor(clip.x)),y:Math.max(0,Math.floor(clip.y)),width:Math.ceil(clip.width),height:Math.ceil(clip.height)};
   if(area.y+area.height>1050||area.x+area.width>1600)throw Error('Screenshot outside viewport: '+name+' '+JSON.stringify(area));
   const points={};for(const [key,selector]of Object.entries(targets)){const r=await rect(selector);points[key]={x:r.x-area.x,y:r.y-area.y,width:r.width,height:r.height}}
   await page.screenshot({path:path.join(dir,name+'.png'),clip:area});meta[name]={...area,targets:points,file:'screens/'+name+'.png'};
 }
 const pad=(r,n)=>({x:r.x-n,y:r.y-n,width:r.width+n*2,height:r.height+n*2});
 const union=(...rs)=>({x:Math.min(...rs.map(r=>r.x)),y:Math.min(...rs.map(r=>r.y)),width:Math.max(...rs.map(r=>r.x+r.width))-Math.min(...rs.map(r=>r.x)),height:Math.max(...rs.map(r=>r.y+r.height))-Math.min(...rs.map(r=>r.y))});
 await page.locator('details summary').click();await page.fill('#city','Москва');await page.fill('#documentYear','2026');await page.click('#saveSettings');await flush();await page.locator('details').scrollIntoViewIfNeeded();
 await capture('settings',pad(await rect('details'),8),{summary:'details summary',city:'#city',year:'#documentYear',save:'#saveSettings',saved:'#settingsStatus'});
 await page.locator('details summary').click();
 const sample='Попов Владимир Геннадьевич\nПравое ухо: Terra BTE-SP\nЛевое ухо: Terra BTE-SP\nИтого 74 000, сейчас 37 000\nРассрочка на 3 месяца';
 await page.fill('#source',sample);const source=await rect('#source');await capture('source',{...pad(source,5),height:245},{text:'#source'});
 await page.click('#recognize');await flush();
 await capture('recognize',pad(union(await rect('.source-buttons'),await rect('#parseStatus')),6),{recognize:'#recognize',result:'#parseStatus'});
 await page.click('#today');await flush();await page.locator('#contractDate').scrollIntoViewIfNeeded();
 const dateArea=union(await rect('.date-row'),await rect('#yearNote'));
 await capture('date',{x:dateArea.x-8,y:dateArea.y-1,width:dateArea.width+16,height:dateArea.height+9},{date:'#contractDate',calendar:'.calendar-button',today:'#today'});
 await page.fill('#passport','0000 123456');await page.fill('#passportDate','10.10.2020');await page.fill('#passportIssuer','Учебный отдел МВД');await flush();await page.locator('#identityFields').scrollIntoViewIfNeeded();await page.locator('#address').click();
 const ident=union(await rect('#passport'),await rect('#passportDate'),await rect('#passportIssuer'),await rect('#address'));
 await capture('fields',{x:ident.x-10,y:ident.y-26,width:ident.width+20,height:ident.height+42},{passport:'#passport',issuer:'#passportIssuer',address:'#address'});
 await page.fill('#address','Учебная улица, дом 10');await page.fill('#phone','+7 900 000-00-00');await flush();
 await page.selectOption('#zoom','1');await page.locator('#preview [data-bind="fullName"]').first().scrollIntoViewIfNeeded();
 const nameP=await page.locator('#preview [data-bind="fullName"]').first().evaluate(n=>{const r=n.closest('p').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}});
 const productP=await page.locator('#preview [data-bind="product"]').first().evaluate(n=>{const r=n.closest('p').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}});
 await capture('document',pad(union(nameP,productP),12),{name:'#preview [data-bind="fullName"]',product:'#preview [data-bind="product"]'});
 await page.locator('#preview table').first().scrollIntoViewIfNeeded();
 const table=await rect('#preview table');await capture('calendar',pad(table,12),{date:'#preview [data-bind="pay0date"]',amount:'#preview [data-bind="pay0amount"]'});
 const pending=page.waitForEvent('download');await page.click('#download');const download=await pending;
 if(await download.failure()||fs.statSync(await download.path()).size<10000)throw Error('Contract download failed');
 await capture('download',pad(await rect('#download'),4),{download:'#download'});
 await page.locator('#clear').scrollIntoViewIfNeeded();await capture('clear',pad(await rect('.source-buttons'),8),{clear:'#clear'});
 await page.click('#clear');await flush();
 if(await page.inputValue('#city')!=='Москва'||await page.inputValue('#fullName')!=='')throw Error('Clear example failed');
 fs.writeFileSync(path.join(__dirname,'screens.json'),JSON.stringify(meta,null,2));
 if(errors.length)throw Error(errors.join('\n'));console.log(JSON.stringify(Object.fromEntries(Object.entries(meta).map(([k,v])=>[k,[v.width,v.height]])),null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
