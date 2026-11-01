// Tutorial for the uploaded trial-wearing HTML. App bytes remain unchanged.
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),crypto=require('crypto'),assert=require('assert/strict');
const {spawnSync}=require('child_process');
const {startPageRecording}=require('../../tools/system-video-recorder.cjs');
const root=path.resolve(__dirname,'../..');
const preview=process.argv.includes('--preview');
const out=process.env.TRIAL_VIDEO_WORK||'/tmp/trial-staff-video';
fs.mkdirSync(out,{recursive:true});
const sample='Попов Владимир Геннадьевич\nПравое ухо: Audeo L50-R\nЛевое ухо: Audeo L50-R\nЗарядное устройство: Charger Ease\nИтого: 150 000 руб.\nПробное ношение на 7 дней.\nВ подарок: батарейки и футляр.';
const people=['Иванов И. И.','Петрова А. В.'];
(async()=>{
 const source=fs.readFileSync(path.join(root,'dist/trial-wearing/Пробное ношение.html'));
 const shell=fs.readFileSync(path.join(__dirname,'shell.html'));
 const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(q.url==='/app'?source:shell)});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser,context,recorder;
 const errors=[],external=[],chapters=[],shots=[],checks={};
 try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,acceptDownloads:true,timezoneId:'Europe/Moscow'});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:'))external.push(r.url())});
  await page.goto('http://127.0.0.1:'+server.address().port);
  const frame=page.frames().find(f=>f.url().endsWith('/app'));
  assert(frame,'Missing app frame');
  const loc=s=>typeof s==='string'?frame.locator(s).first():s;
  const pause=ms=>page.waitForTimeout(preview?Math.max(60,ms/6):ms);
  async function ready(){await loc('#preview [data-bind]').waitFor();await frame.evaluate(()=>TrialApp.ready())}
  await ready();
  async function flush(){await page.waitForTimeout(300);await frame.evaluate(()=>TrialApp.flush());await page.waitForTimeout(70)}
  const fields=(...selectors)=>({selectors,closest:'.field'});
  async function tip(step,title,body,target,side='left',chapter=false){
   await page.evaluate(v=>lesson.show(...v),[title,body,target,side]);
   if(chapter)chapters.push({step,title,time:recorder?recorder.seconds:0});
   console.log('Action:',title);await pause(1300);
  }
  async function target(t,side='left'){await page.evaluate(v=>lesson.target(...v),[t,side])}
  async function hide(){await page.evaluate(()=>lesson.hide())}
  async function camera(selector=null,scale=1.5){
   let x,y,s=scale;
   if(!selector){s=1.02;x=(1920-1600*s)/2;y=(1080-1000*s)/2}
   else{const r=await loc(selector).evaluate(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}});s=Math.min(scale,1380/r.width,960/r.height);x=1140-s*(r.x+r.width/2);y=540-s*(r.y+r.height/2)}
   await page.evaluate(v=>lesson.camera(...v),[s,x,y,preview]);await pause(710);
  }
  async function point(selector,click=false){
   const r=await loc(selector).boundingBox();assert(r,'Missing '+selector);
   const x=r.x+r.width*.52,y=r.y+r.height/2;
   assert(x>8&&x<1912&&y>8&&y<1072,`Pointer outside screen: ${selector} ${x},${y}`);
   await page.evaluate(v=>lesson.cursor(v.x,v.y,v.instant),{x,y,instant:preview});
   await page.mouse.move(x,y,{steps:8});await pause(280);
   if(click){
    await page.evaluate(v=>lesson.press(true,v.x,v.y),{x,y});await page.mouse.down();await page.waitForTimeout(110);
    if(selector==='#saveSettings')await page.screenshot({path:path.join(out,(preview?'preview-':'')+'click-feedback.png')});
    await page.mouse.up();await page.evaluate(v=>lesson.press(false,v.x,v.y),{x,y});await pause(170);
   }
  }
  async function fill(selector,value,{paste=false}={}){
   await point(selector,true);
   if(paste)await loc(selector).fill(value);
   else{await loc(selector).press('Control+A');await loc(selector).pressSequentially(value,{delay:preview?0:23})}
   await flush();await pause(170);
  }
  async function scroll(selector,offset=20){
   const n=loc(selector);
   const panel=await n.evaluate(n=>n.closest('.source-body')?'.source-body':n.closest('.fields-panel')?'.fields-panel .body':'.preview-scroll');
   await point(panel);
   const dy=await n.evaluate((n,offset)=>{const p=n.closest('.body')||n.closest('.preview-scroll'),a=n.closest('.field')||n;return a.getBoundingClientRect().top-p.getBoundingClientRect().top-offset},offset);
   await page.mouse.wheel(0,dy);await pause(450);
   await n.evaluate((n,offset)=>{const p=n.closest('.body')||n.closest('.preview-scroll'),a=n.closest('.field')||n;p.scrollTop+=a.getBoundingClientRect().top-p.getBoundingClientRect().top-offset},offset);
   await pause(110);
  }
  async function shot(name){
   await page.waitForTimeout(60);
   const m=await page.evaluate(()=>lesson.metrics());
   if(m.focus){
    const spec=typeof m.focus==='string'?{selectors:[m.focus]}:m.focus,boxes=[];
    for(const s of spec.selectors){
     let handle=await loc(s).elementHandle();
     if(spec.closest)handle=(await handle.evaluateHandle((n,c)=>n.closest(c),spec.closest)).asElement();
     boxes.push(await handle.boundingBox());await handle.dispose();
    }
    // Independently compare with browser boxes at settled, fully visible targets.
    const x=Math.max(8,Math.min(...boxes.map(r=>r.x))),y=Math.max(8,Math.min(...boxes.map(r=>r.y)));
    const r=Math.min(1912,Math.max(...boxes.map(r=>r.x+r.width))),b=Math.min(1072,Math.max(...boxes.map(r=>r.y+r.height)));
    assert(Math.max(Math.abs(m.outline.x-(x-5)),Math.abs(m.outline.y-(y-5)),Math.abs(m.outline.width-(r-x+10)),Math.abs(m.outline.height-(b-y+10)))<1,'Frame does not match browser bounds: '+name);
   }
   const file=path.join(out,(preview?'preview-':'')+name+'.png');
   await page.screenshot({path:file});shots.push({name,time:recorder?recorder.seconds:0});
  }
  await loc('#zoom').selectOption('.6');await camera();
  if(!preview)recorder=await startPageRecording(page,path.join(out,'recorded-lesson.mp4'));

  await tip(0,'Нажмите «Настройки»','Настройте центр один раз — или когда данные изменятся.','details summary','right',true);
  await shot('00-overview');await point('details summary',true);
  await loc('details').evaluate(n=>n.scrollIntoView({block:'end'}));await pause(250);await hide();
  await camera('details',1.55);
  await tip(0,'Введите город и год','Укажите данные своего центра.',fields('#city','#documentYear'));
  await fill('#city','Москва');await fill('#documentYear','2026');await shot('01-city-year');
  await tip(0,'Добавьте специалистов','Каждого — с новой строки.',fields('#officeSpecialists'));
  await fill('#officeSpecialists',people.join('\n'));await shot('02-specialists');
  await tip(0,'Нажмите «Сохранить»','Город, год и список останутся в этом браузере.','#saveSettings');
  await point('#saveSettings',true);await pause(650);
  assert.match(await loc('#settingsStatus').innerText(),/Сохранено/);
  await shot('03-settings-saved');
  await hide();await camera();
  // Reload only the real iframe, keeping the tutorial overlay and recorder live.
  await frame.goto(frame.url());await ready();
  const saved=await frame.evaluate(()=>TrialApp.getState());
  assert.equal(saved.settings.city,'Москва');assert.equal(saved.settings.year,2026);assert.deepEqual(saved.settings.specialists,people);
  assert.equal(saved.fields.specialist,'');
  checks.settingsSurviveReload=true;checks.specialistNotAutoSelected=true;
  await loc('#zoom').selectOption('.6');
  await tip(0,'Выберите специалиста','Для каждого нового бланка — нужной кнопкой.',fields('#specialist'),'left',true);
  await camera('#specialistChoices',1.6);await point('#specialistChoices button:first-child',true);await flush();
  assert.equal(await loc('#specialist').inputValue(),people[0]);await shot('04-specialist-selected');
  await hide();await camera();
  await frame.locator('.fields-panel .body').evaluate(n=>n.scrollTop=0);

  await tip(1,'Вставьте сообщение специалиста','В левое окно.','#source','right',true);
  await camera('#source',1.25);await fill('#source',sample,{paste:true});await pause(1100);await shot('05-message');
  await tip(1,'Нажмите «Распознать»','Файл возьмёт нужные сведения.','#recognize');
  await point('#recognize',true);await flush();
  const parsed=await frame.evaluate(()=>TrialApp.getState());
  assert.equal(parsed.fields.fullName,'Попов Владимир Геннадьевич');assert.equal(parsed.fields.total,'150 000');assert.equal(parsed.fields.deposit,'150 000');
  assert.match(parsed.fields.product,/Audeo L50-R — 2 шт\./);assert.match(parsed.fields.product,/ЗУ Phonak Charger Ease/);assert(!/батарей|футляр/i.test(parsed.fields.product));
  assert.equal(parsed.fields.visitDate,parsed.fields.endDate);checks.recognition=true;checks.depositEqualsTotal=true;
  await hide();await camera();
  await tip(2,'Данные уже во втором окне','Любое поле можно заполнить или исправить вручную.','.fields-panel','left',true);
  await pause(1100);await shot('06-recognized');
  await hide();await scroll('#total',20);await camera('#issueFields',1.3);
  await tip(2,'Залог заполнился сам','По умолчанию — полная стоимость приборов.',fields('#total','#deposit'));
  await pause(800);await shot('07-amounts');
  await hide();await camera();await scroll('#dateFields',20);await camera('#dateFields',1.45);
  await tip(2,'Укажите дату бланка','Например, нажмите «Сегодня».',fields('#contractDate'));
  await point('#contractDateToday',true);await flush();
  await tip(2,'Срок уже рассчитан','Неделя и дата посещения — автоматически. При необходимости исправьте.',fields('#startDate','#endDate','#visitDate'));
  await pause(800);await shot('08-dates');

  await hide();await camera();await scroll('#identityFields',20);await camera('#identityFields',1.4);
  await tip(2,'Введите паспортные данные','Серию и номер, дату выдачи и кем выдан.',fields('#passport','#passportDate','#passportIssuer'),'left',true);
  await fill('#passport','0000 123456');await fill('#passportDate','10.10.2020');await fill('#passportIssuer','Учебный отдел МВД');
  await shot('09-passport');
  await tip(2,'Укажите адрес и телефон','Они сразу появятся в бланке справа.',fields('#address','#phone'));
  await fill('#address','г. Москва, Учебная ул., д. 10');await fill('#phone','+7 900 000-00-00');await pause(600);await shot('10-contacts');
  await hide();await camera();
  const paper=frame.locator('#preview .docx-wrapper > section.docx');assert.equal(await paper.count(),1);
  await scroll(paper,12);await camera(paper,1.4);
  await tip(3,'Проверьте все данные!','В готовом бланке справа. Текст можно исправить прямо здесь.','#preview .docx-wrapper > section.docx','left',true);
  const r=await paper.boundingBox(),clip=await loc('#previewScroll').boundingBox();
  assert(r.x>=8&&r.y>=8&&r.x+r.width<=1912&&r.y+r.height<=1072,'Paper cropped by video');
  assert(r.y>=clip.y-2&&r.y+r.height<=clip.y+clip.height+2,'Paper cropped by preview');
  checks.wholeDocumentVisible=r;
  await point(paper.locator('[data-bind="surname"]').first());await pause(1900);await shot('11-whole-document');
  const finalState=await frame.evaluate(()=>TrialApp.getState());
  assert.equal(await loc('#fatal').isVisible(),false);assert(!await loc('#validation').evaluate(n=>n.classList.contains('warn')));
  checks.allFieldsFilled=Object.values(finalState.fields).every(Boolean);assert(checks.allFieldsFilled);

  await hide();await camera();
  await tip(4,'Нажмите «Скачать и распечатать»','Бланк Word сохранится в папке загрузок браузера.','#download','left',true);
  await shot('12-download');const pending=page.waitForEvent('download');await point('#download',true);
  const download=await pending,word=path.join(out,'tutorial-trial.docx');await download.saveAs(word);
  assert.equal(await download.failure(),null);assert(fs.statSync(word).size>10000);
  const L=await frame.evaluate(async()=>{const z=await TrialLibs.JSZip.loadAsync(Uint8Array.from(atob(document.querySelector('#embeddedTemplate').textContent.trim()),c=>c.charCodeAt(0)));return {template:await z.generateAsync({type:'base64'}),xml:TrialApp.getXml()}});
  fs.writeFileSync(path.join(out,'embedded-template.docx'),Buffer.from(L.template,'base64'));
  fs.writeFileSync(path.join(out,'final-state.json'),JSON.stringify(finalState,null,2));
  fs.writeFileSync(path.join(out,'final-word.xml'),L.xml);
  checks.wordDownloaded=true;
  await tip(4,'Готово!','Откройте скачанный Word и распечатайте.','#download');await pause(1900);await shot('13-finished');
  const metrics=await page.evaluate(()=>lesson.metrics());
  assert(metrics.samples>100);assert(metrics.maxAlignmentError<.1);assert.equal(metrics.maxTipOverlap,0,'Popup covers target');assert(metrics.clicks>=12);
  assert.equal(metrics.cards.filter(t=>t==='Проверьте все данные!').length,1);
  assert.equal(await page.locator('body > header,body > footer').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const manifest={appSha256:crypto.createHash('sha256').update(source).digest('hex'),chapters,shots,checks,metrics};
  if(preview){fs.writeFileSync(path.join(out,'preview-checks.json'),JSON.stringify(manifest,null,2));console.log('PREVIEW PASS',JSON.stringify(metrics));return}
  const recording=await recorder.stop();assert(recording.updates>100);manifest.recording=recording;
  fs.writeFileSync(path.join(__dirname,'chapters.json'),JSON.stringify(manifest,null,2));
  let meta=';FFMETADATA1\ntitle=Пробное ношение — инструкция для администраторов\n';
  for(let i=0;i<chapters.length;i++)meta+='[CHAPTER]\nTIMEBASE=1/1000\nSTART='+Math.round(chapters[i].time*1000)+'\nEND='+Math.round((chapters[i+1]?.time||recording.duration)*1000)+'\ntitle=Шаг '+chapters[i].step+'. '+chapters[i].title+'\n';
  const metadata=path.join(out,'chapters.ffmeta');fs.writeFileSync(metadata,meta);
  const output=path.join(root,'dist/trial-wearing/staff-walkthrough.mp4');
  const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',recording.output,'-i',metadata,'-map','0:v:0','-map_metadata','1','-map_chapters','1','-c:v','copy','-movflags','+faststart',output],{stdio:'inherit'});
  assert.equal(result.status,0);console.log('PASS',output,recording.duration+' sec',fs.statSync(output).size+' bytes');
 }finally{
  if(recorder)await recorder.stop();if(context)await context.close();if(browser)await browser.close();await new Promise(r=>server.close(r));
 }
})().catch(e=>{console.error(e);process.exitCode=1});
