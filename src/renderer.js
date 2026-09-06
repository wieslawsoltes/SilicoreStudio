/** Retained, instanced WebGPU rectangle renderer with a real Canvas2D fallback. */
export const GPU_SHADER = `
struct Camera { origin: vec2<f32>, viewport: vec2<f32>, zoom: f32, _pad: vec3<f32> };
@group(0) @binding(0) var<uniform> camera: Camera;
struct VOut { @builtin(position) position: vec4<f32>, @location(0) color: vec4<f32> };
@vertex fn vs(@builtin(vertex_index) index:u32, @location(0) box:vec4<f32>, @location(1) color:vec4<f32>) -> VOut {
  let vertices = array<vec2<f32>,6>(vec2(0.,0.),vec2(1.,0.),vec2(0.,1.),vec2(0.,1.),vec2(1.,0.),vec2(1.,1.));
  let world = box.xy + vertices[index] * box.zw;
  let screen = (world - camera.origin) * camera.zoom;
  var out:VOut;
  out.position = vec4(screen.x / camera.viewport.x * 2. - 1., 1. - screen.y / camera.viewport.y * 2., 0., 1.);
  out.color = color; return out;
}
@fragment fn fs(in:VOut) -> @location(0) vec4<f32> { return in.color; }
`;
export function colorRGBA(hex,alpha=1) { const h=hex.replace('#','');return [parseInt(h.slice(0,2),16)/255,parseInt(h.slice(2,4),16)/255,parseInt(h.slice(4,6),16)/255,alpha]; }
export class SceneBuilder {
  constructor(){this.items=[];this.labels=[];}
  rect(x,y,w,h,color,alpha=1){if(w<=0||h<=0)return;this.items.push({x,y,w,h,color,alpha});}
  line(x1,y1,x2,y2,width,color,alpha=1){if(x1===x2)this.rect(x1-width/2,Math.min(y1,y2),width,Math.max(Math.abs(y2-y1),width),color,alpha);else if(y1===y2)this.rect(Math.min(x1,x2),y1-width/2,Math.max(Math.abs(x2-x1),width),width,color,alpha);else {const dx=x2-x1,dy=y2-y1,steps=Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))/Math.max(1,width));for(let i=0;i<=steps;i++)this.rect(x1+dx*i/steps-width/2,y1+dy*i/steps-width/2,width,width,color,alpha);}}
  border(x,y,w,h,color,width=1,alpha=1){this.rect(x,y,w,width,color,alpha);this.rect(x,y+h-width,w,width,color,alpha);this.rect(x,y,width,h,color,alpha);this.rect(x+w-width,y,width,h,color,alpha);}
  text(x,y,text,options={}){this.labels.push({x,y,text,...options});}
  typed(){const data=new Float32Array(this.items.length*8);this.items.forEach((r,i)=>data.set([r.x,r.y,r.w,r.h,...colorRGBA(r.color,r.alpha)],i*8));return data;}
}
export class ViewCamera {
  constructor(){this.x=0;this.y=0;this.zoom=1;this.width=800;this.height=600;}
  screenToWorld(x,y){return {x:this.x+x/this.zoom,y:this.y+y/this.zoom};}
  worldToScreen(x,y){return {x:(x-this.x)*this.zoom,y:(y-this.y)*this.zoom};}
  fit(box,padding=60){this.zoom=Math.min((this.width-padding*2)/box.w,(this.height-padding*2)/box.h);this.zoom=Math.max(.015,this.zoom);this.x=box.x-(this.width/this.zoom-box.w)/2;this.y=box.y-(this.height/this.zoom-box.h)/2;}
  zoomAt(x,y,factor){const p=this.screenToWorld(x,y);this.zoom=Math.max(.015,Math.min(80,this.zoom*factor));this.x=p.x-x/this.zoom;this.y=p.y-y/this.zoom;}
}
export class LayoutRenderer {
  constructor(canvas,overlay,changed=()=>{}){this.canvas=canvas;this.overlay=overlay;this.ctx=overlay.getContext('2d');this.camera=new ViewCamera();this.backend='initializing';this.scene=new SceneBuilder();this.dirty=true;this.frame=0;this.frameMs=0;this.primitiveCount=0;this.changed=changed;this.onOverlay=()=>{};this.disposed=false;this.dpr=1;this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas.parentElement);}
  async initialize(preference='auto'){
    if(preference!=='canvas'&&navigator.gpu){try{const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw new Error('No GPU adapter available');const device=await adapter.requestDevice();this.device=device;device.pushErrorScope('validation');const module=device.createShaderModule({label:'Silicore rectangle shader',code:GPU_SHADER});const info=await module.getCompilationInfo();const errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw new Error(errors.map(e=>e.message).join('\n'));this.pipeline=await device.createRenderPipelineAsync({label:'Retained layout instances',layout:'auto',vertex:{module,entryPoint:'vs',buffers:[{arrayStride:32,stepMode:'instance',attributes:[{shaderLocation:0,offset:0,format:'float32x4'},{shaderLocation:1,offset:16,format:'float32x4'}]}]},fragment:{module,entryPoint:'fs',targets:[{format:navigator.gpu.getPreferredCanvasFormat(),blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});
      // WGSL vec3 alignment makes this uniform block 48 bytes, not 32.
      this.uniform=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});this.bind=device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}}]});const error=await device.popErrorScope();if(error)throw new Error(error.message);this.gpuContext=this.canvas.getContext('webgpu');if(!this.gpuContext)throw new Error('WebGPU canvas unavailable');this.gpuContext.configure({device,format:navigator.gpu.getPreferredCanvasFormat(),alphaMode:'opaque'});this.backend='WebGPU';device.lost.then(info=>{if(!this.disposed){this.error=`Device lost: ${info.message}`;this.fallback();}});device.addEventListener('uncapturederror',e=>{this.error=e.error.message;console.error('WebGPU:',e.error.message);});this.changed(this.backend);
    }catch(error){this.error=error.message;this.fallback();}}else this.fallback();this.resize();this.invalidate();return this.backend;
  }
  fallback(){if(this.disposed)return;if(this.gpuContext){const replacement=this.canvas.cloneNode(false);this.canvas.replaceWith(replacement);this.canvas=replacement;this.gpuContext=null;}this.baseCtx=this.canvas.getContext('2d',{alpha:false});this.backend='Canvas 2D';this.changed(this.backend,this.error);this.dirty=true;this.invalidate();}
  resize(){const box=this.canvas.parentElement.getBoundingClientRect();if(!box.width||!box.height)return;this.dpr=Math.min(window.devicePixelRatio||1,2);this.camera.width=box.width;this.camera.height=box.height;for(const canvas of [this.canvas,this.overlay]){canvas.width=Math.max(1,Math.round(box.width*this.dpr));canvas.height=Math.max(1,Math.round(box.height*this.dpr));}this.invalidate();}
  setScene(scene){this.scene=scene;this.primitiveCount=scene.items.length;this.dirty=true;this.invalidate();}
  invalidate(){if(!this.frame&&!this.disposed)this.frame=requestAnimationFrame(()=>{this.frame=0;this.render();});}
  render(){if(this.backend==='initializing'||this.disposed)return;const start=performance.now();const c=this.camera;if(this.backend==='WebGPU'){const device=this.device;if(this.dirty){const data=this.scene.typed();const needed=Math.max(32,data.byteLength);if(!this.buffer||this.buffer.size<needed){this.buffer?.destroy();this.buffer=device.createBuffer({label:'Layout instance buffer',size:2**Math.ceil(Math.log2(needed)),usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});}if(data.length)device.queue.writeBuffer(this.buffer,0,data);this.dirty=false;}const uniform=new Float32Array(12);uniform.set([c.x,c.y,c.width,c.height,c.zoom]);device.queue.writeBuffer(this.uniform,0,uniform);const encoder=device.createCommandEncoder();const pass=encoder.beginRenderPass({colorAttachments:[{view:this.gpuContext.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:.033,g:.049,b:.066,a:1}}]});pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.bind);if(this.buffer&&this.primitiveCount){pass.setVertexBuffer(0,this.buffer);pass.draw(6,this.primitiveCount);}pass.end();device.queue.submit([encoder.finish()]);}
    else {const ctx=this.baseCtx;ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#080d11';ctx.fillRect(0,0,this.canvas.width,this.canvas.height);ctx.setTransform(c.zoom*this.dpr,0,0,c.zoom*this.dpr,-c.x*c.zoom*this.dpr,-c.y*c.zoom*this.dpr);const maxX=c.x+c.width/c.zoom,maxY=c.y+c.height/c.zoom;for(const r of this.scene.items){if(r.x+r.w<c.x||r.y+r.h<c.y||r.x>maxX||r.y>maxY)continue;ctx.globalAlpha=r.alpha;ctx.fillStyle=r.color;ctx.fillRect(r.x,r.y,r.w,r.h);}ctx.globalAlpha=1;}
    const ctx=this.ctx;ctx.setTransform(this.dpr,0,0,this.dpr,0,0);ctx.clearRect(0,0,c.width,c.height);for(const l of this.scene.labels){if(l.minZoom&&c.zoom<l.minZoom)continue;const p=c.worldToScreen(l.x,l.y);if(p.x<-300||p.x>c.width+300||p.y<-100||p.y>c.height+100)continue;const size=l.screenSize||Math.min(l.maxSize||18,(l.size||14)*c.zoom);if(size<6)continue;ctx.font=`${l.weight||400} ${size}px ${l.mono?'"SFMono-Regular",Consolas,monospace':'Inter,system-ui,sans-serif'}`;ctx.fillStyle=l.color||'#b1bec8';ctx.textAlign=l.align||'left';ctx.textBaseline='middle';ctx.fillText(l.text,p.x,p.y);}
    this.onOverlay(ctx,c);this.frameMs=performance.now()-start;
  }
  dispose(){this.disposed=true;this.resizeObserver.disconnect();cancelAnimationFrame(this.frame);this.buffer?.destroy();this.uniform?.destroy();this.device?.destroy();}
}
export function buildLayoutScene(model,layers,options={}){
  const s=new SceneBuilder();const {die}=model;const shown=id=>layers.find(l=>l.id===id)?.visible!==false;const layerColor=id=>layers.find(l=>l.id===id)?.color||'#438e86';
  s.rect(die.x,die.y,die.w,die.h,'#0c151b');s.border(die.x,die.y,die.w,die.h,'#516778',1.5,.8);
  s.border(die.x+34,die.y+34,die.w-68,die.h-68,'#344c55',1,.7);
  if(shown('grid')){for(let y=79;y<die.h-72;y+=17)s.line(72,y,die.w-72,y,.5,'#283945',.5);for(let x=79;x<die.w-72;x+=68)s.line(x,72,x,die.h-72,.5,'#263844',.3);}
  if(shown('power')){for(let d=46;d<64;d+=7)s.border(die.x+d,die.y+d,die.w-d*2,die.h-d*2,d===53?'#708168':'#825f49',1.7,.85);for(let y=88;y<die.h-70;y+=68)s.line(65,y,die.w-65,y,1.2,'#7d6146',.25);for(let x=88;x<die.w-70;x+=104)s.line(x,65,x,die.h-65,1.2,'#667a59',.23);}
  if(shown('cells'))for(const c of model.cells){if(c.kind!=='cell')continue;const rgb=c.logicId?'#65b09c':LIBRARY_COLORS[c.type]||'#438f7a';s.rect(c.x,c.y,c.w,c.h,rgb,c.logicId?.94:.72);s.rect(c.x+1,c.y+1,Math.max(1,c.w-2),1,'#a1cec1',.2);if(c.w>14)s.line(c.x+c.w-3,c.y+2,c.x+c.w-3,c.y+c.h-2,.7,'#0d2426',.65);if(options.cellLabels)s.text(c.x+c.w/2,c.y+c.h/2,c.name.split('/').at(-1),{size:7,align:'center',color:'#e5fff5',minZoom:3.5,mono:true});}
  if(shown('macros'))for(const c of model.cells){if(c.kind!=='macro')continue;const color=c.color||'#8273b1';s.rect(c.x,c.y,c.w,c.h,color,.13);s.border(c.x,c.y,c.w,c.h,color,1.5,.95);s.border(c.x+6,c.y+6,c.w-12,c.h-12,color,.7,.4);for(let i=11;i<c.w-10;i+=6)s.line(c.x+i,c.y+14,c.x+i,c.y+c.h-14,.8,color,.12);for(let i=0;i<Math.floor(c.h/10);i++){s.rect(c.x-2,c.y+6+i*10,4,2,color,.95);s.rect(c.x+c.w-2,c.y+6+i*10,4,2,color,.95);}s.text(c.x+17,c.y+24,c.name,{size:19,weight:600,color:'#c9d4df',mono:true});s.text(c.x+17,c.y+47,c.label||c.ref,{size:14,color:'#9daebd'});s.text(c.x+17,c.y+c.h-24,c.detail||'Physical macro',{size:12,color:'#8294a4',mono:true});}
  // Low-opacity route context, with highlighted nets rendered separately by the overlay.
  for(const n of model.nets)for(const seg of n.segments||[])if(shown(seg.layer))s.line(seg.x1,seg.y1,seg.x2,seg.y2,n.width,layerColor(seg.layer),options.routeOpacity??.29);
  if(shown('pins')){for(let i=0;i<40;i++){const x=80+i*(die.w-160)/39,y=80+i*(die.h-160)/39;s.rect(x,25,7,8,'#80b4a4',.85);s.rect(x,die.h-33,7,8,'#80b4a4',.85);s.rect(25,y,8,7,'#80b4a4',.85);s.rect(die.w-33,y,8,7,'#80b4a4',.85);}}
  s.text(die.x,die.y-27,'AURORA  /  REFERENCE FLOORPLAN',{screenSize:10,color:'#7a8d9d',mono:true});s.text(die.x+die.w,die.y-27,`${die.w.toLocaleString()} × ${die.h.toLocaleString()} µm`,{screenSize:10,color:'#7a8d9d',mono:true,align:'right'});
  s.text(die.x+die.w/2,die.y+die.h+29,`${die.w.toLocaleString()} µm`,{screenSize:10,color:'#788e9d',mono:true,align:'center'});
  if(options.heatmap){const step=48;const bins=new Map();for(const n of model.nets)for(const l of n.segments||[]){const length=Math.abs(l.x2-l.x1)+Math.abs(l.y2-l.y1),count=Math.max(1,Math.ceil(length/step));for(let j=0;j<=count;j++){const x=Math.floor((l.x1+(l.x2-l.x1)*j/count)/step),y=Math.floor((l.y1+(l.y2-l.y1)*j/count)/step);const k=`${x},${y}`;bins.set(k,(bins.get(k)||0)+1);}}const max=Math.max(1,...bins.values());for(const [key,v]of bins){const[x,y]=key.split(',').map(Number);const t=v/max;s.rect(x*step,y*step,step-1,step-1,t>.7?'#f16b67':t>.4?'#dbb661':'#37a88d',.1+t*.48);}}
  return s;
}
const LIBRARY_COLORS={AND:'#378e78',OR:'#418691',XOR:'#7479ab',NOT:'#508764',NAND:'#33897c',NOR:'#4d8c93',BUF:'#648c70',MUX:'#94835e',ADD:'#8a79a9',SUB:'#947994',EQ:'#a29162',NE:'#9a8262'};
