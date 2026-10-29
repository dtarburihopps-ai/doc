// Screenshot a self-contained HTML through localhost; no app files are modified.
// node tools/capture-offline-html.cjs input.html /tmp/form.png '[ready selector]'
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const [input,output,ready='body']=process.argv.slice(2);
 assert(input&&output,'Usage: node tools/capture-offline-html.cjs input.html /tmp/form.png [ready-selector]');
 const html=fs.readFileSync(path.resolve(input)),target=path.resolve(output);
 assert(!fs.existsSync(target),'Choose a new screenshot path; existing files are not overwritten');
 const server=http.createServer((request,response)=>{
  if(request.url!=='/'){response.writeHead(404);response.end();return}
  response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end(html);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:2});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'load'});
  await page.locator(ready).first().waitFor({state:'visible'});
  await page.evaluate(()=>document.fonts.ready);
  assert.deepEqual(errors,[],'Application raised errors before capture');
  fs.mkdirSync(path.dirname(target),{recursive:true});await page.screenshot({path:target});
  console.log(JSON.stringify({screenshot:target,title:await page.title(),bytes:fs.statSync(target).size}));
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error(error.message);process.exitCode=1});
