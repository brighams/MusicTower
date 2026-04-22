const VIZ_HTML = `<!DOCTYPE html><html><head><style>
*{margin:0;padding:0}body{background:#000;overflow:hidden}canvas{display:block;width:100vw;height:100vh}
</style></head><body><canvas id="c"></canvas><script>
const canvas=document.getElementById('c')
const gl=canvas.getContext('webgl')
const resize=()=>{canvas.width=innerWidth;canvas.height=innerHeight;gl.viewport(0,0,canvas.width,canvas.height)}
window.addEventListener('resize',resize);resize()
gl.clearColor(0,0,0,1);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE)

const VERT='attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0,1);}'
const PAL='vec3 pal(float t,sampler2D s){t=fract(t);return texture2D(s,vec2(t,t)).rgb;}'
const HASH='float hash(vec2 p){p=fract(p*vec2(443.897,441.423));p+=dot(p,p.yx+19.19);return fract(p.x*p.y);}'

const FRAGS_A=[\`precision mediump float;
uniform float u_time,u_bass,u_mid,u_treble,u_beat,u_alpha;uniform vec2 u_res;
uniform sampler2D u_palette,u_wave,u_freq;
\${PAL}
void main(){
  vec2 uv=(gl_FragCoord.xy/u_res-.5)*vec2(u_res.x/u_res.y,1.);
  float t=u_time*.35,e=.08+u_bass*.92+u_beat*.3;
  uv*=1.+u_bass*.8+u_beat*.4;
  float v=sin(uv.x*3.+t+u_bass*5.)+sin(uv.y*2.5-t*.9+u_mid*3.)
         +sin((uv.x+uv.y)*4.5+t*1.2)+sin(length(uv)*7.-t*2.5+u_bass*8.);
  v=v*.125+.5;
  float v2=(sin(uv.x*5.-t*1.5+u_treble*4.)+sin(uv.y*6.+t*.8))*.25+.5;
  gl_FragColor=vec4((pal(v,u_palette)*.7+pal(v2,u_palette)*.3)*e,u_alpha);
}\`,
\`precision mediump float;
uniform float u_time,u_bass,u_mid,u_treble,u_beat,u_alpha;uniform vec2 u_res;
uniform sampler2D u_palette,u_wave,u_freq;
\${PAL}
void main(){
  vec2 uv=(gl_FragCoord.xy/u_res-.5);uv.x*=u_res.x/u_res.y;
  float a=atan(uv.y,uv.x),d=length(uv),t=u_time*.5;
  float v=fract(.25/(d+.001)+t+u_bass*.8+a/6.28318+u_mid*.4+t*.1);
  float ring=1.-smoothstep(0.,.03,abs(fract(d*3.-t*2.+u_bass*2.)-.5));
  vec3 col=pal(v,u_palette)+ring*pal(fract(v+.5),u_palette)*u_beat;
  col*=(.1+u_bass*.9)*(1.-smoothstep(.7,1.3,d));
  gl_FragColor=vec4(col,u_alpha);
}\`,
\`precision mediump float;
uniform float u_time,u_bass,u_mid,u_treble,u_beat,u_alpha;uniform vec2 u_res;
uniform sampler2D u_palette,u_wave,u_freq;
\${PAL}
void main(){
  vec2 uv=(gl_FragCoord.xy/u_res-.5);uv.x*=u_res.x/u_res.y;
  float t=u_time*.15,N=floor(4.+u_mid*5.)*2.;
  float a=atan(uv.y,uv.x),d=length(uv),seg=6.28318/N;
  a=mod(a,seg);if(a>seg*.5)a=seg-a;
  vec2 p=vec2(cos(a),sin(a))*d*(1.5+u_bass)+vec2(t*.4,t*.25);
  float v=(sin(p.x*4.+t)*sin(p.y*3.-t*.8)+sin(length(p)*6.-t*2.+u_bass*5.))*.25+.5;
  float v2=cos(p.x*2.5-p.y*3.5+t*1.3)*.5+.5;
  gl_FragColor=vec4((pal(v,u_palette)*.6+pal(v2,u_palette)*.4)*(.12+u_bass*.88+u_beat*.3),u_alpha);
}\`,
\`precision mediump float;
uniform float u_time,u_bass,u_mid,u_treble,u_beat,u_alpha;uniform vec2 u_res;
uniform sampler2D u_palette,u_wave,u_freq;
\${PAL}
void main(){
  vec2 uv=(gl_FragCoord.xy/u_res-.5)*vec2(u_res.x/u_res.y,1.);
  float t=u_time*.25,a=atan(uv.y,uv.x),d=length(uv);
  float an=(a+3.14159)/6.28318;
  float wave=texture2D(u_wave,vec2(an,.5)).r*2.-1.;
  float freq=texture2D(u_freq,vec2(an,.5)).r;
  float r=.30+u_bass*.08+wave*.10*(1.+u_bass*1.5)+u_beat*.04;
  float line=1.-smoothstep(0.,.012,abs(d-r));
  float bg=(1.-smoothstep(0.,.003,abs(d-.135)))*.4+(1.-smoothstep(0.,.003,abs(d-.27)))*.2
          +(1.-smoothstep(0.,.003,abs(d-.405)))*.13+(1.-smoothstep(0.,.003,abs(d-.54)))*.1;
  gl_FragColor=vec4((line*pal(an+t,u_palette)+bg*.25*pal(freq,u_palette))*(.1+u_bass*.9+u_beat*.4),u_alpha);
}\`,
\`precision mediump float;
uniform float u_time,u_bass,u_mid,u_treble,u_beat,u_alpha;uniform vec2 u_res;
uniform sampler2D u_palette,u_wave,u_freq;
\${PAL}
float h(vec2 p){p=fract(p*vec2(443.9,397.3));p+=dot(p,p+19.19);return fract(p.x*p.y);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<6;i++){v+=a*n(p);p=p*2.1+vec2(1.7,9.2);a*=.5;}return v;}
void main(){
  vec2 uv=(gl_FragCoord.xy/u_res-.5)*vec2(u_res.x/u_res.y,1.);
  float t=u_time*.08,e=.08+u_bass*.92+u_beat*.5;
  vec2 p=uv*(1.5+u_mid)+t;
  float d=.5+.5*sin(fbm(p+fbm(p+fbm(p)))*6.28318+u_bass*3.+t*2.);
  float d2=.5+.5*cos(fbm(p*1.5+u_treble*.5+3.7)*6.28318-t);
  gl_FragColor=vec4((pal(d,u_palette)*.7+pal(d2,u_palette)*.3)*e,u_alpha);
}\`]

const FRAGS_B=[\`precision mediump float;
uniform float u_time,u_bass,u_mid,u_treble,u_beat,u_alpha;uniform vec2 u_res;
uniform sampler2D u_palette,u_wave,u_freq;
\${PAL}
\${HASH}
void main(){
  vec2 uv=gl_FragCoord.xy/u_res;
  float ar=u_res.x/u_res.y,t=u_time;
  vec3 col=vec3(0.);
  for(int i=0;i<7;i++){
    float fi=float(i),depth=(fi+1.)/7.,ybase=.08+fi*.125;
    float f1=(2.+fi*.9)*6.28318,f2=(.8+fi*.4)*6.28318,spd=.35+fi*.12;
    float amp=(.03+u_bass*.11)*depth;
    float wy=ybase+sin(uv.x*f1+t*spd+u_mid*2.)*amp+sin(uv.x*f2-t*spd*.7)*amp*.4;
    float dd=abs(uv.y-wy),w=.0018+depth*.0025+u_bass*.002;
    col+=pal(ybase*.5+t*.04+fi*.07,u_palette)*exp(-dd/w)*depth*(.5+u_bass*.5+u_beat*.4);
    float sdens=6.+fi*1.5,sx=floor(uv.x*sdens);
    float spt=fract(t*(.7+fi*.1)+hash(vec2(sx,fi)));
    float slife=smoothstep(0.,.2,spt)*smoothstep(1.,.4,spt);
    float sact=step(.3+u_bass*.25,hash(vec2(sx,fi+17.)));
    float scx=(sx+.5)/sdens;
    float scy=ybase+sin(scx*f1+t*spd+u_mid*2.)*amp+sin(scx*f2-t*spd*.7)*amp*.4;
    float spx=scx+(hash(vec2(sx+200.,fi))-.5)*.09*spt;
    float spy=scy+(hash(vec2(sx+100.,fi))-.5)*.28*spt;
    float ddx=(uv.x-spx)*ar,ddy=uv.y-spy;
    float sg=exp(-sqrt(ddx*ddx+ddy*ddy)/(.005*(1.+u_beat*.7)))*slife*sact*(1.+u_bass*.6);
    col+=pal(ybase+.35+fi*.05,u_palette)*sg*2.5;
  }
  gl_FragColor=vec4(col,u_alpha);
}\`,\`precision mediump float;
uniform float u_time,u_bass,u_mid,u_treble,u_beat,u_alpha;uniform vec2 u_res;
uniform sampler2D u_palette,u_wave,u_freq;
\${PAL}
void main(){
  float ar=u_res.x/u_res.y;
  vec2 uv=vec2(gl_FragCoord.x/u_res.x*ar,gl_FragCoord.y/u_res.y);
  float t=u_time;
  vec3 col=vec3(0.);
  for(int fi=0;fi<4;fi++){
    float f=float(fi),ph=f*1.618+1.234,ph2=f*2.397+0.813,spd=0.55+f*0.21;
    vec3 fly_col=pal(f*.25+t*.02,u_palette)*3.;
    for(int s=0;s<24;s++){
      float age=float(s)/24.,ts=t-age*3.5*(.5+u_bass*.5);
      float px=(.5+.38*cos(ts*spd+ph)+.1*cos(ts*spd*2.7+ph2))*ar;
      float py=.5+.32*sin(ts*(spd*.73)+ph*.8)+.1*sin(ts*(spd*1.9)+ph2*.6)+u_bass*.05*sin(ts*2.8+f);
      vec2 dv=uv-vec2(px,py);
      float r=.014*(1.+u_beat*.5)*(1.-age*.72)*(1.+u_bass*.35);
      float b=exp(-dot(dv,dv)/(r*r))*(1.-age)*(1.-age);
      col+=fly_col*b*(1.+u_beat*(1.-age)*1.5);
    }
  }
  gl_FragColor=vec4(col,u_alpha);
}\`,\`precision mediump float;
uniform float u_time,u_bass,u_mid,u_treble,u_beat,u_alpha;uniform vec2 u_res;
uniform sampler2D u_palette,u_wave,u_freq;
\${HASH}
float N(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*N(p);p=p*2.1+vec2(1.7,9.2);a*=.5;}return v;}
vec3 spal(float t){
  t=fract(t);
  vec3 c=vec3(.07,.00,.00);
  c=mix(c,vec3(.62,.02,.00),smoothstep(0.,.28,t));
  c=mix(c,vec3(.95,.17,.00),smoothstep(.28,.55,t));
  c=mix(c,vec3(1.,.52,.02),smoothstep(.55,.80,t));
  c=mix(c,vec3(1.,.90,.20),smoothstep(.80,1.,t));
  return c;
}
void main(){
  vec2 uv=(gl_FragCoord.xy/u_res-.5)*vec2(u_res.x/u_res.y,1.);
  float t=u_time*.18;
  float blink=pow(max(0.,sin(u_time*.43+.5)*sin(u_time*.71+1.8)*sin(u_time*1.13)),4.);
  float open=1.-blink;
  float ev=.34,ew_h=(.095+u_bass*.02+u_beat*.012)*open+.003;
  float yn=uv.y/ev;
  float half_w=ew_h*sqrt(max(0.,1.-yn*yn));
  float eye=smoothstep(half_w+.005,half_w-.005,abs(uv.x))*smoothstep(1.05,.95,abs(yn));
  vec2 ec=vec2(uv.x/max(ew_h,.003),uv.y/ev);
  float ir=length(ec);
  vec2 gaze=vec2(sin(u_time*.07)*.06,cos(u_time*.11+1.)*.10);
  vec2 fuv=(ec-gaze)*1.2+vec2(t*.2,t*.55);
  float fv=fbm(fuv+u_bass*.65)*.6+fbm(fuv*1.4-vec2(t*.1,t*.3)+u_mid*.35)*.4;
  float iglow=(1.-smoothstep(0.,.88,ir))*(.25+u_bass*.75+u_beat*.5)+exp(-abs(ir-.68)*14.)*.4;
  vec3 iris=spal(fv*.8+.1)*iglow;
  float ph=max(.015,(0.02+u_bass*.07)*ev);
  float pd=length(vec2(uv.x/max(ew_h*.90,.003),uv.y/ph));
  float pupil=smoothstep(1.1,.80,pd)*eye;
  vec3 pc=spal(.03)*(.3+u_bass*.4);
  vec3 ecol=mix(iris,pc,pupil);
  float cor=exp(-max(0.,ir-.90)*4.)*(.15+u_bass*.85+u_beat*.70);
  vec3 ccol=spal(fv*.5+.05)*cor;
  float atm=fbm(uv*2.+vec2(t*.04,-t*.06));
  vec3 bg=spal(atm*.3+.08)*atm*(.03+u_bass*.05);
  float fw=.095*sqrt(max(0.,1.-yn*yn));
  float ylid=smoothstep(1.04,.93,abs(yn));
  float lid=(smoothstep(fw+.01,fw-.01,abs(uv.x))-eye)*ylid*blink;
  vec3 lc=spal(.12+fbm(uv*5.+t*.12)*.08)*.18;
  vec3 col=bg+ccol+ecol*eye+lc*lid;
  col+=spal(.92)*u_beat*.5*smoothstep(1.4,.6,ir);
  gl_FragColor=vec4(col,u_alpha);
}\`]

const compile=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))console.error(gl.getShaderInfoLog(s));return s}
const quad=(()=>{const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);return b})()
const build_prog=src=>{
  const p=gl.createProgram()
  gl.attachShader(p,compile(gl.VERTEX_SHADER,VERT));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,src))
  gl.linkProgram(p);gl.useProgram(p)
  gl.bindBuffer(gl.ARRAY_BUFFER,quad)
  const loc=gl.getAttribLocation(p,'a_pos')
  gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0)
  const U=n=>gl.getUniformLocation(p,n)
  return{p,Ut:U('u_time'),Ub:U('u_bass'),Um:U('u_mid'),Utr:U('u_treble'),Ube:U('u_beat'),
         Ur:U('u_res'),Up:U('u_palette'),Uw:U('u_wave'),Uf:U('u_freq'),Ua:U('u_alpha')}
}
const mk_tex=(w,h,d)=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,d);return t}
const dflt_pal=()=>{const d=new Uint8Array(256);
  for(let i=0;i<64;i++){const t=i/63;d[i*4]=(t*180+10)|0;d[i*4+1]=(t*20)|0;d[i*4+2]=(t*230+25)|0;d[i*4+3]=255}
  return d}
const pal_tex =mk_tex(8,8,dflt_pal())
const wave_tex=mk_tex(256,1,new Uint8Array(1024).fill(128))
const freq_tex=mk_tex(128,1,new Uint8Array(512).fill(0))
const up_gray=(tex,w,h,src)=>{
  const d=new Uint8Array(w*h*4)
  for(let i=0;i<w*h;i++){const v=src[i]??128;d[i*4]=d[i*4+1]=d[i*4+2]=v;d[i*4+3]=255}
  gl.bindTexture(gl.TEXTURE_2D,tex)
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,d)
}

const PROGS_A=FRAGS_A.map(build_prog)
const PROGS_B=FRAGS_B.map(build_prog)
let bass=0,mid=0,treble=0,beat=0,viz_time=0
const FADE=1.5
const DURS=[[6,8,12],[2,4,8],[16]]
const ALPHAS=[.55,.45,.38]
const ns=()=>performance.now()/1000
const rnd=(n,x=-1)=>{if(n<=1)return 0;let r;do{r=Math.floor(Math.random()*n)}while(r===x);return r}
const pdur=(d)=>d[Math.floor(Math.random()*d.length)]
const layers=[
  {progs:PROGS_A,cur:rnd(PROGS_A.length),next:-1,fs:0,ts:ns(),dur:pdur([6,8,12])},
  {progs:PROGS_A,cur:rnd(PROGS_A.length),next:-1,fs:0,ts:ns(),dur:pdur([2,4,8])},
  {progs:PROGS_B,cur:rnd(PROGS_B.length),next:-1,fs:0,ts:ns(),dur:pdur([6,8,12])},
]

const draw=(po,alpha)=>{
  const{p,Ut,Ub,Um,Utr,Ube,Ur,Up,Uw,Uf,Ua}=po
  gl.useProgram(p)
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,pal_tex);gl.uniform1i(Up,0)
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,wave_tex);gl.uniform1i(Uw,1)
  gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,freq_tex);gl.uniform1i(Uf,2)
  gl.uniform1f(Ut,viz_time);gl.uniform1f(Ub,bass);gl.uniform1f(Um,mid)
  gl.uniform1f(Utr,treble);gl.uniform1f(Ube,beat)
  gl.uniform2f(Ur,canvas.width,canvas.height)
  gl.uniform1f(Ua,alpha)
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4)
}

window.addEventListener('message',e=>{
  const d=e.data;if(!d?.viz)return
  if(d.bass!==undefined)bass=d.bass
  if(d.mid!==undefined)mid=d.mid
  if(d.treble!==undefined)treble=d.treble
  if(d.beat!==undefined)beat=d.beat
  if(d.time!==undefined)viz_time=d.time
  if(d.wave)up_gray(wave_tex,256,1,d.wave)
  if(d.freq)up_gray(freq_tex,128,1,d.freq)
  if(d.palette){
    const w=d.pal_w||8,h=d.pal_h||8
    gl.bindTexture(gl.TEXTURE_2D,pal_tex)
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(d.palette))
  }
  if(d.reset){
    const t=ns()
    for(const l of layers){l.next=rnd(l.progs.length,l.cur);l.fs=t}
  }
})

const render=()=>{
  requestAnimationFrame(render)
  gl.clear(gl.COLOR_BUFFER_BIT)
  const t=ns()
  for(let i=0;i<3;i++){
    const l=layers[i],ba=ALPHAS[i]
    if(l.next===-1&&t-l.ts>=l.dur){l.next=rnd(l.progs.length,l.cur);l.fs=t}
    if(l.next!==-1){
      const ft=Math.min(1,(t-l.fs)/FADE)
      draw(l.progs[l.cur],ba*(1-ft))
      draw(l.progs[l.next],ba*ft)
      if(ft>=1){l.cur=l.next;l.next=-1;l.ts=t;l.dur=pdur(DURS[i])}
    }else{
      draw(l.progs[l.cur],ba)
    }
  }
}
render()
<\/script></body></html>`

const VIZ_IFRAME = document.getElementById('visualizer')
VIZ_IFRAME.src = URL.createObjectURL(new Blob([VIZ_HTML], { type: 'text/html' }))

const AUDIO = document.getElementById('audio-player')
const BODY_BG_VIZ     = 'rgba(14, 8, 32, 0.65)'
const BODY_BG_DEFAULT = 'linear-gradient(160deg, #0e0820 0%, #160d30 50%, #0c0618 100%)'
const FREQ_BINS = 128
const WAVE_BINS = 256
const freq_data = new Uint8Array(FREQ_BINS)
const wave_data = new Uint8Array(WAVE_BINS)
let audio_ctx = null
let analyser   = null
let viz_raf    = null
let viz_start  = null
let beat          = 0
let prev_bass     = 0
let last_beat_t   = 0

const ensure_audio_ctx = () => {
  if (audio_ctx) return
  audio_ctx = new AudioContext()
  const source = audio_ctx.createMediaElementSource(AUDIO)
  analyser = audio_ctx.createAnalyser()
  analyser.fftSize = WAVE_BINS
  analyser.smoothingTimeConstant = 0.82
  source.connect(analyser)
  analyser.connect(audio_ctx.destination)
}

const freq_avg = (lo, hi) => {
  let s = 0
  for (let i = lo; i < hi; i++) s += freq_data[i]
  return s / ((hi - lo) * 255)
}

let _colors_pool = null

const load_colors = async () => {
  if (_colors_pool) return _colors_pool
  const { colors } = await import('/colors.js')
  _colors_pool = colors.flatMap(hex_str => {
    const c = hex_str.replace('#', '')
    let r, g, b, a
    if (c.length === 8) {
      a = parseInt(c.slice(0, 2), 16)
      r = parseInt(c.slice(2, 4), 16)
      g = parseInt(c.slice(4, 6), 16)
      b = parseInt(c.slice(6, 8), 16)
    } else if (c.length === 6) {
      r = parseInt(c.slice(0, 2), 16)
      g = parseInt(c.slice(2, 4), 16)
      b = parseInt(c.slice(4, 6), 16)
      a = 255
    } else {
      return []
    }
    if (isNaN(r) || isNaN(g) || isNaN(b)) return []
    if (a < 0xaa) return []
    if (Math.max(r, g, b) < 55) return []
    if (Math.max(r, g, b) - Math.min(r, g, b) < 30) return []
    return [[r, g, b]]
  })
  return _colors_pool
}

const gen_palette = (pool) => {
  const PAL_W = 64
  const n = 5 + Math.floor(Math.random() * 6)
  const anchors = Array.from({ length: n }, () => pool[Math.floor(Math.random() * pool.length)])
  const d = new Uint8Array(PAL_W * 4)
  for (let i = 0; i < PAL_W; i++) {
    const t  = (i / PAL_W) * n
    const ia = Math.floor(t) % n
    const ib = (ia + 1) % n
    const f  = t - Math.floor(t)
    d[i*4]   = anchors[ia][0] * (1 - f) + anchors[ib][0] * f | 0
    d[i*4+1] = anchors[ia][1] * (1 - f) + anchors[ib][1] * f | 0
    d[i*4+2] = anchors[ia][2] * (1 - f) + anchors[ib][2] * f | 0
    d[i*4+3] = 255
  }
  return { data: Array.from(d), w: PAL_W, h: 1 }
}

const send_palette = async () => {
  const pool = await load_colors()
  const p = gen_palette(pool)
  VIZ_IFRAME.contentWindow?.postMessage({ viz: true, palette: p.data, pal_w: p.w, pal_h: p.h }, '*')
}

const on_track_change = (reg, coalesce_img) => {
  VIZ_IFRAME.contentWindow?.postMessage({ viz: true, reset: true }, '*')
  send_palette()
  const urls   = [/** reg?.lc_capsule_url, **/ reg?.details_capsule_image, reg?.capsule_image]
  const scales = [ /* 0.3, */ 1.0, 1.0, 1.0]
  coalesce_img?.(document.getElementById('corner-art'), urls, scales)
}

const start_viz = () => {
  ensure_audio_ctx()
  if (audio_ctx.state === 'suspended') audio_ctx.resume()
  if (!viz_start) viz_start = performance.now()
  if (!viz_hidden) VIZ_IFRAME.style.opacity = '1'
  document.body.style.background = BODY_BG_VIZ
  send_palette()
  if (viz_raf) return
  let last_palette_t = 0
  const PALETTE_INTERVAL = 25
  const tick = () => {
    viz_raf = requestAnimationFrame(tick)
    analyser.getByteFrequencyData(freq_data)
    analyser.getByteTimeDomainData(wave_data)
    const t        = (performance.now() - viz_start) / 1000
    const raw_bass = freq_avg(0, 8)
    const raw_mid  = freq_avg(8, 48)
    const raw_treble = freq_avg(48, 128)
    if (raw_bass > prev_bass * 1.35 && raw_bass > 0.15 && t - last_beat_t > 0.1) {
      beat = 1.0
      last_beat_t = t
    }
    if (t - last_palette_t >= PALETTE_INTERVAL) {
      last_palette_t = t
      send_palette()
    }
    beat     *= 0.88
    prev_bass = prev_bass * 0.8 + raw_bass * 0.2
    VIZ_IFRAME.contentWindow?.postMessage({
      viz: true,
      bass:   raw_bass,
      mid:    raw_mid,
      treble: raw_treble,
      beat,
      wave:   Array.from(wave_data),
      freq:   Array.from(freq_data),
      time:   t,
    }, '*')
  }
  viz_raf = requestAnimationFrame(tick)
}

const stop_viz = () => {
  if (viz_raf) { cancelAnimationFrame(viz_raf); viz_raf = null }
  beat = 0; prev_bass = 0
  VIZ_IFRAME.style.opacity = '0'
  document.body.style.background = BODY_BG_DEFAULT
}

let viz_hidden = false
const toggle_viz = () => {
  viz_hidden = !viz_hidden
  VIZ_IFRAME.style.opacity = viz_hidden ? '0' : (viz_raf ? '1' : '0')
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Backspace') return
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
  e.preventDefault()
  toggle_viz()
})

window.start_viz = start_viz
window.stop_viz = stop_viz
window.on_track_change = on_track_change
window.toggle_viz = toggle_viz
