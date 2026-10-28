// Record the real standalone app, with a tutorial header, camera and mouse arrow.
// No tutorial overlays or data are written back into the application HTML.
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),crypto=require('crypto'),assert=require('assert/strict');
const {spawn,spawnSync}=require('child_process');
const root=path.resolve(__dirname,'../..'),out='/tmp/contract-staff-video';
fs.mkdirSync(out,{recursive:true});
const sample='Попов Владимир Геннадьевич\nПравое ухо: Terra BTE-SP\nЛевое ухо: Terra BTE-SP\nИтого 74 000 руб., наша рассрочка.\nВ подарок: батарейки и футляр.';
(async()=>{
 const source=fs.readFileSync(path.join(root,'dist/Договор рассрочки.html'));
 const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(q.url==='/app'?source:fs.readFileSync(path.join(__dirname,'shell.html')))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 let context,videoPath,recorder;
 const scenes=[],errors=[],external=[];let start;
 try{
 context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,acceptDownloads:true});
 const page=await context.newPage();start=Date.now();
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:'))external.push(r.url())});
 await page.goto('http://127.0.0.1:'+server.address().port);
 const frame=await page.locator('#app').contentFrame();await frame.locator('#preview [data-bind]').first().waitFor();
 const pause=ms=>page.waitForTimeout(ms);
 const loc=selector=>frame.locator(selector).first();
 const flush=async()=>{await frame.locator('body').evaluate(()=>ContractApp.flush());await pause(160)};
 const stage=async(step,title,subtitle,chapter=false)=>{await page.evaluate(v=>lesson.title(...v),[step,title,subtitle]);if(chapter)scenes.push({step,title,time:recorder?recorder.frames/25:0});console.log('Scene:',step,title)};
 async function camera(selector=null,scale=1){
  let s=scale,x,y;
  if(!selector){s=.94;x=(1920-1600*s)/2;y=(876-900*s)/2}
  else{const r=await loc(selector).evaluate(n=>{const b=n.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height}});x=960-s*(r.x+r.width/2);y=438-s*(r.y+r.height/2)}
  await page.evaluate(v=>lesson.camera(...v),[s,x,y]);await pause(1150);
 }
 async function cameraArea(area,scale=2){await page.evaluate(v=>lesson.camera(...v),[scale,960-scale*(area.x+area.width/2),438-scale*(area.y+area.height/2)]);await pause(1150)}
 async function point(selector,click=false,highlight=true){
  const r=await loc(selector).boundingBox();assert(r,'No target '+selector);
  const x=r.x+Math.min(r.width*.55,r.width-8),y=r.y+r.height/2;
  assert(x>12&&x<1908&&y>135&&y<1003,`Target outside video stage ${selector}: ${x}, ${y}`);
  await page.evaluate(v=>{lesson.cursor(v.x,v.y);lesson.highlight(v.highlight?v.r:null)}, {x,y,r,highlight});
  await page.mouse.move(x,y,{steps:12});await pause(800);
  if(click){await page.evaluate(v=>lesson.click(v.x,v.y),{x,y});await page.mouse.click(x,y);await pause(400)}
 }
 async function replace(selector,value,{type=true}={}){
  await point(selector,true);
  await loc(selector).press('Control+A');
  if(type)await loc(selector).pressSequentially(value,{delay:45});else await loc(selector).fill(value);
  await flush();await pause(600);
 }
 async function scroll(selector,offset=20){
  await loc(selector).evaluate((n,offset)=>{const p=n.closest('.body')||n.closest('.preview-scroll');const r=n.getBoundingClientRect(),b=p.getBoundingClientRect();p.scrollTo({top:p.scrollTop+r.top-b.top-offset,behavior:'smooth'})},offset);
  await pause(900);
 }
 async function shot(name){await page.screenshot({path:path.join(out,name+'.png')})}
 await camera();
 // Use Chromium's supported screencast API and the installed system FFmpeg.
 // Repeating the latest compositor frame at 25 fps preserves reading pauses.
 videoPath=path.join(out,'recorded-lesson.mp4');
 const cdp=await context.newCDPSession(page);
 const encoder=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-vcodec','mjpeg','-framerate','25','-i','pipe:0','-an','-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p','-threads','4',videoPath],{stdio:['pipe','ignore','pipe']});
 let encoderErrors='',latestFrame,closed=false;encoder.stderr.on('data',d=>encoderErrors+=d);encoder.stdin.on('error',e=>errors.push(e.message));
 const finished=new Promise((resolve,reject)=>{encoder.on('error',reject);encoder.on('close',code=>code===0?resolve():reject(Error('Recording encoder failed: '+encoderErrors)))});
 cdp.on('Page.screencastFrame',event=>{latestFrame=Buffer.from(event.data,'base64');cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{})});
 recorder={frames:0,async stop(){if(closed)return;closed=true;clearInterval(timer);await cdp.send('Page.stopScreencast').catch(()=>{});encoder.stdin.end();await finished}};
 await cdp.send('Page.startScreencast',{format:'jpeg',quality:85,maxWidth:1920,maxHeight:1080,everyNthFrame:2});
 const timer=setInterval(()=>{if(latestFrame){encoder.stdin.write(latestFrame);recorder.frames++}},40);
 // 0. The original blank app, then one-time office settings.
 await stage(0,'Настройте город и год','Только один раз. Если понадобится изменить — повторите шаг 0.',true);await pause(2800);await shot('00-overview');
 await point('details summary',true);await scroll('details',8);await camera('details',2.05);await pause(1500);
 await replace('#city','Москва');await replace('#documentYear','2026');
 await stage(0,'Нажмите «Сохранить»','Город и год сохранятся для следующих договоров.');await point('#saveSettings',true);await pause(2600);
 assert((await loc('#settingsStatus').innerText()).includes('Сохранено'));await shot('01-office-saved');
 await camera();await point('details summary',true);await pause(900);
 // 1. Paste the specialist's actual message, then recognize it.
 await stage(1,'Вставьте информацию о рассрочке','Сообщение специалиста — в левое окно.',true);await pause(2300);
 await point('#source',true);await loc('#source').fill(sample);await flush();await pause(2300);await shot('02-message-overview');
 const sourceRect=await loc('#source').evaluate(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:250}});
 await cameraArea(sourceRect,2.1);await point('#source',false,false);
 await stage(1,'Файл сам разберёт обычное сообщение','И возьмёт только нужную информацию.');await pause(3600);
 await camera('#recognize',2.2);await stage(1,'Нажмите «Распознать»','Данные появятся во втором окне.');await point('#recognize',true);await flush();await pause(1400);
 assert.equal(await loc('#product').inputValue(),'Terra BTE-SP — 2 шт.');assert.equal(await loc('#total').inputValue(),'74 000');assert.equal(await loc('#downPayment').inputValue(),'37 000');assert.equal(await loc('#months').inputValue(),'3');
 // 2. Show the complete populated interface before zooming into the form.
 await stage(2,'Проверьте данные во втором окне','Любое поле можно исправить или заполнить вручную, даже без текста.',true);await camera();await pause(3300);await shot('03-recognized-overview');
 await camera('#nameFields',1.8);await point('#fullName',false);await pause(2200);
 await camera();await scroll('#product',12);await camera('#purchaseFields',1.85);
 await stage(2,'Взнос и срок не указаны?','Первый взнос — 50%. Остаток — на 3 месяца.');await point('#downPayment',false);await pause(4300);await shot('04-automatic-deposit');
 await stage(2,'Нужно больше месяцев? Измените срок','Платежи пересчитаются автоматически.');await replace('#months','4');assert.equal(await loc('#months').inputValue(),'4');await pause(2400);await replace('#months','3');await pause(1800);
 // Choose the contract date so the real payment calendar contains actual dates.
 await camera();await scroll('#contractDate',200);await camera('.date-row',2.05);
 await stage(2,'Укажите дату договора','Можно ввести вручную, выбрать календарь или нажать «Сегодня».');await point('#today',true);await flush();await pause(2300);
 assert((await loc('#contractDate').inputValue()).match(/^\d{2}\.\d{2}\.2026$/));
 // 2 continued. Identity details and the live document result.
 await stage(2,'Паспортные данные — ниже во втором окне','Прокрутите до «Реквизиты покупателя».',true);await camera();await scroll('#identityFields',30);await pause(2000);await shot('05-identity-overview');
 await camera('#identityFields',1.72);await pause(1200);
 await replace('#passport','0000 123456');await replace('#passportDate','10.10.2020');await replace('#passportIssuer','Учебный отдел МВД');
 await stage(2,'Введите адрес и телефон','Все реквизиты сразу появятся в договоре справа.');await replace('#address','Учебная улица, дом 10');await replace('#phone','+7 900 000-00-00');await pause(2100);await shot('06-identity-filled');
 // 3. Start from a complete view of the now-completed contract.
 await stage(3,'Проверьте договор справа','Перед печатью сверьте ФИО, аппараты, реквизиты, суммы и даты.',true);await camera();
 await frame.locator('.fields-panel .body').evaluate(n=>n.scrollTo({top:0,behavior:'smooth'}));await pause(800);await pause(2300);await shot('07-contract-overview');
 await scroll('#preview [data-bind="fullName"]',130);
 const documentRect=await loc('#preview [data-bind="fullName"]').evaluate(n=>{const r=n.closest('p').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:160}});
 await cameraArea(documentRect,2.05);await point('#preview [data-bind="fullName"]',false);await pause(2500);
 await stage(3,'Если нужна правка — нажмите на нужный текст','Редактировать можно и поля, и сам договор справа.');await pause(2600);
 await camera();await scroll('#preview table',140);await camera('#preview table',2.25);
 await stage(3,'График платежей считается сам','Первый платёж — через месяц, дальше — ежемесячно. Можно ничего не менять.');await point('#preview [data-bind="pay0date"]',false);await pause(3800);
 await stage(3,'Остаток 37 000 ₽ на 3 месяца','12 300 + 12 300 + 12 400 ₽. Последний платёж выравнивает остаток.');await point('#preview [data-bind="pay2amount"]',false);await pause(4800);await shot('08-rounded-calendar');
 const amounts=await frame.locator('#preview [data-bind$="amount"]').evaluateAll(ns=>ns.map(n=>n.textContent));
 assert(amounts.map(s=>s.replace(/\s/g,'')).includes('12300')&&amounts.map(s=>s.replace(/\s/g,'')).includes('12400'));assert(!/батарей|футляр/i.test(await loc('#preview').innerText()));
 await camera();await scroll('#preview [data-bind="passport"]',190);
 const passportRect=await loc('#preview [data-bind="passport"]').evaluate(n=>{const r=n.closest('p').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}});
 await cameraArea(passportRect,2.55);await stage(3,'Паспортные данные уже в договоре','Проверьте, что всё внесено верно.');await point('#preview [data-bind="passport"]',false);await pause(3200);await shot('09-identity-in-contract');
 // 4. Actual DOCX download; no browser printing or fake operating-system dialogs.
 await stage(4,'Нажмите «Скачать и распечатать»','Скачается заполненный договор Word.',true);await camera();await pause(2100);await point('#download',false);await pause(1800);await shot('10-download-button');
 const pending=page.waitForEvent('download');await point('#download',true);const download=await pending;await download.saveAs(path.join(out,'tutorial-contract.docx'));
 assert.equal(await download.failure(),null);assert(fs.statSync(path.join(out,'tutorial-contract.docx')).size>10000);
 await stage(4,'Готово — договор скачан','Файл сохранится в папке загрузок браузера. Обычно это «Загрузки».');await pause(4300);
 await stage(4,'Откройте скачанный Word и распечатайте','Данные клиента после закрытия HTML не сохраняются — сначала скачайте договор.');await pause(5200);await shot('11-finished');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const end=recorder.frames/25;
 await recorder.stop();
 await context.close();context=null;
 const manifest={appSha256:crypto.createHash('sha256').update(source).digest('hex'),duration:end,chapters:scenes,checks:{wordDownloaded:true,officeSaved:true,automaticDeposit:true,termChanged:true,identityInPreview:true,roundedAmounts:[12300,12300,12400],noExternalRequests:true}};
 fs.writeFileSync(path.join(__dirname,'chapters.json'),JSON.stringify(manifest,null,2));
 // Fast-start MP4, with named chapters, for Windows browsers and messengers.
 const duration=Number(spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',videoPath],{encoding:'utf8'}).stdout.trim());
 const trim=0;
 let metadata=';FFMETADATA1\ntitle=Договор рассрочки — инструкция администраторам\n';
 for(let i=0;i<scenes.length;i++){metadata+='[CHAPTER]\nTIMEBASE=1/1000\nSTART='+Math.round((scenes[i].time-trim)*1000)+'\nEND='+Math.round(((scenes[i+1]?.time||duration)-trim)*1000)+'\ntitle=Шаг '+scenes[i].step+'. '+scenes[i].title+'\n'}
 const metadataFile=path.join(out,'chapters.ffmeta');fs.writeFileSync(metadataFile,metadata);
 console.log('Encoding MP4:',duration.toFixed(1),'seconds');
 const encode=spawnSync('ffmpeg',['-hide_banner','-loglevel','warning','-y','-ss',String(trim),'-i',videoPath,'-i',metadataFile,'-map','0:v:0','-map_metadata','1','-map_chapters','1','-an','-c:v','libx264','-preset','medium','-crf','26','-threads','4','-vf','scale=in_range=pc:out_range=tv','-color_range','tv','-pix_fmt','yuv420p','-movflags','+faststart',path.join(root,'dist/staff-walkthrough.mp4')],{stdio:'inherit'});
 assert.equal(encode.status,0,'Video encoding failed');
 console.log('PASS: all lesson actions and Word download; video written to dist/staff-walkthrough.mp4');
 }finally{if(recorder)await recorder.stop();if(context)await context.close();await browser.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
