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
 const scenes=[],errors=[],external=[],pageBounds=[];
 try{
 context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,acceptDownloads:true});
 const page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:'))external.push(r.url())});
 await page.goto('http://127.0.0.1:'+server.address().port);
 const frame=await page.locator('#app').contentFrame();await frame.locator('#preview [data-bind]').first().waitFor();
 const pause=ms=>page.waitForTimeout(ms);
 const loc=selector=>typeof selector==='string'?frame.locator(selector).first():selector;
 const flush=async()=>{await frame.locator('body').evaluate(()=>ContractApp.flush());await pause(160)};
 const stage=async(step,title,subtitle,chapter=false)=>{await page.evaluate(v=>lesson.title(...v),[step,title,subtitle]);if(chapter)scenes.push({step,title,time:recorder?recorder.frames/25:0});console.log('Scene:',step,title)};
 async function camera(selector=null,scale=1){
  let s=scale,x,y;
  if(!selector){s=.84;x=(1920-1600*s)/2;y=(876-1000*s)/2}
  else{const r=await loc(selector).evaluate(n=>{const b=n.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height}});s=Math.min(s,1800/r.width,824/r.height);x=960-s*(r.x+r.width/2);y=438-s*(r.y+r.height/2)}
  await page.evaluate(v=>lesson.camera(...v),[s,x,y]);await pause(1150);
 }
 async function cameraArea(area,scale=1.5){scale=Math.min(scale,1800/area.width,824/area.height);await page.evaluate(v=>lesson.camera(...v),[scale,960-scale*(area.x+area.width/2),438-scale*(area.y+area.height/2)]);await pause(1150)}
 async function point(selector,click=false){
  const r=await loc(selector).boundingBox();assert(r,'No target '+selector);
  const x=r.x+Math.min(r.width*.55,r.width-8),y=r.y+r.height/2;
  assert(x>12&&x<1908&&y>135&&y<1003,`Target outside video stage ${selector}: ${x}, ${y}`);
  await page.evaluate(v=>lesson.cursor(v.x,v.y),{x,y});
  await page.mouse.move(x,y,{steps:12});await pause(800);
  if(click){await page.evaluate(v=>lesson.click(v.x,v.y),{x,y});await page.mouse.click(x,y);await pause(400)}
 }
 async function replace(selector,value,{type=true}={}){
  await point(selector,true);
  await loc(selector).press('Control+A');
  if(type)await loc(selector).pressSequentially(value,{delay:45});else await loc(selector).fill(value);
  await flush();await pause(600);
 }
 async function scroll(selector,offset=24){
  const node=loc(selector);
  const panel=await node.evaluate(n=>(n.closest('.body')?'.fields-panel .body':'.preview-scroll'));
  await point(panel);
  const delta=await node.evaluate((n,offset)=>{const p=n.closest('.body')||n.closest('.preview-scroll');const target=n.closest('.field')||n;return target.getBoundingClientRect().top-p.getBoundingClientRect().top-offset},offset);
  await page.mouse.wheel(0,delta);await pause(1000);
  // Finish exactly at the label, avoiding cropped controls at the panel edge.
  await node.evaluate((n,offset)=>{const p=n.closest('.body')||n.closest('.preview-scroll');const target=n.closest('.field')||n;p.scrollTop+=target.getBoundingClientRect().top-p.getBoundingClientRect().top-offset},offset);
  await pause(200);
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
 // Follow one normal contract from start to finish; no feature experiments.
 await stage(0,'Нажмите «Настройки»','Внизу левого окна. Настройка нужна только один раз.',true);await pause(1800);await shot('00-overview');
 await point('details summary',true);
 await loc('details').evaluate(n=>n.scrollIntoView({block:'end'}));await pause(500);
 await camera('details',1.7);
 await stage(0,'Укажите свой город','В этом примере — Москва.');await replace('#city','Москва');await pause(1100);
 await stage(0,'Укажите год договора','В этом примере — 2026.');await replace('#documentYear','2026');await pause(1000);
 await stage(0,'Нажмите «Сохранить»','Появится «Сохранено». Город и год останутся для следующих договоров.');await point('#saveSettings',true);await pause(2700);
 assert((await loc('#settingsStatus').innerText()).includes('Сохранено'));await shot('01-office-saved');
 await camera();await point('details summary',true);await pause(700);

 await stage(1,'Вставьте информацию о рассрочке','Нажмите в левое окно и вставьте сообщение специалиста.',true);await pause(1600);
 const messageArea=await loc('#source').evaluate(n=>{const a=n.getBoundingClientRect(),b=document.querySelector('#recognize').getBoundingClientRect();return{x:a.x-12,y:a.y-12,width:a.width+24,height:b.bottom-a.top+24}});
 await cameraArea(messageArea,1.55);await point('#source',true);await loc('#source').fill(sample);await flush();await pause(2500);await shot('02-message-overview');
 await stage(1,'Нажмите «Распознать»','Дождитесь появления данных во втором окне.');await point('#recognize',true);await flush();await pause(1400);
 assert.equal(await loc('#product').inputValue(),'Terra BTE-SP — 2 шт.');assert.equal(await loc('#total').inputValue(),'74 000');assert.equal(await loc('#downPayment').inputValue(),'37 000');assert.equal(await loc('#months').inputValue(),'3');

 await stage(2,'Проверьте данные во втором окне','Если чего-то не хватает — впишите вручную.',true);await camera();await pause(2100);await shot('03-recognized-overview');
 await camera('#nameFields',1.45);await stage(2,'Проверьте ФИО','Исправьте поле, если в нём ошибка.');await point('#fullName');await pause(2000);
 await camera();await stage(2,'Прокрутите второе окно ниже','Проверьте аппараты, стоимость, взнос и срок.');await scroll('#product');await camera('#purchaseFields',1.4);await point('#total');await pause(1700);await point('#downPayment');await pause(1500);await point('#months');await pause(1500);await shot('04-purchase-checked');
 await camera();await stage(2,'Укажите дату договора','Для сегодняшней даты нажмите «Сегодня».');await scroll('#contractDate',160);await camera('.date-row',1.7);await point('#today',true);await flush();await pause(1800);
 assert((await loc('#contractDate').inputValue()).match(/^\d{2}\.\d{2}\.2026$/));

 await stage(2,'Прокрутите до «Реквизиты покупателя»','Паспортные данные вводятся в том же, втором окне.',true);await camera();await scroll('#identityFields');await pause(1300);await shot('05-identity-overview');await camera('#identityFields',1.55);
 await stage(2,'Введите серию и номер паспорта','Перенесите данные покупателя в это поле.');await replace('#passport','0000 123456');await pause(500);
 await stage(2,'Введите дату выдачи паспорта','День, месяц и год.');await replace('#passportDate','10.10.2020');await pause(500);
 await stage(2,'Укажите, кем выдан паспорт','Заполните поле под датой выдачи.');await replace('#passportIssuer','Учебный отдел МВД');await pause(500);
 await stage(2,'Введите адрес покупателя','Поле «Адрес» находится ниже.');await replace('#address','Учебная улица, дом 10');await pause(500);
 await stage(2,'Введите телефон покупателя','Проверьте, что все нужные поля заполнены.');await replace('#phone','+7 900 000-00-00');await pause(1700);await shot('06-identity-filled');

 await stage(3,'Проверьте договор справа','Прокрутите правое окно и сверьте данные на каждой странице.',true);await camera();await pause(2000);
 await stage(3,'Выберите масштаб 60%','Так страница будет видна целиком.');await point('#zoom',true);await loc('#zoom').press('Home');await loc('#zoom').press('Enter');await flush();assert.equal(await loc('#zoom').inputValue(),'.6');await pause(700);
 const printPages=frame.locator('#preview .docx-wrapper > section.docx');const pageCount=await printPages.count();assert(pageCount>=2&&pageCount<=3);
 for(let i=0;i<pageCount;i++){
  await camera();
  await stage(3,i===2?'Проверьте акт':'Проверьте страницу '+(i+1),i===0?'Сверьте ФИО, аппараты и стоимость.':i===1?'Сверьте график платежей и реквизиты покупателя.':'Сверьте данные покупателя и наименование аппаратов.');
  const paper=printPages.nth(i);await scroll(paper,10);await camera(paper,1.2);
  const paperRect=await paper.boundingBox();assert(paperRect.x>=8&&paperRect.y>=140&&paperRect.x+paperRect.width<=1912&&paperRect.y+paperRect.height<=1000,'Printed page is cropped');
  const clip=await frame.locator('#previewScroll').boundingBox();assert(paperRect.y>=clip.y-2&&paperRect.y+paperRect.height<=clip.y+clip.height+2,'Printed page clipped by preview viewport');
  pageBounds.push({page:i+1,...paperRect});
  const target=i===0?paper.locator('[data-bind="fullName"]').first():i===1?paper.locator('[data-bind="passport"]').first():paper.locator('[data-bind="product"]').first();
  await point(target);await pause(3500);await shot('07-print-page-'+(i+1));
 }
 const amounts=await frame.locator('#preview [data-bind$="amount"]').evaluateAll(ns=>ns.map(n=>n.textContent.replace(/\s/g,'')));assert(amounts.includes('12300')&&amounts.includes('12400'));assert(!/батарей|футляр/i.test(await loc('#preview').innerText()));

 await stage(4,'Нажмите «Скачать и распечатать»','После проверки сохраните готовый договор.',true);await camera();await pause(1600);await point('#download');await pause(1000);await shot('10-download-button');
 const pending=page.waitForEvent('download');await point('#download',true);const download=await pending;await download.saveAs(path.join(out,'tutorial-contract.docx'));assert.equal(await download.failure(),null);assert(fs.statSync(path.join(out,'tutorial-contract.docx')).size>10000);
 await stage(4,'Откройте скачанный Word и распечатайте','Файл будет в папке загрузок браузера. Обычно это «Загрузки».');await pause(3500);
 await stage(4,'Скачайте договор перед закрытием HTML','Данные покупателя после закрытия не сохраняются.');await pause(3500);await shot('11-finished');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const end=recorder.frames/25;
 await recorder.stop();
 await context.close();context=null;
 const manifest={appSha256:crypto.createHash('sha256').update(source).digest('hex'),duration:end,chapters:scenes,checks:{wordDownloaded:true,officeSaved:true,automaticDeposit:true,noTermChangeDemo:true,noFloatingFrames:true,fullPrintedPages:pageBounds,identityInPreview:true,roundedAmounts:[12300,12300,12400],noExternalRequests:true}};
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
