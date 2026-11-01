/* Original JEDI:RE LDR post-processing. GPL-2.0-or-later.
 * WebGL1 shader pass with isolated VAO and complete restoration of touched GL state.
 * No external shader code/assets. This is LDR grading, not an HDR scene renderer. */
(function () {
  'use strict';
  const api = window.JediRE;
  const settings = api.post = {enabled:false, aa:true, bloom:0.12, exposure:0, saturation:1.05};
  let pipeline = null, failed = false, tracked = null, wrapped = false, vaoExt = null;
  const capsFor = gl => [gl.BLEND,gl.DEPTH_TEST,gl.STENCIL_TEST,gl.SCISSOR_TEST,gl.CULL_FACE];
  // Query GL state only once when enabling. Per-frame getParameter calls force
  // driver round trips, so follow subsequent mutations in a small state cache.
  function state(gl) {
    if (tracked) return tracked;
    vaoExt = vaoExt || gl.getExtension('OES_vertex_array_object');
    if (!vaoExt) throw new Error('Post-processing requires vertex array objects.');
    const active=gl.getParameter(gl.ACTIVE_TEXTURE);
    gl.activeTexture(gl.TEXTURE0);const texture=gl.getParameter(gl.TEXTURE_BINDING_2D);gl.activeTexture(active);
    tracked={program:gl.getParameter(gl.CURRENT_PROGRAM),vao:gl.getParameter(vaoExt.VERTEX_ARRAY_BINDING_OES),buffer:gl.getParameter(gl.ARRAY_BUFFER_BINDING),
      active,texture,viewport:gl.getParameter(gl.VIEWPORT),mask:gl.getParameter(gl.COLOR_WRITEMASK),color:gl.getParameter(gl.COLOR_CLEAR_VALUE),
      caps:new Map(capsFor(gl).map(c=>[c,gl.isEnabled(c)]))};
    if(!wrapped) {
      const track=(name,update)=>{const original=gl[name];gl[name]=function(...args){const result=original.apply(this,args);if(tracked)update(...args);return result;};};
      track('useProgram',v=>{tracked.program=v;});track('bindBuffer',(t,v)=>{if(t===gl.ARRAY_BUFFER)tracked.buffer=v;});
      track('activeTexture',v=>{tracked.active=v;});track('bindTexture',(t,v)=>{if(t===gl.TEXTURE_2D&&tracked.active===gl.TEXTURE0)tracked.texture=v;});
      track('viewport',(...v)=>{tracked.viewport=v;});track('colorMask',(...v)=>{tracked.mask=v;});track('clearColor',(...v)=>{tracked.color=v;});
      track('enable',c=>{tracked.caps.set(c,true);});track('disable',c=>{tracked.caps.set(c,false);});
      const bind=vaoExt.bindVertexArrayOES.bind(vaoExt);vaoExt.bindVertexArrayOES=v=>{bind(v);if(tracked)tracked.vao=v;};
      wrapped=true;
      gl.canvas.addEventListener('webglcontextlost',()=>{pipeline=null;tracked=null;failed=true;settings.enabled=false;});
      gl.canvas.addEventListener('webglcontextrestored',()=>{failed=false;vaoExt=null;});
    }
    return tracked;
  }
  const vertex = 'attribute vec2 p; varying vec2 uv; void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
  const fragment = `precision mediump float;
    uniform sampler2D scene; uniform vec2 pixel; uniform vec4 grade;
    varying vec2 uv;
    float luma(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
    vec3 bright(vec2 offset){vec3 c=texture2D(scene,uv+offset*pixel).rgb;return c*max(luma(c)-.72,0.)/.28;}
    void main(){
      vec3 c=texture2D(scene,uv).rgb;
      vec3 n=texture2D(scene,uv+vec2(0.,1.)*pixel).rgb;
      vec3 s=texture2D(scene,uv-vec2(0.,1.)*pixel).rgb;
      vec3 e=texture2D(scene,uv+vec2(1.,0.)*pixel).rgb;
      vec3 w=texture2D(scene,uv-vec2(1.,0.)*pixel).rgb;
      float lo=min(luma(c),min(min(luma(n),luma(s)),min(luma(e),luma(w))));
      float hi=max(luma(c),max(max(luma(n),luma(s)),max(luma(e),luma(w))));
      float edge=smoothstep(.08,.3,hi-lo)*grade.w;
      c=mix(c,(n+s+e+w+c*4.)/8.,edge*.65);
      if(grade.x>0.) {
        vec2 radius=vec2(3.); // pixel-based taps remain consistent across resolutions
        vec3 glow=bright(vec2(3.,0.))+bright(vec2(-3.,0.))+bright(vec2(0.,3.))+bright(vec2(0.,-3.));
        glow+=bright(radius)+bright(-radius)+bright(vec2(3.,-3.))+bright(vec2(-3.,3.));
        c+=glow*(grade.x/8.);
      }
      c*=exp2(grade.y);
      c=mix(vec3(luma(c)),c,grade.z);
      gl_FragColor=vec4(clamp(c,0.,1.),1.);
    }`;
  function create(gl, ext) {
    const shaders = [];
    const program = gl.createProgram();
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]) {
        const shader=gl.createShader(type); shaders.push(shader); gl.shaderSource(shader,source); gl.compileShader(shader);
        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        gl.attachShader(program,shader);
      }
      gl.bindAttribLocation(program,0,'p'); gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      const vao=ext.createVertexArrayOES(), buffer=gl.createBuffer(), texture=gl.createTexture();
      ext.bindVertexArrayOES(vao); gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      return {program,vao,buffer,texture,w:0,h:0,pixel:gl.getUniformLocation(program,'pixel'),grade:gl.getUniformLocation(program,'grade'),scene:gl.getUniformLocation(program,'scene')};
    } catch(e) {gl.deleteProgram(program);throw e;}
    finally {shaders.forEach(s=>gl.deleteShader(s));}
  }
  api.clearForPost = () => {
    const gl=api.gl;
    if(!settings.enabled || !gl || failed || gl.isContextLost()) return;
    // Raven normally preserves color. A post-processed frame must not feed into the
    // next frame's glow/grade in uncovered pixels, so start from clean scene color.
    try {
      const t=state(gl), scissor=t.caps.get(gl.SCISSOR_TEST), color=t.color, mask=t.mask;
      gl.disable(gl.SCISSOR_TEST);gl.colorMask(true,true,true,true);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);
      gl.clearColor(...color);gl.colorMask(...mask);if(scissor)gl.enable(gl.SCISSOR_TEST);
    } catch(e) {failed=true;settings.enabled=false;api.postError=String(e);}

  };
  api.present = () => {
    const gl=api.gl;
    if(!settings.enabled || failed || !gl || gl.isContextLost()) {tracked=null;return;}
    let t;
    try {t=state(gl);}catch(e){failed=true;settings.enabled=false;api.postError=String(e);return;}
    const ext=vaoExt;
    const old={...t},caps=capsFor(gl),enabled=caps.map(c=>t.caps.get(c)),texture=t.texture;
    gl.activeTexture(gl.TEXTURE0);
    try {
      if(!pipeline) pipeline=create(gl,ext);
      const p=pipeline, w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
      gl.bindTexture(gl.TEXTURE_2D,p.texture);
      if(p.w!==w || p.h!==h) {gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,w,h,0,gl.RGB,gl.UNSIGNED_BYTE,null);p.w=w;p.h=h;}
      gl.copyTexSubImage2D(gl.TEXTURE_2D,0,0,0,0,0,w,h);
      caps.forEach(c=>gl.disable(c)); gl.colorMask(true,true,true,true); gl.viewport(0,0,w,h);
      gl.useProgram(p.program);ext.bindVertexArrayOES(p.vao);
      gl.uniform1i(p.scene,0);gl.uniform2f(p.pixel,1/w,1/h);
      gl.uniform4f(p.grade,settings.bloom,settings.exposure,settings.saturation,settings.aa?1:0);
      gl.drawArrays(gl.TRIANGLES,0,3); api.postFrames=(api.postFrames||0)+1;
    } catch(e) {failed=true;settings.enabled=false;api.postError=String(e);console.warn('JEDI:RE post-processing disabled:',e);}
    finally {
      gl.bindTexture(gl.TEXTURE_2D,texture);gl.activeTexture(old.active);gl.useProgram(old.program);
      ext.bindVertexArrayOES(old.vao);gl.bindBuffer(gl.ARRAY_BUFFER,old.buffer);gl.viewport(...old.viewport);gl.colorMask(...old.mask);
      caps.forEach((c,i)=>enabled[i]?gl.enable(c):gl.disable(c));
    }
  };
  document.addEventListener('DOMContentLoaded',()=>{
    const panel=document.getElementById('jre-settings');if(!panel)return;
    const controls=document.createElement('div');controls.id='jre-post-controls';
    controls.innerHTML='<label><input type="checkbox" id="jre-post"> Cinematic post-processing (experimental)</label><label>Bloom <input id="jre-bloom" type="range" min="0" max="0.5" step="0.01" value="0.12"></label><label>Exposure <input id="jre-exposure" type="range" min="-1" max="1" step="0.05" value="0"></label><label>Saturation <input id="jre-saturation" type="range" min="0" max="1.5" step="0.05" value="1.05"></label><label><input id="jre-aa" type="checkbox" checked> Edge smoothing</label><small>LDR color grading and glow. Optional GPU cost; off by default.</small>';
    panel.appendChild(controls);
    controls.querySelector('#jre-post').onchange=e=>{settings.enabled=e.target.checked;};
    controls.querySelector('#jre-bloom').oninput=e=>{settings.bloom=Number(e.target.value);};
    controls.querySelector('#jre-exposure').oninput=e=>{settings.exposure=Number(e.target.value);};
    controls.querySelector('#jre-saturation').oninput=e=>{settings.saturation=Number(e.target.value);};
    controls.querySelector('#jre-aa').onchange=e=>{settings.aa=e.target.checked;};
    const toggle=document.createElement('button');toggle.id='jre-graphics-toggle';toggle.textContent='Graphics';toggle.type='button';
    toggle.onclick=()=>{const open=document.body.classList.toggle('jre-settings-open');toggle.setAttribute('aria-expanded',String(open));};
    toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','jre-settings');document.body.appendChild(toggle);
  });
})();
