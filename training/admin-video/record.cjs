// Record the real standalone app. Tutorial overlays never enter the app file.
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),crypto=require('crypto'),assert=require('assert/strict');
const {spawn,spawnSync}=require('child_process');
const root=path.resolve(__dirname,'../..'),out='/tmp/contract-staff-video-popups';
const preview=process.argv.includes('--preview');fs.mkdirSync(out,{recursive:true});
const sample='Попов Владимир Геннадьевич\nПравое ухо: Terra BTE-SP\nЛевое ухо: Terra BTE-SP\nИтого 74 000 руб., наша рассрочка.\nВ подарок: батарейки и футляр.';
(async()=>{
 const source=fs.readFileSync(path.join(root,'dist/Договор рассрочки.html'));
 const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(q.url==='/app'?source:fs.readFileSync(path.join(__dirname,'shell.html')))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 let context,recorder;const scenes=[],errors=[],external=[],pageBounds=[];
 try{
 context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,acceptDownloads:true});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:'))external.push(r.url())});
 await page.goto('http://127.0.0.1:'+server.address().port);
 const frame=await page.locator('#app').contentFrame();await frame.locator('#preview [data-bind]').first().waitFor();
 const loc=s=>typeof s==='string'?frame.locator(s).first():s;
 const pause=ms=>page.waitForTimeout(preview?Math.max(50,ms/7):ms);
 const flush=async()=>{await frame.locator('body').evaluate(()=>ContractApp.flush());await pause(120)};
 const fields=(...selectors)=>({selectors,closest:'.field'});
 async function tip(step,title,body,target,side='left',chapter=false){
  await page.evaluate(v=>lesson.show(...v),[title,body,target,side]);
  if(chapter)scenes.push({step,title,time:recorder?recorder.frames/25:0});
  console.log('Action:',title);await pause(1500);
 }
 async function target(selector,side='left'){await page.evaluate(v=>lesson.target(...v),[selector,side])}
 async function camera(selector=null,scale=1.5){
  let x,y,s=scale;
  if(!selector){s=1.02;x=(1920-1600*s)/2;y=(1080-1000*s)/2}
  else{const r=await loc(selector).evaluate(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}});s=Math.min(scale,1400/r.width,990/r.height);x=1120-s*(r.x+r.width/2);y=540-s*(r.y+r.height/2)}
  await page.evaluate(v=>lesson.camera(...v),[s,x,y,preview]);await pause(720);
 }
 async function cameraArea(r,scale=1.5){scale=Math.min(scale,1400/r.width,990/r.height);await page.evaluate(v=>lesson.camera(...v),[scale,1120-scale*(r.x+r.width/2),540-scale*(r.y+r.height/2),preview]);await pause(720)}
 async function point(selector,click=false){
  const r=await loc(selector).boundingBox();assert(r,'No target '+selector);const x=r.x+r.width*.52,y=r.y+r.height/2;
  assert(x>8&&x<1912&&y>8&&y<1072,`Pointer outside screen: ${selector} ${x},${y}`);
  await page.evaluate(v=>lesson.cursor(v.x,v.y,v.instant),{x,y,instant:preview});await page.mouse.move(x,y,{steps:8});await pause(360);
  if(click){
   await page.evaluate(v=>lesson.press(true,v.x,v.y),{x,y});await page.mouse.down();await page.waitForTimeout(130);
   if(selector==='#saveSettings')await page.screenshot({path:path.join(out,(preview?'preview-':'')+'click-feedback.png')});
   await page.mouse.up();await page.evaluate(v=>lesson.press(false,v.x,v.y),{x,y});await pause(240);
  }
 }
 async function fill(selector,value){await point(selector,true);await loc(selector).press('Control+A');await loc(selector).pressSequentially(value,{delay:preview?0:28});await flush();await pause(250)}
 async function scroll(selector,offset=24){
  const n=loc(selector),panel=await n.evaluate(n=>n.closest('.body')?'.fields-panel .body':'.preview-scroll');
  await point(panel);
  const dy=await n.evaluate((n,offset)=>{const p=n.closest('.body')||n.closest('.preview-scroll'),a=n.closest('.field')||n;return a.getBoundingClientRect().top-p.getBoundingClientRect().top-offset},offset);
  await page.mouse.wheel(0,dy);await pause(600);
  await n.evaluate((n,offset)=>{const p=n.closest('.body')||n.closest('.preview-scroll'),a=n.closest('.field')||n;p.scrollTop+=a.getBoundingClientRect().top-p.getBoundingClientRect().top-offset},offset);await pause(100);
 }
 let browserAlignmentChecks=0;
 async function shot(name){
  await page.waitForTimeout(40);
  const m=await page.evaluate(()=>lesson.metrics());
  if(m.focus){
   // Check the mapping independently through Playwright's browser-coordinate
   // boxes, not just by comparing the overlay to its own calculation.
   const spec=typeof m.focus==='string'?{selectors:[m.focus]}:m.focus,boxes=[];
   for(const selector of spec.selectors){
    let handle=await loc(selector).elementHandle();
    if(spec.closest)handle=(await handle.evaluateHandle((n,c)=>n.closest(c),spec.closest)).asElement();
    boxes.push(await handle.boundingBox());await handle.dispose();
   }
   const x=Math.min(...boxes.map(r=>r.x)),y=Math.min(...boxes.map(r=>r.y)),r=Math.max(...boxes.map(r=>r.x+r.width)),b=Math.max(...boxes.map(r=>r.y+r.height));
   assert(Math.max(Math.abs(m.outline.x-(x-5)),Math.abs(m.outline.y-(y-5)),Math.abs(m.outline.width-(r-x+10)),Math.abs(m.outline.height-(b-y+10)))<1,'Outline does not match browser target at '+name);
   browserAlignmentChecks++;
  }
  await page.screenshot({path:path.join(out,(preview?'preview-':'')+name+'.png')});
 }
 // Use an existing viewer setting so complete pages fit throughout the lesson.
 await loc('#zoom').selectOption('.6');await flush();await camera();
 const videoPath=path.join(out,'recorded-lesson.mp4');
 if(!preview){
  const cdp=await context.newCDPSession(page);
  const encoder=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-vcodec','mjpeg','-framerate','25','-i','pipe:0','-an','-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p','-threads','4',videoPath],{stdio:['pipe','ignore','pipe']});
  let encoderErrors='',latestFrame,closed=false;encoder.stderr.on('data',d=>encoderErrors+=d);encoder.stdin.on('error',e=>errors.push(e.message));
  const finished=new Promise((resolve,reject)=>{encoder.on('error',reject);encoder.on('close',code=>code===0?resolve():reject(Error(encoderErrors)))});
  cdp.on('Page.screencastFrame',e=>{latestFrame=Buffer.from(e.data,'base64');cdp.send('Page.screencastFrameAck',{sessionId:e.sessionId}).catch(()=>{})});
  let timer;recorder={frames:0,async stop(){if(closed)return;closed=true;clearInterval(timer);await cdp.send('Page.stopScreencast').catch(()=>{});encoder.stdin.end();await finished}};
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:85,maxWidth:1920,maxHeight:1080,everyNthFrame:2});
  timer=setInterval(()=>{if(latestFrame){encoder.stdin.write(latestFrame);recorder.frames++}},40);
 }
 await tip(0,'Нажмите «Настройки»','Город и год задаются один раз.','details summary','right',true);await shot('00-overview');await point('details summary',true);
 await loc('details').evaluate(n=>n.scrollIntoView({block:'end'}));await pause(250);await page.evaluate(()=>lesson.hide());
 await target(fields('#city','#documentYear'));await camera('details',1.65);
 await tip(0,'Введите город и год','Укажите данные своего филиала.',fields('#city','#documentYear'));
 await fill('#city','Москва');await fill('#documentYear','2026');await shot('01-settings');
 await tip(0,'Нажмите «Сохранить»','Настройки останутся для следующих договоров.','#saveSettings');await point('#saveSettings',true);await pause(900);
 assert((await loc('#settingsStatus').innerText()).includes('Сохранено'));
 await tip(0,'Настройки сохранены','Переходим к заполнению договора.','details summary');await point('details summary',true);await page.evaluate(()=>lesson.hide());await camera();

 await tip(1,'Вставьте сообщение специалиста','В левое окно.','#source','right',true);
 const message=await loc('#source').evaluate(n=>{const a=n.getBoundingClientRect(),b=document.querySelector('#recognize').getBoundingClientRect();return{x:a.x-12,y:a.y-12,width:a.width+24,height:b.bottom-a.top+24}});
 await cameraArea(message,1.45);await point('#source',true);await loc('#source').fill(sample);await flush();await pause(1800);await shot('02-message');
 await tip(1,'Нажмите «Распознать»','Данные появятся во втором окне.','#recognize');await point('#recognize',true);await flush();await pause(800);
 assert.equal(await loc('#total').inputValue(),'74 000');assert.equal(await loc('#downPayment').inputValue(),'37 000');assert.equal(await loc('#months').inputValue(),'3');
 await page.evaluate(()=>lesson.hide());await camera();
 await tip(2,'Дополните пустые поля','Во втором окне.','.fields-panel','left',true);await shot('03-recognized');
 await target('.fields-panel .body');await scroll('#contractDate',160);await target('.date-row');await camera('.date-row',1.5);
 await tip(2,'Укажите дату договора','Например, нажмите «Сегодня».','.date-row');await point('#today',true);await flush();await pause(600);
 await page.evaluate(()=>lesson.hide());await camera();
 await tip(2,'Введите паспортные данные','Прокрутите второе окно ниже.','.fields-panel .body','left',true);await scroll('#identityFields');
 await target(fields('#passport','#passportDate','#passportIssuer'));await camera('#identityFields',1.55);
 await fill('#passport','0000 123456');await fill('#passportDate','10.10.2020');await fill('#passportIssuer','Учебный отдел МВД');await shot('04-passport');
 await tip(2,'Укажите адрес и телефон','Данные сразу попадут в договор.',fields('#address','#phone'));
 await fill('#address','Учебная улица, дом 10');await fill('#phone','+7 900 000-00-00');await pause(800);await shot('05-identity-filled');
 // One review instruction, after all fields have been completed. It stays in
 // the same card while the camera reveals each whole page; the text is not reset.
 await page.evaluate(()=>lesson.hide());await camera();
 await tip(3,'Проверьте все данные!','В форме и в договоре справа.',{selectors:['.fields-panel','.preview-panel']},'left',true);await pause(1600);await shot('06-review');
 const papers=frame.locator('#preview .docx-wrapper > section.docx');const count=await papers.count();assert.equal(count,2);
 for(let i=0;i<count;i++){
  const selector=`#preview .docx-wrapper > section.docx:nth-of-type(${i+1})`,paper=papers.nth(i);
  // Keep the single review card, but wait until the next paper is on screen
  // before drawing its outline. Never box a sliver of an off-screen page.
  await target(null);await camera();await scroll(paper,12);await target(selector);await camera(paper,1.4);
  const r=await paper.boundingBox(),clip=await frame.locator('#previewScroll').boundingBox();
  assert(r.x>=8&&r.y>=8&&r.x+r.width<=1912&&r.y+r.height<=1072,'Page cropped by video');
  assert(r.y>=clip.y-2&&r.y+r.height<=clip.y+clip.height+2,'Page clipped by preview');pageBounds.push({page:i+1,...r});
  await point(paper.locator(i?'[data-bind="passport"]':'[data-bind="fullName"]').first());await pause(1900);await shot('07-page-'+(i+1));
 }
 await page.evaluate(()=>lesson.hide());await camera();
 await tip(4,'Нажмите «Скачать и распечатать»','Сохранится заполненный документ Word.','#download','left',true);await shot('08-download');
 const pending=page.waitForEvent('download');await point('#download',true);const download=await pending;await download.saveAs(path.join(out,'tutorial-contract.docx'));assert.equal(await download.failure(),null);assert(fs.statSync(path.join(out,'tutorial-contract.docx')).size>10000);
 await tip(4,'Готово!','Откройте Word из папки загрузок и распечатайте.','#download');await pause(1800);await shot('09-finished');
 const metrics=await page.evaluate(()=>lesson.metrics());
 assert(metrics.samples>100);assert(metrics.maxAlignmentError<.1,'Outline drifted');assert.equal(metrics.maxTipOverlap,0,'Tip covers active area');assert(metrics.clicks>=10);
 assert.equal(metrics.cards.filter(t=>t==='Проверьте все данные!').length,1);
 assert(!metrics.cards.some(t=>/Проверьте ФИО|Проверьте данные|месяц/i.test(t)));
 assert.equal(await page.locator('body > header,body > footer').count(),0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 if(preview){console.log('PREVIEW PASS',JSON.stringify({browserAlignmentChecks,...metrics}));return}
 const duration=recorder.frames/25;await recorder.stop();await context.close();context=null;
 const manifest={appSha256:crypto.createHash('sha256').update(source).digest('hex'),duration,chapters:scenes,checks:{wordDownloaded:true,popupGuidance:true,noPermanentPanels:true,domTrackedFrames:true,maxFrameError:metrics.maxAlignmentError,alignmentSamples:metrics.samples,noTipOverlap:metrics.maxTipOverlap===0,animatedClicks:metrics.clicks,singleReviewNotice:true,noTermChangeDemo:true,fullPrintedPages:pageBounds,noExternalRequests:true},cards:metrics.cards};
 fs.writeFileSync(path.join(__dirname,'chapters.json'),JSON.stringify(manifest,null,2));
 let metadata=';FFMETADATA1\ntitle=Договор рассрочки — пошаговая инструкция\n';
 for(let i=0;i<scenes.length;i++)metadata+='[CHAPTER]\nTIMEBASE=1/1000\nSTART='+Math.round(scenes[i].time*1000)+'\nEND='+Math.round((scenes[i+1]?.time||duration)*1000)+'\ntitle=Шаг '+scenes[i].step+'. '+scenes[i].title+'\n';
 const meta=path.join(out,'chapters.ffmeta');fs.writeFileSync(meta,metadata);console.log('Encoding',duration.toFixed(1),'seconds');
 const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',videoPath,'-i',meta,'-map','0:v:0','-map_metadata','1','-map_chapters','1','-an','-c:v','libx264','-preset','medium','-crf','26','-threads','4','-vf','scale=in_range=pc:out_range=tv','-color_range','tv','-pix_fmt','yuv420p','-movflags','+faststart',path.join(root,'dist/staff-walkthrough.mp4')],{stdio:'inherit'});assert.equal(result.status,0);
 console.log('PASS: popup tutorial, anchored frames, click animation, Word download. Metrics:',JSON.stringify(metrics));
 }finally{if(recorder)await recorder.stop();if(context)await context.close();await browser.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
