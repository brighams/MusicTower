const PAL  = 'vec3 pal(float t,sampler2D s){t=fract(t);return texture2D(s,vec2(t,t)).rgb;}'
const HASH = 'float hash(vec2 p){p=fract(p*vec2(443.897,441.423));p+=dot(p,p.yx+19.19);return fract(p.x*p.y);}'

const SHADERS = [
  {
    name: 'Plasma Wave',
    src: `precision mediump float;
uniform float u_time,u_bass,u_mid,u_treble,u_beat,u_alpha;uniform vec2 u_res;
uniform sampler2D u_palette,u_wave,u_freq;
${PAL}
void main(){
  vec2 uv=(gl_FragCoord.xy/u_res-.5)*vec2(u_res.x/u_res.y,1.);
  float t=u_time*.35,e=.08+u_bass*.92+u_beat*.3;
  uv*=1.+u_bass*.8+u_beat*.4;
  float v=sin(uv.x*3.+t+u_bass*5.)+sin(uv.y*2.5-t*.9+u_mid*3.)
         +sin((uv.x+uv.y)*4.5+t*1.2)+sin(length(uv)*7.-t*2.5+u_bass*8.);
  v=v*.125+.5;
  float v2=(sin(uv.x*5.-t*1.5+u_treble*4.)+sin(uv.y*6.+t*.8))*.25+.5;
  gl_FragColor=vec4((pal(v,u_palette)*.7+pal(v2,u_palette)*.3)*e,u_alpha);
}`,
  },
  {
    name: 'Color Spiral',
    src: `precision mediump float;
uniform float u_time,u_bass,u_mid,u_treble,u_beat,u_alpha;uniform vec2 u_res;
uniform sampler2D u_palette,u_wave,u_freq;
${PAL}
void main(){
  vec2 uv=(gl_FragCoord.xy/u_res-.5);uv.x*=u_res.x/u_res.y;
  float a=atan(uv.y,uv.x),d=length(uv),t=u_time*.5;
  float v=fract(.25/(d+.001)+t+u_bass*.8+a/6.28318+u_mid*.4+t*.1);
  float ring=1.-smoothstep(0.,.03,abs(fract(d*3.-t*2.+u_bass*2.)-.5));
  vec3 col=pal(v,u_palette)+ring*pal(fract(v+.5),u_palette)*u_beat;
  col*=(.1+u_bass*.9)*(1.-smoothstep(.7,1.3,d));
  gl_FragColor=vec4(col,u_alpha);
}`,
  },
  {
    name: 'Kaleidoscope',
    src: `precision mediump float;
uniform float u_time,u_bass,u_mid,u_treble,u_beat,u_alpha;uniform vec2 u_res;
uniform sampler2D u_palette,u_wave,u_freq;
${PAL}
void main(){
  vec2 uv=(gl_FragCoord.xy/u_res-.5);uv.x*=u_res.x/u_res.y;
  float t=u_time*.15,N=floor(4.+u_mid*5.)*2.;
  float a=atan(uv.y,uv.x),d=length(uv),seg=6.28318/N;
  a=mod(a,seg);if(a>seg*.5)a=seg-a;
  vec2 p=vec2(cos(a),sin(a))*d*(1.5+u_bass)+vec2(t*.4,t*.25);
  float v=(sin(p.x*4.+t)*sin(p.y*3.-t*.8)+sin(length(p)*6.-t*2.+u_bass*5.))*.25+.5;
  float v2=cos(p.x*2.5-p.y*3.5+t*1.3)*.5+.5;
  gl_FragColor=vec4((pal(v,u_palette)*.6+pal(v2,u_palette)*.4)*(.12+u_bass*.88+u_beat*.3),u_alpha);
}`,
  },
  {
    name: 'Audio Ring',
    src: `precision mediump float;
uniform float u_time,u_bass,u_mid,u_treble,u_beat,u_alpha;uniform vec2 u_res;
uniform sampler2D u_palette,u_wave,u_freq;
${PAL}
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
}`,
  },
  {
    name: 'FBM Plasma',
    src: `precision mediump float;
uniform float u_time,u_bass,u_mid,u_treble,u_beat,u_alpha;uniform vec2 u_res;
uniform sampler2D u_palette,u_wave,u_freq;
${PAL}
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
}`,
  },
  {
    name: 'Aurora Sparks',
    src: `precision mediump float;
uniform float u_time,u_bass,u_mid,u_treble,u_beat,u_alpha;uniform vec2 u_res;
uniform sampler2D u_palette,u_wave,u_freq;
${PAL}
${HASH}
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
}`,
  },
  {
    name: 'Firefly Orbs',
    src: `precision mediump float;
uniform float u_time,u_bass,u_mid,u_treble,u_beat,u_alpha;uniform vec2 u_res;
uniform sampler2D u_palette,u_wave,u_freq;
${PAL}
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
}`,
  },
  {
    name: 'Fire Eye',
    src: `precision mediump float;
uniform float u_time,u_bass,u_mid,u_treble,u_beat,u_alpha;uniform vec2 u_res;
uniform sampler2D u_palette,u_wave,u_freq;
${HASH}
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
}`,
  },
]

export const og_viz_catalog = () =>
  SHADERS.map((s, i) => ({
    id: `og_${i}`,
    name: s.name,
    num: 1,
    mode: 'TRIANGLES',
    src: s.src,
    bg: '#000000',
    author: 'MusicTower',
    avatar: null,
  }))

const _srcs_json = JSON.stringify(SHADERS.map(s => s.src))

export const OG_HTML = `<!DOCTYPE html><html><head><style>
*{margin:0;padding:0}body{background:#000;overflow:hidden}canvas{display:block;width:100vw;height:100vh}
</style></head><body><canvas id="c"></canvas><script>
const canvas=document.getElementById('c')
const gl=canvas.getContext('webgl')
const resize=()=>{canvas.width=innerWidth;canvas.height=innerHeight;gl.viewport(0,0,canvas.width,canvas.height)}
window.addEventListener('resize',resize);resize()
gl.clearColor(0,0,0,1);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE)
const SRCS=${_srcs_json}
const VERT='attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0,1);}'
const compile=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);return s}
const quad=(()=>{const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);return b})()
const build_prog=src=>{
  const p=gl.createProgram()
  gl.attachShader(p,compile(gl.VERTEX_SHADER,VERT));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,src))
  gl.linkProgram(p)
  gl.bindBuffer(gl.ARRAY_BUFFER,quad)
  const loc=gl.getAttribLocation(p,'a_pos')
  gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0)
  const U=n=>gl.getUniformLocation(p,n)
  return{p,Ut:U('u_time'),Ub:U('u_bass'),Um:U('u_mid'),Utr:U('u_treble'),Ube:U('u_beat'),Ur:U('u_res'),Up:U('u_palette'),Uw:U('u_wave'),Uf:U('u_freq'),Ua:U('u_alpha')}
}
const mk_tex=(w,h,d)=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,d);return t}
const dflt_pal=()=>{const d=new Uint8Array(256);for(let i=0;i<64;i++){const t=i/63;d[i*4]=(t*180+10)|0;d[i*4+1]=(t*20)|0;d[i*4+2]=(t*230+25)|0;d[i*4+3]=255}return d}
const pal_tex=mk_tex(64,1,dflt_pal())
const wave_tex=mk_tex(256,1,new Uint8Array(1024).fill(128))
const freq_tex=mk_tex(128,1,new Uint8Array(512).fill(0))
const up_gray=(tex,w,src)=>{const d=new Uint8Array(w*4);for(let i=0;i<w;i++){const v=src[i]??128;d[i*4]=d[i*4+1]=d[i*4+2]=v;d[i*4+3]=255}gl.bindTexture(gl.TEXTURE_2D,tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,1,0,gl.RGBA,gl.UNSIGNED_BYTE,d)}
const progs=SRCS.map(build_prog).filter(Boolean)
let bass=0,mid=0,treble=0,beat=0,viz_time=0
const draw=(po,alpha)=>{
  const{p,Ut,Ub,Um,Utr,Ube,Ur,Up,Uw,Uf,Ua}=po
  gl.useProgram(p)
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,pal_tex);gl.uniform1i(Up,0)
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,wave_tex);gl.uniform1i(Uw,1)
  gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,freq_tex);gl.uniform1i(Uf,2)
  gl.uniform1f(Ut,viz_time);gl.uniform1f(Ub,bass);gl.uniform1f(Um,mid);gl.uniform1f(Utr,treble);gl.uniform1f(Ube,beat)
  gl.uniform2f(Ur,canvas.width,canvas.height);gl.uniform1f(Ua,alpha)
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4)
}
window.addEventListener('message',e=>{
  const d=e.data;if(!d?.viz)return
  if(d.bass!==undefined)bass=d.bass
  if(d.mid!==undefined)mid=d.mid
  if(d.treble!==undefined)treble=d.treble
  if(d.beat!==undefined)beat=d.beat
  if(d.time!==undefined)viz_time=d.time
  if(d.wave)up_gray(wave_tex,256,d.wave)
  if(d.freq)up_gray(freq_tex,128,d.freq)
  if(d.palette){const pw=d.pal_w||64;gl.bindTexture(gl.TEXTURE_2D,pal_tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,pw,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(d.palette))}
  if(d.reset){next=rnd(progs.length,cur);fade_start=ns()}
})
const rnd=(n,x=-1)=>{if(n<=1)return 0;let r;do{r=Math.floor(Math.random()*n)}while(r===x);return r}
const ns=()=>performance.now()/1000
const FADE=1.5,DURS=[12,18,24]
const rnd_dur=()=>DURS[Math.floor(Math.random()*DURS.length)]
let cur=rnd(progs.length),next=-1,ts=ns(),fade_start=0,dur=rnd_dur()
const render=()=>{
  requestAnimationFrame(render)
  if(!progs.length)return
  gl.clear(gl.COLOR_BUFFER_BIT)
  const t=ns()
  if(next===-1&&t-ts>=dur){next=rnd(progs.length,cur);fade_start=t}
  if(next!==-1){
    const ft=Math.min(1,(t-fade_start)/FADE)
    draw(progs[cur],1-ft);draw(progs[next],ft)
    if(ft>=1){cur=next;next=-1;ts=t;dur=rnd_dur()}
  }else{draw(progs[cur],1)}
}
render()
<\/script></body></html>`
