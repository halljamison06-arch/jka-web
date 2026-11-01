/* JEDI:RE browser presentation and quality policy. SPDX-License-Identifier: GPL-2.0-or-later */
(function (root) {
  'use strict';
  const presets = Object.freeze({
    performance: {label: 'Performance', pixels: 921600, dpr: 1, picmip: 1, anisotropy: 2, subdivisions: 8, lod: 1, shadows: 0, target: 30},
    balanced: {label: 'Balanced', pixels: 2073600, dpr: 1.5, picmip: 0, anisotropy: 4, subdivisions: 4, lod: 0, shadows: 1, target: 60},
    high: {label: 'High', pixels: 3686400, dpr: 2, picmip: 0, anisotropy: 8, subdivisions: 4, lod: 0, shadows: 1, target: 60},
    ultra: {label: 'Ultra', pixels: 8000000, dpr: 2, picmip: 0, anisotropy: 16, subdivisions: 2, lod: 0, shadows: 2, target: 60}
  });
  function dimensions(vw, vh, dpr, quality, ss = 1) {
    const p = presets[quality] || presets.balanced;
    vw = Number.isFinite(vw) && vw > 0 ? vw : 1280;
    vh = Number.isFinite(vh) && vh > 0 ? vh : 720;
    dpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    ss = Number.isFinite(ss) && ss > 0 ? Math.min(ss, 2) : 1;
    const w = vw * Math.min(dpr, p.dpr) * ss;
    const h = vh * Math.min(dpr, p.dpr) * ss;
    const scale = Math.min(1, Math.sqrt(Math.min(p.pixels * ss * ss, 8000000) / (w * h)), 8192 / w, 8192 / h);
    return [Math.max(2, Math.floor(w * scale / 2) * 2), Math.max(2, Math.floor(h * scale / 2) * 2)];
  }
  const api = root.JediRE = {presets, dimensions, quality: 'balanced', samples: [], draws: 0, uploads: 0, frames: 0, snapshot: {}};
  if (!root.document) return; // Pure policy is also exercised by node:test.
  const query = new URLSearchParams(root.location.search);
  try { api.quality = root.localStorage.getItem('jedi-re-quality') || 'balanced'; } catch (_) {}
  if (presets[query.get('quality')]) api.quality = query.get('quality');
  if (!presets[api.quality]) api.quality = 'balanced';
  let titlePixels;
  api.brandPixels = () => {
    api.brandUploads = (api.brandUploads || 0) + 1;
    if (titlePixels) return titlePixels;
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;
    const ctx=canvas.getContext('2d');ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.font='800 138px "Avenir Next", Arial, sans-serif';
    const a=ctx.measureText('JEDI').width,b=ctx.measureText(':RE').width,x=(1024-a-b)/2;ctx.textAlign='left';
    ctx.fillStyle='#e7f3f8';ctx.fillText('JEDI',x,112);ctx.fillStyle='#61dce4';ctx.fillText(':RE',x+a,112);ctx.textAlign='center';
    ctx.font='500 19px Arial, sans-serif';ctx.fillStyle='#95afbc';ctx.fillText('AN UNOFFICIAL JEDI ACADEMY MODIFICATION',512,219);
    ctx.fillStyle='#315766';ctx.fillRect(100,185,824,2);
    titlePixels=ctx.getImageData(0,0,1024,256).data;return titlePixels;
  };
  api.size = () => dimensions(root.innerWidth, root.innerHeight, root.devicePixelRatio, api.quality, root.Module && root.Module.__idt3_ss);
  api.args = () => {
    const p = presets[api.quality];
    return Object.entries({r_picmip:p.picmip, r_textureMode:'GL_LINEAR_MIPMAP_LINEAR', r_ext_texture_filter_anisotropic:p.anisotropy,
      r_subdivisions:p.subdivisions, r_lodbias:p.lod, cg_shadows:p.shadows, r_dynamiclight:1, r_finish:0, com_maxfps:125})
      .flatMap(([k,v]) => ['+set', k, String(v)]);
  };
  // Count engine submissions, rather than unrelated requestAnimationFrame callbacks.
  // Detailed GL instrumentation is opt-in and installed before the context is created.
  let diag = query.has('diag'), previous = 0, started = 0, frameDraws = 0, frameUploads = 0;
  let gpuProbed = false, gpuTimer = null, gpuActive = null, gpuPending = [];
  const originalContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    const gl = originalContext.call(this, type, attrs);
    if (this.id === 'canvas' && gl && /webgl/.test(type) && !api.gl) {
      api.gl = gl;
      if (diag) { gpuTimer = gl.getExtension('EXT_disjoint_timer_query'); gpuProbed = true; }
      for (const name of ['drawElements', 'drawArrays', 'texImage2D', 'texSubImage2D']) {
        const original = gl[name];
        gl[name] = function (...args) {
          if (diag) { if (name.startsWith('draw')) frameDraws++; else frameUploads++; }
          return original.apply(this, args);
        };
      }
    }
    return gl;
  };
  api.beginFrame = () => {
    started = performance.now();
    if (diag && api.gl && !gpuProbed) { gpuTimer = api.gl.getExtension('EXT_disjoint_timer_query'); gpuProbed = true; }
    if (diag && gpuTimer && !gpuActive && gpuPending.length < 4) {
      gpuActive = gpuTimer.createQueryEXT(); gpuTimer.beginQueryEXT(gpuTimer.TIME_ELAPSED_EXT, gpuActive);
    }
    if (api.clearForPost) api.clearForPost();
  };
  api.frame = (heapBytes) => {
    api.heapBytes = heapBytes;
    if (gpuActive) { gpuTimer.endQueryEXT(gpuTimer.TIME_ELAPSED_EXT); gpuPending.push(gpuActive); gpuActive = null; }
    if (gpuTimer && gpuPending.length && api.frames % 5 === 0) {
      const q = gpuPending[0];
      if (gpuTimer.getQueryObjectEXT(q, gpuTimer.QUERY_RESULT_AVAILABLE_EXT)) {
        if (!api.gl.getParameter(gpuTimer.GPU_DISJOINT_EXT)) api.gpuMs = gpuTimer.getQueryObjectEXT(q, gpuTimer.QUERY_RESULT_EXT) / 1e6;
        else api.gpuMs = null;
        gpuTimer.deleteQueryEXT(q); gpuPending.shift();
      }
    }
    const now = performance.now();
    if (document.hidden) { previous = 0; return; }
    const dt = previous ? now - previous : 0;
    previous = now;
    api.frames++;
    if (dt > 0 && dt < 1000) {
      api.samples.push({dt, cpu: now - started, draws:frameDraws, uploads:frameUploads});
      if (api.samples.length > 240) api.samples.shift();
    }
    frameDraws = frameUploads = 0;
  };
  document.addEventListener('visibilitychange', () => { previous = 0; api.samples.length = 0; });
  document.addEventListener('DOMContentLoaded', () => {
    const panel = document.createElement('section');
    panel.id = 'jre-settings'; panel.setAttribute('aria-label', 'JEDI:RE graphics settings');
    panel.innerHTML = '<label>Graphics quality <select id="jre-quality">' + Object.entries(presets).map(([k,p]) => '<option value="'+k+'">'+p.label+'</option>').join('') +
      '</select></label><span id="jre-budget"></span><label><input id="jre-diag" type="checkbox"> Performance diagnostics</label><p id="jre-pending" hidden>Quality changes apply on the next page launch. Save your game before reloading.</p>';
    const host = document.querySelector('#vt-launcher .wrap, body > .wrap');
    if (host) { const cards = host.querySelector('.cards'); host.insertBefore(panel, cards || host.querySelector('footer')); }
    root.addEventListener('keydown', e => { if (e.target.closest && e.target.closest('#jre-settings, #jre-graphics-toggle')) e.stopImmediatePropagation(); }, true);
    const select = panel.querySelector('select'); select.value = api.quality;
    const budget = panel.querySelector('#jre-budget');
    function description() { const p = presets[select.value]; budget.textContent = (p.pixels/1e6).toFixed(1)+' MP budget · '+p.target+' FPS goal'; }
    description();
    select.addEventListener('change', () => {
      try { localStorage.setItem('jedi-re-quality', select.value); } catch (_) {}
      if (!root.__idt3_booting) api.quality = select.value;
      else panel.querySelector('#jre-pending').hidden = false;
      description();
    });
    const exportButton=document.createElement('button');exportButton.type='button';exportButton.textContent='Download performance report';
    exportButton.onclick=()=>{
      const payload={recordedAt:new Date().toISOString(),userAgent:navigator.userAgent,viewport:[innerWidth,innerHeight,devicePixelRatio],
        measurements:api.snapshot,post:api.post,postError:api.postError||null,
        resources:performance.getEntriesByType('resource').filter(r=>/\.(wasm|pk3)(\?|$)/.test(r.name)).map(r=>({path:new URL(r.name).pathname,durationMs:r.duration,transferBytes:r.transferSize,decodedBytes:r.decodedBodySize}))};
      const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='jedi-re-performance.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    panel.appendChild(exportButton);
    const hud = document.createElement('output'); hud.id = 'jre-diagnostics'; hud.hidden = !diag;
    hud.setAttribute('aria-label', 'Engine performance diagnostics'); document.body.appendChild(hud);
    const check = panel.querySelector('input'); check.checked = diag;
    check.addEventListener('change', () => { diag = check.checked; hud.hidden = !diag; api.samples.length = 0; });
    const badge = document.createElement('div'); badge.id = 'jre-game-brand'; badge.textContent = 'JEDI:RE'; document.body.appendChild(badge);
    setInterval(() => {
      if (!api.samples.length) { hud.textContent = 'JEDI:RE · waiting for engine frames'; return; }
      const s = api.samples, sorted = s.map(x=>x.dt).sort((a,b)=>a-b), mean = k => s.reduce((n,x)=>n+x[k],0)/s.length;
      const heap = root.Module && root.Module.HEAPU8;
      const c = document.getElementById('canvas');
      api.snapshot = {fps:1000/mean('dt'), frameMs:mean('dt'), p95:sorted[Math.floor((sorted.length-1)*.95)], submissionMs:mean('cpu'), gpuMs:api.gpuMs ?? null,
        draws:diag?mean('draws'):null, textureUploads:diag?mean('uploads'):null, wasmMiB:api.heapBytes?api.heapBytes/1048576:(heap?heap.byteLength/1048576:null),
        quality:api.quality, width:c&&c.width, height:c&&c.height, frames:api.frames};
      if (diag) hud.textContent = 'JEDI:RE · '+presets[api.quality].label+'\n'+api.snapshot.fps.toFixed(0)+' FPS · '+api.snapshot.frameMs.toFixed(1)+' ms · p95 '+api.snapshot.p95.toFixed(1)+' ms\n'+
        'CPU submission '+api.snapshot.submissionMs.toFixed(1)+' ms · GPU '+(api.snapshot.gpuMs===null?'unavailable':api.snapshot.gpuMs.toFixed(1)+' ms')+'\n'+
        api.snapshot.draws.toFixed(0)+' draws/frame · '+api.snapshot.textureUploads.toFixed(1)+' uploads/frame\n'+
        (api.snapshot.wasmMiB===null?'WASM memory unavailable':api.snapshot.wasmMiB.toFixed(0)+' MiB WASM capacity')+' · '+api.snapshot.width+'×'+api.snapshot.height+'\nF8 diagnostics · F9 engine log';
    }, 500);
    root.addEventListener('keydown', e => { if (e.code === 'F8') { e.preventDefault(); diag = !diag; hud.hidden = !diag; check.checked = diag; api.samples.length = 0; } });
  });
})(typeof window === 'undefined' ? globalThis : window);
