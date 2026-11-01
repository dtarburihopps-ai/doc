// Record any existing Playwright Chromium Page with system FFmpeg + CDP.
// No Playwright recordVideo, bundled ffmpeg download, or app-file changes.
const fs=require('fs'),path=require('path'),os=require('os');
const {spawn,spawnSync}=require('child_process');

function launch(ffmpeg,args){
 const child=spawn(ffmpeg,args,{stdio:['pipe','ignore','pipe']});
 let stderr='',startError;
 child.stderr.on('data',data=>stderr=(stderr+data).slice(-12000));
 child.on('error',error=>{startError=error});
 const done=new Promise(resolve=>child.once('close',code=>resolve({code,error:startError,stderr})));
 return{child,done};
}
function assertEncoder(result,label){
 if(result.code!==0||result.error)throw Error(label+': '+(result.error?.message||result.stderr||'exit '+result.code));
}
async function startPageRecording(page,outputPath,options={}){
 const ffmpeg=options.ffmpegPath||process.env.FFMPEG_PATH||'ffmpeg';
 const fps=options.fps||25;
 if(!Number.isInteger(fps)||fps<1||fps>60)throw Error('fps must be an integer from 1 to 60');
 const output=path.resolve(outputPath);
 if(path.extname(output).toLowerCase()!=='.mp4')throw Error('Choose an .mp4 output path');
 if(fs.existsSync(output))throw Error('Output already exists; choose a new path: '+output);
 const version=spawnSync(ffmpeg,['-version'],{stdio:'ignore'});
 if(version.error||version.status!==0)throw Error('System FFmpeg is unavailable: '+(version.error?.message||ffmpeg));
 const work=fs.mkdtempSync(path.join(os.tmpdir(),'system-video-'));
 let cdp,recording,timer,frames=0,updates=0,stopping=false,stopPromise,pipeError,captureError;
 try{
  cdp=await page.context().newCDPSession(page);
  await cdp.send('Page.enable');
  const raw=path.join(work,'capture.mp4');
  recording=launch(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','image2pipe','-vcodec','mjpeg','-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p','-threads','4',raw]);
  recording.child.stdin.on('error',error=>{pipeError=error});
  // A fully idle page may not emit a screencast event until the first action.
  // Seed the recorder ourselves instead of waiting and blocking that action.
  let latest=await page.screenshot({type:'jpeg',quality:85});
  cdp.on('Page.screencastFrame',event=>{
   latest=Buffer.from(event.data,'base64');updates++;
   cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(error=>{if(!stopping)captureError=error});
  });
  const viewport=page.viewportSize()||{width:1920,height:1080};
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:85,maxWidth:viewport.width,maxHeight:viewport.height,everyNthFrame:2});
  // Keep reading pauses: screencast events alone omit unchanged frames.
  timer=setInterval(()=>{if(latest&&!pipeError){recording.child.stdin.write(latest);frames++}},1000/fps);
  return{
   get frames(){return frames},
   get updates(){return updates},
   get seconds(){return frames/fps},
   stop(){
    if(stopPromise)return stopPromise;
    stopPromise=(async()=>{
     stopping=true;clearInterval(timer);
     await cdp.send('Page.stopScreencast').catch(()=>{});await cdp.detach().catch(()=>{});
     recording.child.stdin.end();const captured=await recording.done;
     try{
      assertEncoder(captured,'Capture failed');
      if(pipeError||captureError)throw pipeError||captureError;
      if(!frames)throw Error('No video frames were recorded');
      const finished=path.join(work,'finished.mp4');
      const encoding=launch(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',raw,'-an','-c:v','libx264','-preset','medium','-crf','26','-threads','4','-vf','scale=in_range=pc:out_range=tv','-color_range','tv','-pix_fmt','yuv420p','-movflags','+faststart',finished]);
      encoding.child.stdin.end();assertEncoder(await encoding.done,'MP4 encoding failed');
      fs.mkdirSync(path.dirname(output),{recursive:true});fs.copyFileSync(finished,output,fs.constants.COPYFILE_EXCL);
      return{output,frames,updates,duration:frames/fps,bytes:fs.statSync(output).size};
     }finally{fs.rmSync(work,{recursive:true,force:true})}
    })();return stopPromise;
   }
  };
 }catch(error){
  stopping=true;clearInterval(timer);
  if(cdp){await cdp.send('Page.stopScreencast').catch(()=>{});await cdp.detach().catch(()=>{})}
  if(recording){recording.child.stdin.end();await recording.done}
  fs.rmSync(work,{recursive:true,force:true});throw error;
 }
}
module.exports={startPageRecording};
