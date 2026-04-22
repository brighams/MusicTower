const VSART_HTML = `<!DOCTYPE html><html><head><style>
*{margin:0;padding:0}body{background:#000;overflow:hidden}canvas{display:block;width:100vw;height:100vh}
</style></head><body><canvas id="c"></canvas><script>
const canvas=document.getElementById('c')
const gl=canvas.getContext('webgl')
const resize=()=>{canvas.width=innerWidth;canvas.height=innerHeight;gl.viewport(0,0,canvas.width,canvas.height)}
window.addEventListener('resize',resize);resize()
gl.clearColor(0,0,0,1);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE)

const VS_HDR=[
'attribute float vertexId;',
'uniform vec2 mouse;',
'uniform vec2 resolution;',
'uniform vec4 background;',
'uniform float time;',
'uniform float vertexCount;',
'uniform sampler2D sound;',
'uniform sampler2D floatSound;',
'uniform sampler2D volume;',
'uniform sampler2D touch;',
'uniform vec2 soundRes;',
'uniform float _dontUseDirectly_pointSize;',
'varying vec4 v_color;',
].join('\\n')+'\\n'

const FS_SRC='precision mediump float;uniform float u_fade;varying vec4 v_color;void main(){gl_FragColor=vec4(v_color.rgb,v_color.a*u_fade);}'

// Shader bodies — header prepended by runtime. Sourced from shaders.js (vs, vs2, vs3, vs4, wave-vs).
const S_SCATTER=\`#define PI radians(180.0)
vec3 hsv2rgb(vec3 c){c=vec3(c.x,clamp(c.yz,0.0,1.0));vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);vec3 p=abs(fract(c.xxx+K.xyz)*6.0-K.www);return c.z*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),c.y);}
void main(){
  float across=floor(sqrt(vertexCount));
  float x=mod(vertexId,across);float y=floor(vertexId/across);
  float u=x/across;float v=y/across;
  vec2 xy=vec2(u*2.0-1.0,v*2.0-1.0);
  gl_Position=vec4(xy,0,1);
  gl_PointSize=max(0.1,resolution.x/across);
  float f=atan(xy.x,xy.y);float h=length(xy);
  float s=texture2D(sound,vec2(abs(f/PI)*0.5,h*0.25)).a;
  float hue=(time*0.01+abs(f)*0.04);
  v_color=vec4(hsv2rgb(vec3(hue,1,pow(s,2.))),1);
}\`

const S_ORBITS=\`#define PI radians(180.)
#define NUM_SEGMENTS 4.0
#define NUM_POINTS (NUM_SEGMENTS*2.0)
#define STEP 5.0
vec3 hsv2rgb(vec3 c){c=vec3(c.x,clamp(c.yz,0.0,1.0));vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);vec3 p=abs(fract(c.xxx+K.xyz)*6.0-K.www);return c.z*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),c.y);}
void main(){
  float point=mod(floor(vertexId/2.0)+mod(vertexId,2.0)*STEP,NUM_SEGMENTS);
  float count=floor(vertexId/NUM_POINTS);
  float snd=texture2D(sound,vec2(fract(count/128.0),fract(count/20000.0))).a;
  float offset=count*0.02;
  float angle=point*PI*2.0/NUM_SEGMENTS+offset;
  float radius=0.2*pow(snd,5.0);
  float c=cos(angle+time)*radius;float s=sin(angle+time)*radius;
  float innerRadius=count*0.001;
  float oC=cos(count*0.0+time*0.4+count*0.1)*innerRadius;
  float oS=sin(count*0.0+time+count*0.1)*innerRadius;
  vec2 aspect=vec2(1,resolution.x/resolution.y);
  gl_Position=vec4((vec2(oC+c,oS+s))*aspect+mouse*0.1,0,1);
  v_color=vec4(hsv2rgb(vec3(time*0.01+count*1.001,1,1)),1);
}\`

const S_HISTORY=\`#define NUM_SEGMENTS 128.0
#define NUM_POINTS (NUM_SEGMENTS*2.0)
vec3 hsv2rgb(vec3 c){c=vec3(c.x,clamp(c.yz,0.0,1.0));vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);vec3 p=abs(fract(c.xxx+K.xyz)*6.0-K.www);return c.z*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),c.y);}
void main(){
  float numLinesDown=floor(vertexCount/NUM_POINTS);
  float point=floor(mod(vertexId,NUM_POINTS)/2.0)+mod(vertexId,2.0);
  float count=floor(vertexId/NUM_POINTS);
  float u=point/NUM_SEGMENTS;float v=count/numLinesDown;float invV=1.0-v;
  float snd=texture2D(sound,vec2(u*0.25,(v*numLinesDown+0.5)/soundRes.y)).a;
  vec2 xy=vec2((u*2.0-1.0)*mix(0.5,1.0,invV),(v*2.0-1.0)+pow(snd,5.0)*1.0)/(v+0.5);
  gl_Position=vec4(xy*0.5,0,1);
  v_color=mix(vec4(hsv2rgb(vec3(u,invV,invV)),1),background,v*v);
}\`

const S_SPIRO=\`#define PI radians(180.)
#define NUM_SEGMENTS 2.0
#define NUM_POINTS (NUM_SEGMENTS*2.0)
void main(){
  float point=mod(floor(vertexId/2.0)+mod(vertexId,2.0),NUM_SEGMENTS);
  float count=floor(vertexId/NUM_POINTS);
  float angle=point*PI*2.0/NUM_SEGMENTS+count*sin(time*0.01)+5.0;
  float radius=pow(count*0.00014,1.0);
  float c=cos(angle+time)*radius;float s=sin(angle+time)*radius;
  float orbitAngle=pow(count*0.025,0.8);
  float innerRadius=pow(count*0.0005,1.2);
  float oC=cos(orbitAngle+count*0.0001)*innerRadius;
  float oS=sin(orbitAngle+count*0.0001)*innerRadius;
  vec2 aspect=vec2(1,resolution.x/resolution.y);
  gl_Position=vec4((vec2(oC+c,oS+s))*aspect+mouse*0.1,0,1);
  float b=1.0-pow(sin(count*0.4)*0.5+0.5,10.0);
  v_color=vec4(b,b*0.8,b*1.0,1);
}\`

const S_WAVE=\`void main(){
  float GRID_YOFF=1./40.;float GRID_DOWN=17.;float GRID_ACROSS=64.0;
  float NUM_PER_DOWN=GRID_DOWN*2.;float NUM_PER_ACROSS=GRID_ACROSS*2.;
  float NUM_PER_GRID=NUM_PER_DOWN+NUM_PER_ACROSS;float NUM_GRIDS=4.;
  float NUM_GRID_TOTAL=NUM_PER_GRID*NUM_GRIDS;
  float NUM_POINTS=(vertexCount-NUM_GRID_TOTAL)/4.;float NUM_SEGMENTS=NUM_POINTS/2.;
  float id=vertexId-NUM_GRID_TOTAL;
  float point=floor(mod(id,NUM_POINTS)/2.0)+mod(id,2.0);
  float grid=floor(id/NUM_POINTS);
  float u=point/(NUM_SEGMENTS-1.);float v=grid/NUM_GRIDS;
  float s0=texture2D(sound,vec2(u*1.,0)).a;
  float s1=texture2D(sound,vec2(u*0.5,0)).a;
  float s2=texture2D(sound,vec2(u*0.25,0)).a;
  float s3=texture2D(sound,vec2(u*0.125,0)).a;
  float sel0=step(0.*0.9,grid)*step(grid,0.*1.1);
  float sel1=step(1.*0.9,grid)*step(grid,1.*1.1);
  float sel2=step(2.*0.9,grid)*step(grid,2.*1.1);
  float sel3=step(3.*0.9,grid)*step(grid,3.*1.1);
  float snd=s0*sel0+s1*sel1+s2*sel2+s3*sel3;
  vec2 xy=vec2(u*2.0-1.0,v*2.0-1.0+snd*0.4+GRID_YOFF);
  gl_Position=vec4(xy,0,1);
  vec3 hsv=vec3(grid*0.25,1,1);
  vec3 K=vec3(1,2./3.,1./3.);vec3 p=abs(fract(hsv.xxx+K)*6.-vec3(3));
  v_color=vec4(hsv.z*mix(vec3(1),clamp(p-vec3(1),0.,1.),hsv.y),1);
}\`

const DEFS=[
  {src:S_SCATTER,num:100000,mode:0},
  {src:S_ORBITS, num:5000,  mode:1},
  {src:S_HISTORY,num:16384, mode:1},
  {src:S_SPIRO,  num:20000, mode:1},
  {src:S_WAVE,   num:7000,  mode:1},
]

const SOUND_W=128,SOUND_H=64
const sound_data=new Uint8Array(SOUND_W*SOUND_H*4)

const mk_tex=(w,h,d)=>{
  const t=gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D,t)
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,d)
  return t
}
const sound_tex=mk_tex(SOUND_W,SOUND_H,sound_data)
const dummy_tex=mk_tex(1,1,new Uint8Array(4))

const MAX_VERTS=100000
const vids=new Float32Array(MAX_VERTS)
for(let i=0;i<MAX_VERTS;i++)vids[i]=i
const count_buf=gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER,count_buf)
gl.bufferData(gl.ARRAY_BUFFER,vids,gl.STATIC_DRAW)

const apply_template=src=>{
  const vs=VS_HDR+src
  const li=vs.lastIndexOf('}')
  return vs.slice(0,li)+';gl_PointSize=max(0.,gl_PointSize*_dontUseDirectly_pointSize);'+vs.slice(li)
}

const compile=(type,src)=>{
  const s=gl.createShader(type)
  gl.shaderSource(s,src);gl.compileShader(s)
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){gl.deleteShader(s);return null}
  return s
}

const build_prog=def=>{
  const vs=compile(gl.VERTEX_SHADER,apply_template(def.src))
  if(!vs)return null
  const fs=compile(gl.FRAGMENT_SHADER,FS_SRC)
  if(!fs)return null
  const p=gl.createProgram()
  gl.attachShader(p,vs);gl.attachShader(p,fs)
  gl.linkProgram(p)
  if(!gl.getProgramParameter(p,gl.LINK_STATUS)){gl.deleteProgram(p);return null}
  const U=n=>gl.getUniformLocation(p,n)
  return{p,vid:gl.getAttribLocation(p,'vertexId'),num:def.num,mode:def.mode,
    Ut:U('time'),Uvc:U('vertexCount'),Ur:U('resolution'),Ubg:U('background'),
    Um:U('mouse'),Us:U('sound'),Ufs:U('floatSound'),Uvol:U('volume'),Utch:U('touch'),
    Usr:U('soundRes'),Ups:U('_dontUseDirectly_pointSize'),Ufa:U('u_fade')}
}

const progs=DEFS.map(build_prog).filter(Boolean)
const MODE_MAP={POINTS:0,LINES:1,LINE_LOOP:2,LINE_STRIP:3,TRIANGLES:4,TRI_STRIP:5,TRI_FAN:6}
const pending=[]
let compile_done=0,compile_total=0

const draw=(po,fade)=>{
  gl.useProgram(po.p)
  gl.bindBuffer(gl.ARRAY_BUFFER,count_buf)
  gl.enableVertexAttribArray(po.vid)
  gl.vertexAttribPointer(po.vid,1,gl.FLOAT,false,0,0)
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,sound_tex);gl.uniform1i(po.Us,0)
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,sound_tex);gl.uniform1i(po.Ufs,1)
  gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,dummy_tex);gl.uniform1i(po.Uvol,2)
  gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,dummy_tex);gl.uniform1i(po.Utch,3)
  gl.uniform1f(po.Ut,viz_time);gl.uniform1f(po.Uvc,po.num)
  gl.uniform2f(po.Ur,canvas.width,canvas.height)
  gl.uniform4f(po.Ubg,0,0,0,1)
  gl.uniform2f(po.Um,mouse[0],mouse[1])
  gl.uniform2f(po.Usr,SOUND_W,SOUND_H)
  gl.uniform1f(po.Ups,1);gl.uniform1f(po.Ufa,fade)
  gl.drawArrays(po.mode,0,po.num)
}

let viz_time=0,mouse=[0,0]
canvas.addEventListener('mousemove',e=>{
  mouse[0]=e.clientX/canvas.clientWidth*2-1
  mouse[1]=e.clientY/canvas.clientHeight*-2+1
})

window.addEventListener('message',e=>{
  const d=e.data;if(!d?.viz)return
  if(d.time!==undefined)viz_time=d.time
  if(d.freq){
    sound_data.copyWithin(SOUND_W*4,0,(SOUND_H-1)*SOUND_W*4)
    for(let i=0;i<SOUND_W;i++)sound_data[i*4+3]=d.freq[i]??0
    gl.bindTexture(gl.TEXTURE_2D,sound_tex)
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,SOUND_W,SOUND_H,0,gl.RGBA,gl.UNSIGNED_BYTE,sound_data)
  }
  if(d.reset){next=rnd(progs.length,cur);fade_start=ns();ts=ns();dur=rnd_dur();fade_dur=1}
  if(d.shaders){compile_total+=d.shaders.length;for(const s of d.shaders)pending.push({src:s.src,num:Math.min(s.num||1000,MAX_VERTS),mode:MODE_MAP[s.mode]??0})}
})

const rnd=(n,x)=>{let r;do{r=Math.floor(Math.random()*n)}while(n>1&&r===x);return r}
const ns=()=>performance.now()/1000
const DURS=[12,18,24],FADE=4
const rnd_dur=()=>DURS[Math.floor(Math.random()*DURS.length)]
let cur=2,next=-1,ts=ns(),fade_start=0,dur=rnd_dur(),fade_dur=FADE

const drop_prog=(i)=>{
  progs.splice(i,1)
  if(!progs.length)return
  if(cur>=progs.length)cur=0
  if(next===i)next=-1
  else if(next>i)next--
}

const safe_draw=(i,fade)=>{
  draw(progs[i],fade)
  const err=gl.getError()
  if(err){drop_prog(i);next=progs.length>1?rnd(progs.length,cur):-1;fade_start=ns();fade_dur=1;return false}
  return true
}

const render=()=>{
  requestAnimationFrame(render)
  for(let _i=0;_i<3&&pending.length>0;_i++){const _d=pending.shift();compile_done++;const _pg=build_prog(_d);if(_pg)progs.push(_pg)}
  if(pending.length===0&&compile_total>0&&compile_done===compile_total)window.parent.postMessage({viz_progress:{compiled:compile_done,total:compile_total}},'*')
  else if(compile_done%100===0&&compile_done>0)window.parent.postMessage({viz_progress:{compiled:compile_done,total:compile_total}},'*')
  if(!progs.length)return
  gl.clear(gl.COLOR_BUFFER_BIT)
  const t=ns()
  if(next===-1&&t-ts>=dur){next=rnd(progs.length,cur);fade_start=t}
  if(next!==-1){
    const ft=Math.min(1,(t-fade_start)/fade_dur)
    if(!safe_draw(cur,1-ft))return
    if(next===-1)return
    if(!safe_draw(next,ft))return
    if(ft>=1){cur=next;next=-1;ts=t;dur=rnd_dur();fade_dur=FADE}
  }else{
    safe_draw(cur,1)
  }
}
render()
window.parent.postMessage({viz_ready:true},'*')
<\/script></body></html>`

const BLOB_URL = URL.createObjectURL(new Blob([VSART_HTML], { type: 'text/html' }))
const VIS_CONTAINER = document.getElementById('vis-container')
let VIZ_FRAMES = []

const AUDIO = document.getElementById('audio-player')
const FREQ_BINS = 128
const freq_data = new Uint8Array(FREQ_BINS)
let audio_ctx   = null
let analyser    = null
let viz_raf     = null
let viz_start   = null
let beat        = 0
let prev_bass   = 0
let last_beat_t = 0
let _hidden     = false

const ensure_audio_ctx = () => {
  if (audio_ctx) return
  audio_ctx = new AudioContext()
  const source = audio_ctx.createMediaElementSource(AUDIO)
  analyser = audio_ctx.createAnalyser()
  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0.82
  source.connect(analyser)
  analyser.connect(audio_ctx.destination)
}

const freq_avg = (lo, hi) => {
  let s = 0
  for (let i = lo; i < hi; i++) s += freq_data[i]
  return s / ((hi - lo) * 255)
}

const _broadcast = (msg) => {
  for (const f of VIZ_FRAMES) f.contentWindow?.postMessage(msg, '*')
}

const start_vsvis = () => {
  ensure_audio_ctx()
  if (audio_ctx.state === 'suspended') audio_ctx.resume()
  if (!viz_start) viz_start = performance.now()
  if (!_hidden) VIS_CONTAINER.style.opacity = '1'
  if (viz_raf) return
  const tick = () => {
    viz_raf = requestAnimationFrame(tick)
    analyser.getByteFrequencyData(freq_data)
    const t = (performance.now() - viz_start) / 1000
    const raw_bass = freq_avg(0, 8)
    if (raw_bass > prev_bass * 1.35 && raw_bass > 0.15 && t - last_beat_t > 0.1) {
      beat = 1.0
      last_beat_t = t
    }
    beat     *= 0.88
    prev_bass = prev_bass * 0.8 + raw_bass * 0.2
    _broadcast({ viz: true, freq: Array.from(freq_data), time: t })
  }
  viz_raf = requestAnimationFrame(tick)
}

const stop_vsvis = () => {
  if (viz_raf) { cancelAnimationFrame(viz_raf); viz_raf = null }
  beat = 0; prev_bass = 0
  VIS_CONTAINER.style.opacity = '0'
}

const on_track_change_vsvis = () => _broadcast({ viz: true, reset: true })
const force_viz_change      = () => _broadcast({ viz: true, reset: true })

const toggle_vsvis = () => {
  _hidden = !_hidden
  VIS_CONTAINER.style.opacity = _hidden ? '0' : (viz_raf ? '1' : '0')
}

window.start_vsvis           = start_vsvis
window.stop_vsvis            = stop_vsvis
window.on_track_change_vsvis = on_track_change_vsvis
window.force_viz_change      = force_viz_change
window.toggle_vsvis          = toggle_vsvis
window.get_audio_ctx         = () => { ensure_audio_ctx(); return { ctx: audio_ctx, analyser } }

let _sc = null
const _BATCH = 100
const _ready_frames = new Set()

const _send_to_frame = (frame) => {
  if (!_sc) return
  let si = 0
  const send = () => {
    if (!VIZ_FRAMES.includes(frame)) return
    frame.contentWindow?.postMessage({ viz: true, shaders: _sc.slice(si, si + _BATCH) }, '*')
    si += _BATCH
    if (si < _sc.length) requestAnimationFrame(send)
  }
  send()
}

const set_vis_count = (n) => {
  n = Math.max(1, Math.min(6, n))
  localStorage.setItem('vis_count', n)
  while (VIZ_FRAMES.length < n) {
    const f = document.createElement('iframe')
    f.className = 'vis-layer'
    f.src = BLOB_URL
    VIS_CONTAINER.appendChild(f)
    VIZ_FRAMES.push(f)
  }
  while (VIZ_FRAMES.length > n) {
    const f = VIZ_FRAMES.pop()
    _ready_frames.delete(f)
    VIS_CONTAINER.removeChild(f)
  }
}
window.set_vis_count = set_vis_count

const _load_shaders = async () => {
  try {
    const r = await fetch('/api/shaders')
    if (!r.ok) { setTimeout(_load_shaders, 2000); return }
    _sc = await r.json()
    for (const f of _ready_frames) _send_to_frame(f)
  } catch(e) { setTimeout(_load_shaders, 2000) }
}

window.addEventListener('message', e => {
  const frame = VIZ_FRAMES.find(f => f.contentWindow === e.source)
  if (!frame) return
  if (e.data?.viz_ready) {
    _ready_frames.add(frame)
    if (_sc) _send_to_frame(frame)
  }
  if (e.data?.viz_progress && frame === VIZ_FRAMES[0]) {
    const el = document.getElementById('shader-progress')
    if (!el) return
    const { compiled, total } = e.data.viz_progress
    if (total > 0 && compiled >= total) el.style.display = 'none'
    else if (total > 0) { el.style.display = ''; el.textContent = `⚡ ${compiled}/${total}` }
  }
})

set_vis_count(parseInt(localStorage.getItem('vis_count') || '1'))
_load_shaders()
