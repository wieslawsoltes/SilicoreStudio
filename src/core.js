/** Silicore implementation kernel. No browser globals and no external dependencies. */
export const VERSION = '0.1.0';
export const LAYERS = [
  { id:'cells', name:'Standard cells', color:'#398e77', visible:true },
  { id:'macros', name:'Macro blocks', color:'#8e85d1', visible:true },
  { id:'M1', name:'Metal 1', color:'#44b0ac', visible:true, minWidth:0.5 },
  { id:'M2', name:'Metal 2', color:'#7775c0', visible:true, minWidth:0.5 },
  { id:'M3', name:'Metal 3', color:'#cdad69', visible:true, minWidth:0.7 },
  { id:'M4', name:'Metal 4', color:'#b976b1', visible:true, minWidth:0.7 },
  { id:'power', name:'Power grid', color:'#936756', visible:true },
  { id:'pins', name:'I/O terminals', color:'#79baa3', visible:true },
  { id:'grid', name:'Placement rows', color:'#465560', visible:true },
];
export const LIBRARY = {
  AND:{area:14,delay:0.042,color:'#369884',arity:2}, OR:{area:14,delay:0.044,color:'#467f93',arity:2},
  XOR:{area:22,delay:0.068,color:'#7675b1',arity:2}, NOT:{area:8,delay:0.021,color:'#558f69',arity:1},
  NAND:{area:10,delay:0.034,color:'#338879',arity:2}, NOR:{area:10,delay:0.037,color:'#43899a',arity:2},
  BUF:{area:8,delay:0.018,color:'#628f72',arity:1}, MUX:{area:24,delay:0.061,color:'#9b8763',arity:3},
  ADD:{area:36,delay:0.12,color:'#927eae',arity:2}, SUB:{area:38,delay:0.13,color:'#997e9d',arity:2},
  EQ:{area:20,delay:0.059,color:'#b39862',arity:2}, NE:{area:20,delay:0.059,color:'#a18762',arity:2},
  LAND:{area:14,delay:0.042,color:'#369884',arity:2}, LOR:{area:14,delay:0.044,color:'#467f93',arity:2},
  LNOT:{area:8,delay:0.021,color:'#558f69',arity:1}, SLICE:{area:4,delay:0,color:'#657985',arity:1},
};
export const DEFAULT_HDL = `// AURORA / control_unit
// Combinational reference design · portable Verilog subset
// Edit this module, then choose Synthesize (Ctrl+Enter).

module control_unit (
    input  wire req,
    input  wire ready,
    input  wire enable,
    input  wire reset_n,
    input  wire mode,
    output wire grant,
    output wire busy,
    output wire valid,
    output wire parity,
    output wire selected
);

    wire request_ok;
    assign request_ok = req & enable;
    assign grant      = request_ok & ready;
    assign busy       = req & ~ready;
    assign valid      = grant & reset_n;
    assign parity     = req ^ ready ^ mode;
    assign selected   = mode ? req : ready;

endmodule
`;
export const clone = value => structuredClone(value);
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export function random(seed=42) { let a=seed>>>0; return () => { a+=0x6D2B79F5; let t=Math.imul(a^a>>>15,1|a); t^=t+Math.imul(t^t>>>7,61|t); return ((t^t>>>14)>>>0)/4294967296; }; }
export function intersects(a,b,pad=0) { return a.x < b.x+b.w+pad && a.x+a.w+pad > b.x && a.y < b.y+b.h+pad && a.y+a.h+pad > b.y; }
export const center = c => ({x:c.x+c.w/2,y:c.y+c.h/2});
export class SpatialIndex {
  constructor(size=48, maxBuckets=4096) {
    if(!Number.isFinite(size)||size<=0)throw new RangeError('Spatial bucket size must be positive');
    this.size=size; this.maxBuckets=maxBuckets; this.buckets=new Map(); this.items=new Map(); this.large=[];
  }
  keys(b) {
    const x0=Math.floor(b.x/this.size), y0=Math.floor(b.y/this.size);
    const x1=Math.floor((b.x+b.w)/this.size), y1=Math.floor((b.y+b.h)/this.size);
    // Never allocate a grid-sized list for a large imported macro or zoomed-out query.
    if(![x0,y0,x1,y1].every(Number.isFinite)||(x1-x0+1)*(y1-y0+1)>this.maxBuckets)return null;
    const keys=[]; for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)keys.push(`${x},${y}`); return keys;
  }
  rebuild(items) {
    this.buckets.clear(); this.items.clear(); this.large=[];
    for(const item of items){this.items.set(item.id,item);const keys=this.keys(item);
      if(!keys){this.large.push(item);continue;}
      for(const key of keys){if(!this.buckets.has(key))this.buckets.set(key,[]);this.buckets.get(key).push(item);}
    }
  }
  query(box) {
    const keys=this.keys(box); if(!keys)return [...this.items.values()].filter(item=>intersects(item,box));
    const found=new Map(); for(const item of this.large)if(intersects(item,box))found.set(item.id,item);
    for(const key of keys)for(const item of this.buckets.get(key)||[])if(intersects(item,box))found.set(item.id,item);
    return [...found.values()];
  }
  point(x,y,tolerance=1){return this.query({x:x-tolerance,y:y-tolerance,w:tolerance*2,h:tolerance*2}).sort((a,b)=>a.w*a.h-b.w*b.h);}
}
export class History {
  constructor(limit=40, budget=32*1024*1024) { this.limit=limit; this.budget=budget; this.undoStack=[]; this.redoStack=[]; this.pending=null; }
  begin(model,label) { if(!this.pending) this.pending={label,json:JSON.stringify(model)}; }
  commit(model) { if(!this.pending) return false; const before=this.pending; this.pending=null; if(before.json===JSON.stringify(model)) return false; this.undoStack.push(before); this.redoStack=[]; while(this.undoStack.length>this.limit || (this.undoStack.length>1 && this.undoStack.reduce((s,c)=>s+c.json.length*2,0)>this.budget)) this.undoStack.shift(); return true; }
  cancel() { const p=this.pending; this.pending=null; return p?JSON.parse(p.json):null; }
  undo(model) { const c=this.undoStack.pop(); if(!c) return null; this.redoStack.push({label:c.label,json:JSON.stringify(model)}); return {model:JSON.parse(c.json),label:c.label}; }
  redo(model) { const c=this.redoStack.pop(); if(!c) return null; this.undoStack.push({label:c.label,json:JSON.stringify(model)}); return {model:JSON.parse(c.json),label:c.label}; }
}

// Intentionally bounded Verilog compiler. Unsupported syntax is rejected, never ignored.
export class HDLError extends Error { constructor(message,token) { super(`${message}${token?` (line ${token.line}, column ${token.col})`:''}`); this.name='HDLError'; this.line=token?.line||1; this.column=token?.col||1; } }
export function tokenize(source) {
  const tokens=[]; let p=0,line=1,col=1;
  while(p<source.length) {
    const rest=source.slice(p); let m;
    if((m=/^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.exec(rest))) { for(const c of m[0]) { if(c==='\n'){line++;col=1;}else col++; } p+=m[0].length; continue; }
    m=/^(?:\d+'[sS]?[bBhHdD][0-9a-fA-F_xXzZ]+|\d+|[a-zA-Z_$][\w$]*|==|!=|&&|\|\||[()\[\]:;,?~!&|^+\-=])/.exec(rest);
    if(!m) throw new HDLError(`Unexpected character '${rest[0]}'`,{line,col});
    tokens.push({value:m[0],line,col}); p+=m[0].length; col+=m[0].length;
    if(tokens.length>100000) throw new HDLError('Source exceeds the 100,000-token safety limit');
  }
  tokens.push({value:'<eof>',line,col}); return tokens;
}
const mask = width => width>=32?0xffffffff:(2**width-1)>>>0;
function literal(text) { const m=/^(\d+)'([sS]?)([bBhHdD])([0-9a-fA-F_xXzZ]+)$/.exec(text); if(m){ const w=Number(m[1]); if(w<1||w>32) throw new HDLError('Literal widths must be 1–32 bits'); if(/[xz]/i.test(m[4])) throw new HDLError('X/Z literals are not supported by this two-state simulator'); if(m[2]) throw new HDLError('Signed literals are not supported'); const digits=m[4].replaceAll('_',''); const radix={b:2,h:16,d:10}[m[3].toLowerCase()]; const valid=radix===2?/^[01]+$/:radix===10?/^\d+$/:/^[\da-f]+$/i; if(!valid.test(digits)) throw new HDLError('Invalid digits in numeric literal'); return {type:'constant',value:(parseInt(digits,radix)&mask(w))>>>0,width:w}; } const n=Number(text); if(!Number.isSafeInteger(n)||n>0xffffffff) throw new HDLError('Integer literal exceeds 32 bits'); return {type:'constant',value:n>>>0,width:32}; }
export function compileHDL(source) {
  if(typeof source!=='string'||source.length>1000000) throw new HDLError('Source must be text, at most 1 MB');
  const tokens=tokenize(source); let at=0; const peek=()=>tokens[at].value; const next=()=>tokens[at++];
  const expect=value=>{const t=next();if(t.value!==value)throw new HDLError(`Expected '${value}', got '${t.value}'`,t);return t;};
  const ident=()=>{const t=next();if(!/^[a-zA-Z_$][\w$]*$/.test(t.value))throw new HDLError('Expected an identifier',t);return t.value;};
  const signals=new Map(), inputs=[],outputs=[],assignments=new Map();
  const range=()=>{if(peek()!=='[')return 1;next();const msb=Number(next().value);expect(':');const lsb=Number(next().value);expect(']'); if(!Number.isInteger(msb)||lsb!==0||msb<0||msb>31)throw new HDLError('Only descending [N:0] buses up to 32 bits are supported',tokens[at-1]);return msb+1;};
  const declare=(name,width,direction)=>{if(signals.has(name))throw new HDLError(`Duplicate declaration '${name}'`);const s={name,width,direction};signals.set(name,s);if(direction==='input')inputs.push(s);if(direction==='output')outputs.push(s);};
  expect('module'); const name=ident(); expect('('); let direction=null,width=1;
  while(peek()!==')') { if(['input','output'].includes(peek())) { direction=next().value;if(['wire','logic'].includes(peek()))next();width=range(); } if(!direction)throw new HDLError('Use ANSI-style input/output declarations',tokens[at]); declare(ident(),width,direction);if(peek()!==')')expect(','); }
  expect(')');expect(';');
  const precedence={'||':1,'&&':2,'|':3,'^':4,'&':5,'==':6,'!=':6,'+':7,'-':7};
  function expr(min=0) {
    const t=next();let node;
    if(t.value==='('){node=expr();expect(')');}
    else if(['~','!'].includes(t.value)){node={type:'unary',op:t.value,arg:expr(8)};}
    else if(/^\d/.test(t.value))node=literal(t.value);
    else if(/^[a-zA-Z_$][\w$]*$/.test(t.value)) { node={type:'signal',name:t.value}; if(peek()==='['){next();const bit=Number(next().value);expect(']');if(!Number.isInteger(bit)||bit<0||bit>31)throw new HDLError('Bit index must be 0–31',t);node={type:'slice',arg:node,bit};} }
    else throw new HDLError(`Expected an expression, got '${t.value}'`,t);
    while(precedence[peek()]!==undefined && precedence[peek()]>=min) { const op=next().value; node={type:'binary',op,left:node,right:expr(precedence[op]+1)}; }
    if(min===0&&peek()==='?'){next();const yes=expr();expect(':');node={type:'mux',test:node,yes,no:expr()};}
    return node;
  }
  while(peek()!=='endmodule') {
    if(peek()==='<eof>')throw new HDLError('Missing endmodule',tokens[at]);
    if(['wire','logic'].includes(peek())){next();const w=range();do{declare(ident(),w,'wire');if(peek()!==',')break;next();}while(true);expect(';');}
    else if(peek()==='assign') { next();const target=ident();expect('=');const ast=expr();expect(';');if(assignments.has(target))throw new HDLError(`Multiple drivers for '${target}'`);if(!signals.has(target))throw new HDLError(`Undeclared assignment target '${target}'`);if(signals.get(target).direction==='input')throw new HDLError(`Cannot drive input '${target}'`);assignments.set(target,ast); }
    else throw new HDLError(`Unsupported construct '${peek()}'. This compiler accepts combinational continuous assignments only`,tokens[at]);
  }
  expect('endmodule');expect('<eof>');
  const gates=[],refs=new Map(),resolving=new Set();let seq=0;
  for(const p of inputs)refs.set(p.name,{id:`in:${p.name}`,name:p.name,width:p.width});
  const emit=(type,args,width,extra={})=>{const id=`g${++seq}`;const g={id,name:`u_${type.toLowerCase()}_${seq}`,type,inputs:args.map(a=>a.id),width:clamp(width,1,32),...extra};gates.push(g);return {id,width:g.width};};
  function resolve(name) { if(refs.has(name))return refs.get(name);const s=signals.get(name);if(!s)throw new HDLError(`Undeclared signal '${name}'`);if(!assignments.has(name))throw new HDLError(`Signal '${name}' has no driver`);if(resolving.has(name))throw new HDLError(`Combinational cycle through '${name}'`);resolving.add(name);const r=build(assignments.get(name),s.width);const out=emit('BUF',[r],s.width,{signal:name});refs.set(name,out);resolving.delete(name);return out; }
  function build(ast,context=1) {
    if(ast.type==='signal')return resolve(ast.name);
    if(ast.type==='constant')return {id:`const:${ast.width}:${ast.value}`,width:ast.width};
    if(ast.type==='slice'){const a=build(ast.arg);if(ast.bit>=a.width)throw new HDLError(`Bit select [${ast.bit}] is out of range`);return emit('SLICE',[a],1,{bit:ast.bit});}
    if(ast.type==='unary'){const a=build(ast.arg,context);return emit(ast.op==='~'?'NOT':'LNOT',[a],ast.op==='!'?1:Math.max(a.width,context));}
    if(ast.type==='mux'){const a=build(ast.test),b=build(ast.yes,context),c=build(ast.no,context);return emit('MUX',[a,b,c],Math.max(context,b.width,c.width));}
    const a=build(ast.left,context),b=build(ast.right,context);const type={'&':'AND','|':'OR','^':'XOR','+':'ADD','-':'SUB','==':'EQ','!=':'NE','&&':'LAND','||':'LOR'}[ast.op];return emit(type,[a,b],['EQ','NE','LAND','LOR'].includes(type)?1:Math.max(context,a.width,b.width));
  }
  const ports=outputs.map(p=>({...p,source:resolve(p.name).id}));
  return {name,inputs,gates,outputs:ports,source,version:1};
}
export function orderedGates(logic) {
  // Iterative Kahn traversal avoids recursion limits for deep imported netlists.
  const map=new Map(logic.gates.map(g=>[g.id,g])), degrees=new Map(), successors=new Map();
  for(const g of logic.gates){let degree=0;for(const input of g.inputs){if(!map.has(input))continue;degree++;if(!successors.has(input))successors.set(input,[]);successors.get(input).push(g.id);}degrees.set(g.id,degree);}
  const queue=logic.gates.filter(g=>degrees.get(g.id)===0), order=[];
  for(let head=0;head<queue.length;head++){const gate=queue[head];order.push(gate);for(const id of successors.get(gate.id)||[]){const remaining=degrees.get(id)-1;degrees.set(id,remaining);if(remaining===0)queue.push(map.get(id));}}
  if(order.length!==logic.gates.length)throw new Error(`Combinational cycle at ${logic.gates.find(g=>degrees.get(g.id)>0)?.id}`);
  return order;
}
export function evaluateLogic(logic, values={}, sequence=null) {
  const result=new Map();for(const p of logic.inputs){const v=values[p.name];result.set(`in:${p.name}`,v===null?null:((Number(v??0)&mask(p.width))>>>0));}
  const get=id=>{if(id.startsWith('const:'))return Number(id.split(':')[2]);return result.has(id)?result.get(id):null;};
  for(const g of sequence||orderedGates(logic)) {
    const v=g.inputs.map(get);let out=null;
    if(!v.some(x=>x===null)) { const [a=0,b=0,c=0]=v;switch(g.type){case'AND':out=a&b;break;case'OR':out=a|b;break;case'XOR':out=a^b;break;case'NOT':out=~a;break;case'NAND':out=~(a&b);break;case'NOR':out=~(a|b);break;case'BUF':out=a;break;case'MUX':out=a?b:c;break;case'ADD':out=a+b;break;case'SUB':out=a-b;break;case'EQ':out=+(a===b);break;case'NE':out=+(a!==b);break;case'LAND':out=+(!!a&&!!b);break;case'LOR':out=+(!!a||!!b);break;case'LNOT':out=+!a;break;case'SLICE':out=a>>>g.bit;break;default:throw new Error(`Unknown gate ${g.type}`);}out=(out&mask(g.width))>>>0; }
    result.set(g.id,out);
  }
  return {outputs:Object.fromEntries(logic.outputs.map(p=>{const value=get(p.source);return [p.name,value===null?null:(value&mask(p.width))>>>0];})),values:Object.fromEntries(result)};
}
export function simulate(logic,cycles=64,overrides={}) {
  cycles=clamp(Math.floor(cycles),1,1024);const order=orderedGates(logic);const signals=[...logic.inputs.map(p=>({...p,kind:'input'})),...logic.outputs.map(p=>({...p,kind:'output'}))].map(s=>({...s,values:[]}));
  for(let t=0;t<cycles;t++) { const input=Object.fromEntries(logic.inputs.map((p,i)=>[p.name,overrides[p.name]??((Math.floor(t/2**(i%6)))&mask(p.width))]));const result=evaluateLogic(logic,input,order);for(const s of signals)s.values.push(s.kind==='input'?input[s.name]:result.outputs[s.name]); }
  return {cycles,signals,model:'two-state combinational, unit sample interval'};
}

export function createDemo() {
  const rnd=random(20260906);const die={x:0,y:0,w:1280,h:940};
  const macros=[
    {id:'m1',name:'U_IMEM',ref:'SRAM_64K',x:99,y:111,w:263,h:220,color:'#428b85',label:'Instruction memory',detail:'64 KB · 1RW'},
    {id:'m2',name:'U_DMEM',ref:'SRAM_64K',x:99,y:602,w:263,h:220,color:'#428b85',label:'Data memory',detail:'64 KB · 1RW'},
    {id:'m3',name:'U_L2_BANK0',ref:'SRAM_128K',x:907,y:111,w:273,h:220,color:'#7970b0',label:'L2 cache · bank 0',detail:'128 KB · 1RW'},
    {id:'m4',name:'U_L2_BANK1',ref:'SRAM_128K',x:907,y:602,w:273,h:220,color:'#7970b0',label:'L2 cache · bank 1',detail:'128 KB · 1RW'},
    {id:'m5',name:'U_PLL',ref:'PLL_DEMO',x:548,y:112,w:179,h:128,color:'#a18e5d',label:'Clock generation',detail:'Behavior not modeled'},
    {id:'m6',name:'U_BOOTROM',ref:'ROM_16K',x:548,y:704,w:179,h:116,color:'#657b9e',label:'Boot ROM',detail:'16 KB · read-only'},
  ].map(m=>({...m,kind:'macro',type:'MACRO',fixed:true,layer:'macros'}));
  const cells=[...macros];const types=['AND','OR','XOR','NOT','NAND','NOR','BUF','MUX'];let id=0;
  for(let y=79;y<861;y+=17)for(let x=80;x<1190;) {
    const type=types[Math.floor(rnd()*types.length)];const w=[12,16,20,24,28][Math.floor(rnd()*5)];const c={id:`c${++id}`,name:`u_core/u_${type.toLowerCase()}_${id}`,type,ref:`${type}_X${rnd()>.8?2:1}`,kind:'cell',x,y,w,h:10,layer:'cells',fixed:false};
    x+=w+3+Math.floor(rnd()*4);if(rnd()<.085||macros.some(m=>intersects(c,m,8)))continue;cells.push(c);
  }
  const logic=compileHDL(DEFAULT_HDL);const logicCells=[];
  for(let i=0;i<logic.gates.length;i++){const g=logic.gates[i];const existing=cells.find(c=>c.kind==='cell'&&c.x>470&&c.x<800&&c.y>370&&c.y<570&&!c.logicId);if(existing){Object.assign(existing,{name:`u_control/${g.name}`,type:g.type,ref:`${g.type}_X1`,logicId:g.id});logicCells.push(existing);}}
  const standard=cells.filter(c=>c.kind==='cell');const nets=[];
  // Acyclic synthetic connectivity for the physical floorplan. The control block has its own elaborated RTL graph.
  for(let i=1;i<standard.length;i++) {
    const c=standard[i];const back=Math.min(i,35);const j=i-1-Math.floor(rnd()*back);const from=standard[j];
    nets.push({id:`n${nets.length+1}`,name:`net_${i}`,from:from.id,to:[c.id],width:i%27===0?1.4:.7,layer:i%11===0?'M3':i%3===0?'M2':'M1',segments:[]});
  }
  const model={schema:'silicore/1',name:'aurora_top',technology:'DEMO-45',units:'µm',die,cells,nets,logic,hdl:DEFAULT_HDL,clock:2.5,notes:[],revision:0};
  model.nets=quickRoute(model);
  return model;
}
export function quickRoute(model) {
  const map=new Map(model.cells.map(c=>[c.id,c]));return model.nets.map((n,index)=>{const a=map.get(n.from);if(!a)return {...n,segments:[]};const seg=[];for(const id of n.to){const b=map.get(id);if(!b)continue;const s={x:a.x+a.w,y:a.y+a.h/2},t={x:b.x,y:b.y+b.h/2};const x=(s.x+t.x)/2+((index%7)-3)*1.6;seg.push({x1:s.x,y1:s.y,x2:x,y2:s.y,layer:n.layer},{x1:x,y1:s.y,x2:x,y2:t.y,layer:n.layer==='M1'?'M2':n.layer},{x1:x,y1:t.y,x2:t.x,y2:t.y,layer:n.layer});}return {...n,segments:seg};});
}
export function legalize(model) {
  const copy=clone(model.cells);const fixed=copy.filter(c=>c.fixed||c.kind==='macro');const movable=copy.filter(c=>!c.fixed&&c.kind!=='macro').sort((a,b)=>a.y-b.y||a.x-b.x);const index=new SpatialIndex(32);index.rebuild(fixed);const occupied=[...fixed];let placed=0,failed=0;
  const {die}=model;const row=movable.reduce((h,c)=>Math.max(h,c.h+7),17);let x=die.x+79,y=die.y+79;
  for(const c of movable) {let found=false;const ox=c.x,oy=c.y;while(y+c.h<die.y+die.h-72){if(x+c.w>die.x+die.w-78){x=die.x+79;y+=row;continue;}const b={x,y,w:c.w+3,h:c.h+4};const hits=index.query(b);if(hits.length){x=Math.max(...hits.map(h=>h.x+h.w))+5;continue;}c.x=x;c.y=y;x+=c.w+4;found=true;placed++;break;}if(!found){c.x=ox;c.y=oy;failed++;}occupied.push(c);}
  // Movable objects are packed monotonically in rows; fixed objects are queried from the broad phase.
  return {cells:copy,placed,failed,algorithm:'row legalization with fixed-macro exclusion'};
}
class MinHeap {
  constructor(){this.a=[];}
  push(id,cost){const a=this.a;let i=a.length;a.push({id,cost});while(i){let p=(i-1)>>1;if(a[p].cost<=cost)break;a[i]=a[p];i=p;}a[i]={id,cost};}
  pop(){const a=this.a;const top=a[0],last=a.pop();if(a.length){let i=0;while(true){let c=i*2+1;if(c>=a.length)break;if(c+1<a.length&&a[c+1].cost<a[c].cost)c++;if(a[c].cost>=last.cost)break;a[i]=a[c];i=c;}a[i]=last;}return top;}
}
export function routeDesign(model,progress=()=>{}) {
  const pitch=16,W=Math.ceil(model.die.w/pitch)+1,H=Math.ceil(model.die.h/pitch)+1,N=W*H;
  const blocked=new Uint8Array(N);const macros=model.cells.filter(c=>c.kind==='macro');
  for(const m of macros)for(let y=Math.max(0,Math.floor((m.y-model.die.y-5)/pitch));y<=Math.min(H-1,Math.ceil((m.y+m.h-model.die.y+5)/pitch));y++)for(let x=Math.max(0,Math.floor((m.x-model.die.x-5)/pitch));x<=Math.min(W-1,Math.ceil((m.x+m.w-model.die.x+5)/pitch));x++)blocked[y*W+x]=1;
  const map=new Map(model.cells.map(c=>[c.id,c]));let failed=0,routed=0;
  const grid=p=>clamp(Math.round((p.y-model.die.y)/pitch),0,H-1)*W+clamp(Math.round((p.x-model.die.x)/pitch),0,W-1);
  const world=id=>({x:(id%W)*pitch+model.die.x,y:Math.floor(id/W)*pitch+model.die.y});
  function path(start,end){const s=grid(start),e=grid(end);const dist=new Float32Array(N);dist.fill(Infinity);const prev=new Int32Array(N);prev.fill(-1);const closed=new Uint8Array(N);const heap=new MinHeap();dist[s]=0;heap.push(s,0);let steps=0;
    while(heap.a.length&&steps++<N*2){const {id}=heap.pop();if(closed[id])continue;closed[id]=1;if(id===e){const out=[];for(let n=e;n!==-1;n=prev[n])out.push(world(n));return out.reverse();}const x=id%W,y=Math.floor(id/W);for(const n of [x>0?id-1:-1,x<W-1?id+1:-1,y>0?id-W:-1,y<H-1?id+W:-1]){if(n<0||closed[n]||(blocked[n]&&n!==e&&n!==s))continue;const d=dist[id]+1;if(d<dist[n]){dist[n]=d;prev[n]=id;heap.push(n,d+Math.abs(n%W-e%W)+Math.abs(Math.floor(n/W)-Math.floor(e/W)));}}}
    return null;
  }
  const nets=model.nets.map((n,ni)=>{const a=map.get(n.from);const segments=[];if(!a){failed++;return {...n,segments};}for(const id of n.to){const b=map.get(id);if(!b){failed++;continue;}const s={x:a.x+a.w,y:a.y+a.h/2},t={x:b.x,y:b.y+b.h/2};const points=path(s,t);if(!points){failed++;continue;}const pts=[s,{x:points[0].x,y:s.y},...points,{x:points.at(-1).x,y:t.y},t];const clean=[];for(const p of pts){const last=clean.at(-1),before=clean.at(-2);if(last&&last.x===p.x&&last.y===p.y)continue;if(before&&((before.x===last.x&&last.x===p.x)||(before.y===last.y&&last.y===p.y)))clean[clean.length-1]=p;else clean.push(p);}for(let i=1;i<clean.length;i++)segments.push({x1:clean[i-1].x,y1:clean[i-1].y,x2:clean[i].x,y2:clean[i].y,layer:clean[i-1].y===clean[i].y?'M1':'M2'});routed++;}if(ni%200===0)progress(ni/model.nets.length);return {...n,segments};});
  return {nets,routed,failed,algorithm:'bounded A* on a 16 µm grid; macro obstacles; no spacing/via signoff'};
}
export function analyzeTiming(model) {
  const cells=model.cells.filter(c=>c.kind==='cell'),map=new Map(cells.map(c=>[c.id,c])),indegree=new Map(cells.map(c=>[c.id,0])),out=new Map(),arrival=new Map(cells.map(c=>[c.id,0])),parent=new Map();
  for(const n of model.nets){if(!map.has(n.from))continue;for(const id of n.to){if(!map.has(id))continue;indegree.set(id,indegree.get(id)+1);if(!out.has(n.from))out.set(n.from,[]);const a=center(map.get(n.from)),b=center(map.get(id));const length=Math.abs(a.x-b.x)+Math.abs(a.y-b.y);out.get(n.from).push({id,delay:length*.000035+Math.max(0,n.to.length-1)*.003,net:n.id});}}
  const queue=cells.filter(c=>indegree.get(c.id)===0).map(c=>c.id);let head=0;
  while(head<queue.length){const id=queue[head++],c=map.get(id);const cellDelay=LIBRARY[c.type]?.delay??.04;const time=arrival.get(id)+cellDelay;arrival.set(id,time);for(const edge of out.get(id)||[]){if(time+edge.delay>arrival.get(edge.id)){arrival.set(edge.id,time+edge.delay);parent.set(edge.id,id);}indegree.set(edge.id,indegree.get(edge.id)-1);if(indegree.get(edge.id)===0)queue.push(edge.id);}}
  const cycles=cells.length-head;const endpoints=cells.filter(c=>!(out.get(c.id)?.length));const paths=endpoints.map(c=>{const ids=[];let id=c.id,seen=new Set();while(id&&!seen.has(id)){seen.add(id);ids.unshift(id);id=parent.get(id);}const delay=arrival.get(c.id)||0;return {endpoint:c.name,id:c.id,delay,slack:model.clock-delay,ids,startpoint:map.get(ids[0])?.name||'input'};}).sort((a,b)=>a.slack-b.slack);
  return {wns:paths.length?Math.min(...paths.map(p=>p.slack)):0,tns:paths.reduce((s,p)=>s+Math.min(0,p.slack),0),violations:paths.filter(p=>p.slack<0).length,paths:paths.slice(0,50),cycles,arrival:Object.fromEntries(arrival),clock:model.clock,model:'synthetic cell delay + Manhattan interconnect estimate (not STA signoff)'};
}
export function checkDesign(model) {
  const issues=[],index=new SpatialIndex(48),ids=new Set(model.cells.map(c=>c.id));index.rebuild(model.cells);const {die}=model;const seen=new Set();
  for(const c of model.cells){if(c.x<die.x||c.y<die.y||c.x+c.w>die.x+die.w||c.y+c.h>die.y+die.h)issues.push({severity:'error',rule:'BOUND.1',message:`${c.name} extends outside the die`,ids:[c.id],x:c.x,y:c.y});for(const b of index.query(c)){if(c.id===b.id)continue;const key=[c.id,b.id].sort().join('|');if(seen.has(key))continue;seen.add(key);issues.push({severity:'error',rule:'PLACE.1',message:`${c.name} overlaps ${b.name}`,ids:[c.id,b.id],x:Math.max(c.x,b.x),y:Math.max(c.y,b.y)});if(issues.length>=2000)return {issues,truncated:true};}}
  for(const n of model.nets){if(!ids.has(n.from)||n.to.some(id=>!ids.has(id)))issues.push({severity:'error',rule:'NET.1',message:`Dangling endpoint on ${n.name}`,ids:[]});if(!n.segments?.length)issues.push({severity:'warning',rule:'ROUTE.1',message:`${n.name} has no route`,ids:[n.from,...n.to]});if(n.width<.5)issues.push({severity:'warning',rule:'WIDTH.1',message:`${n.name} is narrower than the demo 0.5 µm rule`,ids:[n.from]});}
  return {issues,truncated:false,rules:['die containment','placement overlap','endpoint references','unrouted nets','demo minimum width'],model:'geometric checks only; no LVS, foundry DRC, antenna, or electrical signoff'};
}
export function designStats(model) { const std=model.cells.filter(c=>c.kind==='cell'),macros=model.cells.filter(c=>c.kind==='macro');const area=model.cells.reduce((s,c)=>s+c.w*c.h,0),coreArea=Math.max(1,(model.die.w-144)*(model.die.h-144));const wireLength=model.nets.reduce((s,n)=>s+(n.segments||[]).reduce((a,l)=>a+Math.abs(l.x2-l.x1)+Math.abs(l.y2-l.y1),0),0);return {cells:std.length,macros:macros.length,nets:model.nets.length,area,coreArea,utilization:area/coreArea,wireLength}; }
export function synthesizeInto(model,logic) {
  const out=clone(model);const removed=new Set(out.cells.filter(c=>c.logicId).map(c=>c.id));out.cells=out.cells.filter(c=>!removed.has(c.id));out.nets=out.nets.filter(n=>!removed.has(n.from)&&!n.to.some(i=>removed.has(i)));const idMap=new Map();let i=0;
  for(const g of logic.gates){const id=`logic:${g.id}`;idMap.set(g.id,id);out.cells.push({id,name:`u_control/${g.name}`,kind:'cell',type:g.type,ref:`${g.type}_X1`,logicId:g.id,x:430+(i%12)*30,y:365+Math.floor(i/12)*17,w:Math.min(28,LIBRARY[g.type]?.area||12),h:10,layer:'cells',fixed:false});i++;}
  for(const g of logic.gates)for(const from of g.inputs)if(idMap.has(from))out.nets.push({id:`logic-net:${from}:${g.id}`,name:`${from}_to_${g.id}`,from:idMap.get(from),to:[idMap.get(g.id)],width:.7,layer:'M1',segments:[]});
  out.logic=logic;out.hdl=logic.source;out.cells=legalize(out).cells;out.nets=quickRoute(out);out.revision++;return out;
}

// Untrusted project imports are normalized rather than merged onto live objects.
export function validateProject(data) {
  if(!data||data.schema!=='silicore/1')throw new Error('Not a Silicore v1 project');
  const finite=(v,name,min=-1e6,max=1e6)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new Error(`Invalid ${name}`);return v;};
  const text=(v,name,max=256)=>{if(typeof v!=='string'||v.length>max)throw new Error(`Invalid ${name}`);return v;};
  const box=(b)=>({x:finite(b?.x,'x'),y:finite(b?.y,'y'),w:finite(b?.w,'width',.001,10000),h:finite(b?.h,'height',.001,10000)});
  if(!Array.isArray(data.cells)||data.cells.length>30000||!Array.isArray(data.nets)||data.nets.length>60000)throw new Error('Project exceeds 30,000 cells or 60,000 nets');
  const ids=new Set();const cells=data.cells.map(c=>{const id=text(c.id,'cell ID');if(ids.has(id))throw new Error(`Duplicate cell ID ${id}`);ids.add(id);if(!['cell','macro'].includes(c.kind))throw new Error('Unknown cell kind');if(c.kind==='cell'&&!Object.hasOwn(LIBRARY,c.type))throw new Error(`Unknown cell type ${c.type}`);const result={id,name:text(c.name,'cell name'),...box(c),kind:c.kind,type:c.kind==='macro'?'MACRO':c.type,ref:text(c.ref||c.type,'reference'),fixed:!!c.fixed,layer:c.kind==='macro'?'macros':'cells'};for(const k of ['logicId','label','detail'])if(c[k]!==undefined)result[k]=text(c[k],k);if(/^#[0-9a-f]{6}$/i.test(c.color||''))result.color=c.color;return result;});
  let segmentCount=0;const netIds=new Set();const nets=data.nets.map(n=>{const id=text(n.id,'net ID');if(netIds.has(id))throw new Error(`Duplicate net ID ${id}`);netIds.add(id);if(!ids.has(n.from)||!Array.isArray(n.to)||n.to.length>512||n.to.some(id=>!ids.has(id)))throw new Error(`Dangling or invalid net ${id}`);if(!Array.isArray(n.segments)||n.segments.length>4096)throw new Error('Invalid route segments');segmentCount+=n.segments.length;if(segmentCount>1000000)throw new Error('Too many route segments');return {id,name:text(n.name,'net name'),from:n.from,to:[...n.to],width:finite(n.width,'wire width',.01,100),layer:['M1','M2','M3','M4'].includes(n.layer)?n.layer:'M1',segments:n.segments.map(s=>({x1:finite(s.x1,'route x'),y1:finite(s.y1,'route y'),x2:finite(s.x2,'route x'),y2:finite(s.y2,'route y'),layer:['M1','M2','M3','M4'].includes(s.layer)?s.layer:'M1'}))};});
  const hdl=text(data.hdl,'HDL',1000000);const logic=data.logic?validateLogic(data.logic):compileHDL(hdl);
  return {schema:'silicore/1',name:text(data.name,'project name'),technology:text(data.technology||'DEMO-45','technology'),units:'µm',die:box(data.die),cells,nets,logic,hdl,clock:finite(data.clock,'clock period',.001,10000),notes:[],revision:Math.max(0,Math.floor(data.revision||0))};
}
export function exportDEF(model) {
  const u=1000;const num=n=>Math.round(n*u);const safe=s=>s.replace(/[^\w/.:\[\]-]/g,'_');
  return `VERSION 5.8 ;\nDIVIDERCHAR "/" ;\nBUSBITCHARS "[]" ;\nDESIGN ${safe(model.name)} ;\nUNITS DISTANCE MICRONS ${u} ;\nDIEAREA ( ${num(model.die.x)} ${num(model.die.y)} ) ( ${num(model.die.x+model.die.w)} ${num(model.die.y+model.die.h)} ) ;\nCOMPONENTS ${model.cells.length} ;\n${model.cells.map(c=>`- ${safe(c.name)} ${safe(c.ref)} + ${c.fixed?'FIXED':'PLACED'} ( ${num(c.x)} ${num(c.y)} ) N ;`).join('\n')}\nEND COMPONENTS\nEND DESIGN\n`;
}
export function importDEFPlacement(text,model) {
  if(text.length>16e6)throw new Error('DEF file exceeds 16 MB');const u=Number(/UNITS\s+DISTANCE\s+MICRONS\s+(\d+)/i.exec(text)?.[1]||1000);if(!u)throw new Error('Invalid DEF units');const out=clone(model);const map=new Map(out.cells.map(c=>[c.name,c]));let count=0;
  const re=/-\s+(\S+)\s+(\S+)\s+\+\s+(PLACED|FIXED)\s*\(\s*(-?\d+)\s+(-?\d+)\s*\)\s+(\S+)\s*;/gi;let m;
  while((m=re.exec(text))){const c=map.get(m[1]);if(!c)continue;if(m[6]!=='N')throw new Error('Placement import currently supports N orientation only');c.x=Number(m[4])/u;c.y=Number(m[5])/u;c.fixed=m[3].toUpperCase()==='FIXED';count++;}
  if(!count)throw new Error('No matching component placements found (N orientation required)');out.nets=quickRoute(out);return {model:out,count};
}

/** Serialize editable gate graphs to the same supported, non-executable HDL subset. */
export function logicToHDL(logic) {
  const used=new Set([...logic.inputs,...logic.outputs].map(p=>p.name)), wireNames=new Map();
  for(const gate of logic.gates){const base=`n_${gate.id.replace(/[^\w]/g,'_')}`;let name=base,suffix=0;while(used.has(name))name=`${base}_${++suffix}`;used.add(name);wireNames.set(gate.id,name);}
  const wire = id => wireNames.get(id);
  const ref = id => id.startsWith('in:')?id.slice(3):id.startsWith('const:')?`${id.split(':')[1]}'d${id.split(':')[2]}`:wire(id);
  const expression=g=>{const a=g.inputs.map(ref);switch(g.type){case'BUF':return a[0];case'NOT':return `~${a[0]}`;case'LNOT':return `!${a[0]}`;case'NAND':return `~(${a[0]} & ${a[1]})`;case'NOR':return `~(${a[0]} | ${a[1]})`;case'MUX':return `${a[0]} ? ${a[1]} : ${a[2]}`;case'SLICE':return g.inputs[0].startsWith('const:')?`1'd${(Number(g.inputs[0].split(':')[2])>>>g.bit)&1}`:`${a[0]}[${g.bit}]`;default:return `${a[0]} ${{AND:'&',OR:'|',XOR:'^',ADD:'+',SUB:'-',EQ:'==',NE:'!=',LAND:'&&',LOR:'||'}[g.type]} ${a[1]}`;}};
  const width=p=>p.width>1?`[${p.width-1}:0] `:'';
  return `// Generated from the editable Silicore schematic.\nmodule ${logic.name} (\n${[...logic.inputs.map(p=>`    input wire ${width(p)}${p.name}`),...logic.outputs.map(p=>`    output wire ${width(p)}${p.name}`)].join(',\n')}\n);\n\n${logic.gates.map(g=>`    wire ${width(g)}${wire(g.id)};`).join('\n')}\n\n${logic.gates.map(g=>`    assign ${wire(g.id)} = ${expression(g)};`).join('\n')}\n\n${logic.outputs.map(p=>`    assign ${p.name} = ${ref(p.source)};`).join('\n')}\nendmodule\n`;
}
export function validateLogic(data) {
  if(!data||typeof data.name!=='string'||data.name.length>128||!/^[a-zA-Z_$][\w$]*$/.test(data.name))throw new Error('Invalid logic module name');
  if(!Array.isArray(data.inputs)||data.inputs.length>128||!Array.isArray(data.outputs)||data.outputs.length>128||!Array.isArray(data.gates)||data.gates.length>10000)throw new Error('Logic graph exceeds supported limits');
  const names=new Set(),ids=new Set();const width=w=>{if(!Number.isInteger(w)||w<1||w>32)throw new Error('Invalid logic width');return w;};const name=n=>{if(typeof n!=='string'||n.length>128||!/^[a-zA-Z_$][\w$]*$/.test(n)||names.has(n))throw new Error('Invalid or duplicate logic signal name');names.add(n);return n;};
  const inputs=data.inputs.map(p=>({name:name(p.name),width:width(p.width),direction:'input'}));for(const p of inputs)ids.add(`in:${p.name}`);
  const gates=data.gates.map(g=>{if(typeof g.id!=='string'||!/^g[\w-]*$/.test(g.id)||g.id.length>128||ids.has(g.id)||!Object.hasOwn(LIBRARY,g.type))throw new Error('Invalid or duplicate logic gate');ids.add(g.id);if(!Array.isArray(g.inputs)||g.inputs.length!==LIBRARY[g.type].arity||g.inputs.some(i=>typeof i!=='string'))throw new Error('Invalid gate arity');const out={id:g.id,name:typeof g.name==='string'?g.name.slice(0,128):g.id,type:g.type,inputs:[...g.inputs],width:width(g.width)};if(g.type==='SLICE'){if(!Number.isInteger(g.bit)||g.bit<0||g.bit>31)throw new Error('Invalid bit select');out.bit=g.bit;}if(typeof g.signal==='string')out.signal=g.signal.slice(0,128);return out;});
  const validRef=id=>{if(ids.has(id))return true;const m=/^const:([1-9]|[12]\d|3[0-2]):(\d{1,10})$/.exec(id);return !!m&&Number(m[2])<=(2**Number(m[1])-1);};
  if(gates.some(g=>g.inputs.some(i=>!validRef(i))))throw new Error('Unresolved logic connection');
  const outputs=data.outputs.map(p=>{if(!validRef(p.source))throw new Error('Undriven logic output');return {name:name(p.name),width:width(p.width),direction:'output',source:p.source};});
  const logic={name:data.name,inputs,gates,outputs,source:typeof data.source==='string'?data.source.slice(0,1000000):'',version:1,positions:{}};
  if(data.positions&&typeof data.positions==='object')for(const [id,p]of Object.entries(data.positions)){if(ids.has(id)&&p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<100000&&Math.abs(p.y)<100000)logic.positions[id]={x:p.x,y:p.y};}
  orderedGates(logic);return logic;
}
