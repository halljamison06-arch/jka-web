// Real engine measurement and post-process regression probe. No proprietary data is bundled.
// CHROME=/path/to/chromium node shared/wasm-build/profile-jedi-re.mjs URL OUTPUT_DIR
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import WS from 'ws';
import {CHROME,tmpProfile} from './chrome.mjs';
const url=process.argv[2],out=process.argv[3],menuOnly=process.argv.includes('--menu');
if(!url||!out)throw new Error('usage: profile-jedi-re.mjs URL OUTPUT_DIR');
fs.mkdirSync(out,{recursive:true});
const port=9600+process.pid%300,profile=tmpProfile(`jedi-re-${process.pid}`);
const browser=spawn(CHROME,[`--remote-debugging-port=${port}`,'--headless=new','--use-gl=angle','--enable-unsafe-swiftshader','--no-first-run','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--disable-background-timer-throttling','--window-size=1280,720',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ws;
try {
  let page;
  for(let i=0;i<30;i++) {try{page=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(p=>p.type==='page');if(page)break;}catch{}await sleep(500);}
  if(!page)throw new Error('Browser did not expose a test page');
  ws=new WS(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  let id=0;const pending=new Map();const errors=[];
  ws.on('message',data=>{const m=JSON.parse(data);if(m.id&&pending.has(m.id)){const {resolve,reject,timer}=pending.get(m.id);clearTimeout(timer);pending.delete(m.id);m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text+': '+m.params.exceptionDetails.exception?.description);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(new Error('CDP timeout: '+method));},30000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setFocusEmulationEnabled',{enabled:true});await send('Performance.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:2,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__probe={frames:[],draws:0,uploads:0,finishes:0,reads:0,last:0,raf:[]};
    (function tick(t){__probe.raf.push(t);requestAnimationFrame(tick);})(0);
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,attrs){const gl=original.call(this,type,attrs);if(this.id==='canvas'&&gl&&/webgl/.test(type)&&!window.__probe.gl){
      const p=window.__probe;p.gl=gl;
      for(const name of ['drawElements','drawArrays','texImage2D','texSubImage2D','finish','readPixels','flush']){
        const fn=gl[name];gl[name]=function(...args){
          if(name.startsWith('draw'))p.draws++;if(name.startsWith('tex'))p.uploads++;if(name==='finish')p.finishes++;if(name==='readPixels')p.reads++;
          const result=fn.apply(this,args);
          if(name==='flush'){const now=performance.now();if(p.last)p.frames.push({dt:now-p.last,draws:p.draws,uploads:p.uploads});p.last=now;p.draws=p.uploads=0;}
          return result;
        };
      }
    }return gl;};`});
  await send('Page.navigate',{url});
  let active=false;
  for(let i=0;i<150;i++) {await sleep(1000);if(await evaluate(`typeof Module!=='undefined'&&typeof Module._idt3_client_state==='function'&&((Module._idt3_client_state()&255)===${menuOnly?1:7})${menuOnly?'&&(Module._idt3_client_state()>>8)===2':''}`)){active=true;break;}if(errors.length)throw new Error(errors.join('\n'));}
  if(!active)throw new Error('Engine never reached requested state');
  if(menuOnly) {
    await sleep(2000);
    const brand=await evaluate('({title:document.title,uploads:JediRE.brandUploads,frames:JediRE.frames})');
    if(brand.title!=='JEDI:RE'||!brand.uploads||brand.frames<5)throw new Error('Engine menu branding not live');
    const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'menu.png'),Buffer.from(shot.data,'base64'));
    fs.writeFileSync(path.join(out,'menu.json'),JSON.stringify({brand,errors},null,2));
    console.log('PASS: actual engine menu title texture uploaded and rendered',brand);
  } else {
  await sleep(5000);
  const metadata=await evaluate(`(()=>{const gl=__probe.gl,e=gl.getExtension('WEBGL_debug_renderer_info');return {userAgent:navigator.userAgent,renderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),width:gl.drawingBufferWidth,height:gl.drawingBufferHeight,state:Module._idt3_client_state(),hidden:document.hidden,visibility:document.visibilityState,loopMode:typeof MainLoop!=='undefined'?MainLoop.timingMode:null,loopValue:typeof MainLoop!=='undefined'?MainLoop.timingValue:null,canvasFilter:document.getElementById('canvas').style.filter,brand:!!window.JediRE,heapBytes:window.JediRE&&JediRE.heapBytes,gpuMs:window.JediRE&&JediRE.gpuMs};})()`);
  async function measure(label,post=false) {
    await evaluate(`if(window.JediRE&&JediRE.post)JediRE.post.enabled=${post};__probe.frames=[];__probe.last=0;__probe.finishes=__probe.reads=0;`);
    await sleep(1500);await evaluate('__probe.frames=[];__probe.last=0;__probe.raf=[]');
    const before=await send('Performance.getMetrics');await send('Profiler.enable');await send('Profiler.start');
    await sleep(6000);
    const {profile:cpu}=await send('Profiler.stop');const after=await send('Performance.getMetrics');
    const data=await evaluate(`({frames:__probe.frames,raf:__probe.raf,finishes:__probe.finishes,reads:__probe.reads,postFrames:window.JediRE&&JediRE.postFrames,postError:window.JediRE&&JediRE.postError,telemetry:window.JediRE&&JediRE.snapshot})`);
    if(data.frames.length<5||!data.frames.some(x=>x.draws>0))throw new Error('No live engine rendering during measurement');
    const frames=data.frames.filter(f=>f.dt>0),sorted=frames.map(f=>f.dt).sort((a,b)=>a-b),mean=k=>frames.reduce((sum,f)=>sum+f[k],0)/frames.length;
    const hits=new Map();for(const n of cpu.nodes){if(n.hitCount)hits.set(n.callFrame.functionName||n.callFrame.url,(hits.get(n.callFrame.functionName||n.callFrame.url)||0)+n.hitCount);}
    fs.writeFileSync(path.join(out,label+'.cpuprofile'),JSON.stringify(cpu));
    const stats={label,...metadata,telemetry:data.telemetry,rafFps:data.raf.length>2?1000*(data.raf.length-1)/(data.raf.at(-1)-data.raf[0]):null,fps:1000/mean('dt'),meanMs:mean('dt'),p95Ms:sorted[Math.floor((sorted.length-1)*.95)],drawsPerFrame:mean('draws'),uploadsPerFrame:mean('uploads'),finishCalls:data.finishes,readbackCalls:data.reads,postFrames:data.postFrames,postError:data.postError,
      topCpuSamples:[...hits].sort((a,b)=>b[1]-a[1]).slice(0,12),metricsBefore:before.metrics,metricsAfter:after.metrics};
    const pixels=await evaluate(`(()=>{const gl=__probe.gl,p=new Uint8Array(4*16*16);gl.readPixels(Math.floor(gl.drawingBufferWidth/2),Math.floor(gl.drawingBufferHeight/2),16,16,gl.RGBA,gl.UNSIGNED_BYTE,p);let n=0;for(let i=0;i<p.length;i+=4)if(p[i]+p[i+1]+p[i+2]>12)n++;return {litPixels:n,error:gl.getError()};})()`);
    stats.framebuffer=pixels;
    if(pixels.litPixels===0||pixels.error!==0)throw new Error('Framebuffer missing or WebGL error: '+JSON.stringify(pixels));
    const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,label+'.png'),Buffer.from(shot.data,'base64'));
    console.log(JSON.stringify({label,fps:stats.fps,p95:stats.p95Ms,draws:stats.drawsPerFrame,renderer:stats.renderer,resolution:[stats.width,stats.height],postError:stats.postError,framebuffer:pixels}));
    return stats;
  }
  const results=[await measure('standard')];
  if(metadata.brand && !process.argv.includes('--smoke')) {
    results.push(await measure('cinematic',true));
    if(!results[1].postFrames||results[1].postError)throw new Error('Post shader did not render successfully');
    results.push(await measure('restored',false));
    // Same viewport resize must not rebuild/re-upload every texture.
    const control=await evaluate(`(__idt3_dumpLog().match(/vid_restart #/g)||[]).length`);
    await evaluate(`window.dispatchEvent(new Event('resize'))`);await sleep(4000);
    const restarts=await evaluate(`(__idt3_dumpLog().match(/vid_restart #/g)||[]).length`);
    if(restarts!==control)throw new Error('Same viewport caused a renderer restart');
  }
  if(errors.length)throw new Error(errors.join('\n'));
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({url,results,errors},null,2));
  console.log('PASS: active engine, nonblack framebuffer, no WebGL errors'+(metadata.brand&&!process.argv.includes('--smoke')?', cinematic pass, restoration, resize control':''));
  }
} finally {ws?.close();browser.kill();}
