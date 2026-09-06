import test from 'node:test';
import assert from 'node:assert/strict';
import { random, intersects, SpatialIndex, History, createDemo, compileHDL, tokenize, evaluateLogic, simulate, orderedGates, legalize, routeDesign, quickRoute, analyzeTiming, checkDesign, designStats, synthesizeInto, validateProject, validateLogic, logicToHDL, exportDEF, importDEFPlacement, DEFAULT_HDL } from '../src/core.js';
import { SceneBuilder, ViewCamera, buildLayoutScene } from '../src/renderer.js';
import { LAYERS } from '../src/core.js';
const moduleFor=(expression, ports='input wire a, input wire b, output wire y')=>compileHDL(`module test (${ports}); assign y = ${expression}; endmodule`);
const demo=createDemo();

test('deterministic reference design and fixture counts',()=>{assert.deepEqual(createDemo(),demo);assert.equal(designStats(demo).cells,1094);assert.equal(designStats(demo).macros,6);assert.equal(demo.nets.length,1093);});
test('reference fixture has no geometric violations',()=>assert.equal(checkDesign(demo).issues.length,0));
test('PRNG is deterministic and bounded',()=>{const a=random(19),b=random(19);for(let i=0;i<1000;i++){const x=a();assert.equal(x,b());assert.ok(x>=0&&x<1);}});
test('box intersection excludes boundary-only contact',()=>{const a={x:0,y:0,w:10,h:10};assert.equal(intersects(a,{x:10,y:0,w:1,h:1}),false);assert.equal(intersects(a,{x:9,y:9,w:1,h:1}),true);});
test('spatial index agrees with brute force for random queries',()=>{const index=new SpatialIndex(31);index.rebuild(demo.cells);const rnd=random(71);for(let i=0;i<100;i++){const box={x:rnd()*1400-60,y:rnd()*1000-50,w:80,h:80};const actual=index.query(box).map(c=>c.id).sort();const expected=demo.cells.filter(c=>intersects(c,box)).map(c=>c.id).sort();assert.deepEqual(actual,expected);}});
test('spatial point query prefers small shapes',()=>{const i=new SpatialIndex();i.rebuild([{id:'a',x:0,y:0,w:100,h:100},{id:'b',x:4,y:4,w:5,h:5}]);assert.equal(i.point(5,5)[0].id,'b');});
test('history rejects no-op transactions',()=>{const h=new History(),m={v:1};h.begin(m,'noop');assert.equal(h.commit(m),false);assert.equal(h.undo(m),null);});
test('history undo/redo is lossless and new edits discard redo',()=>{const h=new History(2);let m={v:1};h.begin(m,'edit');m.v=2;h.commit(m);m=h.undo(m).model;assert.equal(m.v,1);m=h.redo(m).model;assert.equal(m.v,2);m=h.undo(m).model;h.begin(m,'branch');m.v=3;h.commit(m);assert.equal(h.redo(m),null);});
test('tokenizer retains line and column locations',()=>{const ts=tokenize('// header\nmodule x');assert.equal(ts[0].line,2);assert.equal(ts[0].col,1);assert.equal(ts[1].value,'x');});
test('all 32 reference control-unit input combinations are correct',()=>{const logic=compileHDL(DEFAULT_HDL);for(let i=0;i<32;i++){const req=i&1,ready=(i>>1)&1,enable=(i>>2)&1,reset_n=(i>>3)&1,mode=(i>>4)&1;const result=evaluateLogic(logic,{req,ready,enable,reset_n,mode}).outputs;assert.deepEqual(result,{grant:req&ready&enable,busy:req&!ready,valid:req&ready&enable&reset_n,parity:req^ready^mode,selected:mode?req:ready});}});
for(const [op,expected]of [['&',(a,b)=>a&b],['|',(a,b)=>a|b],['^',(a,b)=>a^b],['&&',(a,b)=>+(!!a&&!!b)],['||',(a,b)=>+(!!a||!!b)],['==',(a,b)=>+(a===b)],['!=',(a,b)=>+(a!==b)]])test(`operator ${op} truth table`,()=>{const l=moduleFor(`a ${op} b`);for(let a=0;a<2;a++)for(let b=0;b<2;b++)assert.equal(evaluateLogic(l,{a,b}).outputs.y,expected(a,b));});
test('bitwise precedence is respected',()=>{const l=moduleFor('a | b & c','input a, input b, input c, output y');assert.equal(evaluateLogic(l,{a:1,b:0,c:0}).outputs.y,1);});
test('vector arithmetic wraps to the assigned output width',()=>{const l=moduleFor("a + 8'd1",'input wire [7:0] a, output wire [7:0] y');assert.equal(evaluateLogic(l,{a:255}).outputs.y,0);assert.equal(evaluateLogic(l,{a:9}).outputs.y,10);});
test('32-bit arithmetic remains unsigned',()=>{const l=moduleFor("a + 32'd1",'input wire [31:0] a, output wire [31:0] y');assert.equal(evaluateLogic(l,{a:4294967295}).outputs.y,0);});
test('subtraction is truncated to destination width',()=>{const l=moduleFor("a - 8'd1",'input wire [7:0] a, output wire [7:0] y');assert.equal(evaluateLogic(l,{a:0}).outputs.y,255);});
test('constant bit selection works',()=>{const l=moduleFor('a[3]','input wire [7:0] a, output wire y');assert.equal(evaluateLogic(l,{a:8}).outputs.y,1);assert.equal(evaluateLogic(l,{a:4}).outputs.y,0);});
test('logical negation is distinct from bitwise negation',()=>{const a=moduleFor('~a','input wire [7:0] a, output wire [7:0] y');const b=moduleFor('!a','input wire [7:0] a, output wire y');assert.equal(evaluateLogic(a,{a:1}).outputs.y,254);assert.equal(evaluateLogic(b,{a:2}).outputs.y,0);});
test('forward continuous assignments are resolved',()=>{const l=compileHDL('module m(input a, output y); wire x; assign y=x; assign x=~a; endmodule');assert.equal(evaluateLogic(l,{a:0}).outputs.y,1);});
test('cycles are rejected at elaboration',()=>assert.throws(()=>compileHDL('module m(input a,output y); wire z; assign y=z; assign z=y; endmodule'),/cycle/));
test('unsupported sequential syntax is rejected, not skipped',()=>assert.throws(()=>compileHDL('module m(input a,output y); always @(posedge a) y=1; endmodule'),/Unexpected|Unsupported/));
test('multiple drivers and undriven outputs are rejected',()=>{assert.throws(()=>compileHDL('module m(input a,output y);assign y=a;assign y=~a;endmodule'),/Multiple/);assert.throws(()=>compileHDL('module m(input a,output y);endmodule'),/no driver/);});
test('invalid bases, X/Z, signed and excessive-width literals are rejected',()=>{for(const expr of ["2'b29","1'bx","8'shff","64'h01"])assert.throws(()=>moduleFor(expr));});
test('invalid bit indexes are rejected',()=>assert.throws(()=>moduleFor('a[8]','input wire [7:0] a,output y'),/out of range/));
test('simulation samples match independently evaluated input patterns',()=>{const l=compileHDL(DEFAULT_HDL),sim=simulate(l,64);for(let t=0;t<64;t++){const inputs=Object.fromEntries(sim.signals.filter(s=>s.kind==='input').map(s=>[s.name,s.values[t]]));const expected=evaluateLogic(l,inputs).outputs;for(const signal of sim.signals.filter(s=>s.kind==='output'))assert.equal(signal.values[t],expected[signal.name]);}});
test('simulation overrides and bounded sample count',()=>{const l=moduleFor('a & b'),s=simulate(l,2000,{a:1,b:1});assert.equal(s.cycles,1024);assert.ok(s.signals.find(s=>s.name==='y').values.every(v=>v===1));});
test('editable graph serialization preserves functional behavior',()=>{const graph=compileHDL(DEFAULT_HDL),roundtrip=compileHDL(logicToHDL(graph));for(let i=0;i<32;i++){const values=Object.fromEntries(graph.inputs.map((p,j)=>[p.name,(i>>j)&1]));assert.deepEqual(evaluateLogic(roundtrip,values).outputs,evaluateLogic(graph,values).outputs);}});
test('graph validation rejects bad arity and cycles',()=>{const l=compileHDL(DEFAULT_HDL);let a=structuredClone(l);a.gates[0].inputs=[];assert.throws(()=>validateLogic(a),/arity/);a=structuredClone(l);a.gates[0].inputs[0]=a.gates[0].id;assert.throws(()=>validateLogic(a),/cycle/);});
test('row legalization preserves fixed macros and eliminates cell overlap',()=>{const altered=structuredClone(demo);altered.cells.find(c=>c.kind==='cell').x=101;altered.cells.find(c=>c.kind==='cell').y=114;const placed=legalize(altered);assert.equal(placed.failed,0);const result={...altered,cells:placed.cells};assert.equal(checkDesign(result).issues.filter(i=>i.rule==='PLACE.1').length,0);assert.deepEqual(result.cells.filter(c=>c.fixed),demo.cells.filter(c=>c.fixed));});
test('A* router emits orthogonal segments and routes around a macro',()=>{const m={die:{x:0,y:0,w:256,h:192},cells:[{id:'a',kind:'cell',x:20,y:87,w:12,h:10},{id:'b',kind:'cell',x:206,y:87,w:12,h:10},{id:'m',kind:'macro',x:96,y:48,w:48,h:96}],nets:[{id:'n',from:'a',to:['b'],width:1,layer:'M1'}]};const r=routeDesign(m);assert.equal(r.failed,0);assert.ok(r.nets[0].segments.length>3);for(const s of r.nets[0].segments){assert.ok(s.x1===s.x2||s.y1===s.y2);const box={x:Math.min(s.x1,s.x2),y:Math.min(s.y1,s.y2),w:Math.max(.001,Math.abs(s.x1-s.x2)),h:Math.max(.001,Math.abs(s.y1-s.y2))};assert.equal(intersects(box,m.cells[2]),false);}});
test('timing is deterministic and reacts monotonically to clock constraints',()=>{const t=analyzeTiming(demo),t2=analyzeTiming({...demo,clock:demo.clock+1});assert.ok(Math.abs(t2.wns-t.wns-1)<1e-9);assert.ok(t.paths.length>0);assert.equal(t.cycles,0);assert.ok(t.paths[0].ids.length>1);});
test('geometry checks identify overlaps, dangling endpoints, width and bounds',()=>{const m=structuredClone(demo);m.cells[0].x=-1;m.cells[1].x=m.cells[2].x;m.cells[1].y=m.cells[2].y;m.nets[0].from='absent';m.nets[1].width=.1;const rules=new Set(checkDesign(m).issues.map(i=>i.rule));for(const r of ['PLACE.1','BOUND.1','NET.1','WIDTH.1'])assert.ok(rules.has(r),r);});
test('project JSON roundtrip preserves explicit logic and placements',()=>{const parsed=validateProject(JSON.parse(JSON.stringify(demo)));assert.equal(parsed.cells.length,demo.cells.length);assert.equal(parsed.logic.gates.length,demo.logic.gates.length);assert.deepEqual(parsed.nets,demo.nets);assert.deepEqual(evaluateLogic(parsed.logic,{req:1,ready:1,enable:1,reset_n:1,mode:0}).outputs,evaluateLogic(demo.logic,{req:1,ready:1,enable:1,reset_n:1,mode:0}).outputs);});
test('import boundary rejects duplicates, nonfinite values and dangling nets',()=>{for(const edit of [m=>{m.cells[1].id=m.cells[0].id;},m=>{m.cells[0].x=NaN;},m=>{m.nets[0].to=['missing'];}]){const m=structuredClone(demo);edit(m);assert.throws(()=>validateProject(m));}});
test('synthesis updates only mapped control block and maintains valid placement',()=>{const logic=moduleFor('a ^ b'),m=synthesizeInto(demo,logic);assert.equal(m.cells.filter(c=>c.logicId).length,logic.gates.length);assert.equal(m.cells.filter(c=>c.kind==='macro').length,6);assert.equal(checkDesign(m).issues.filter(i=>i.rule==='PLACE.1').length,0);assert.equal(evaluateLogic(m.logic,{a:1,b:0}).outputs.y,1);});
test('DEF placement export/import roundtrip',()=>{const text=exportDEF(demo),r=importDEFPlacement(text,demo);assert.equal(r.count,demo.cells.length);for(let i=0;i<demo.cells.length;i++){assert.equal(r.model.cells[i].x,demo.cells[i].x);assert.equal(r.model.cells[i].y,demo.cells[i].y);}});
test('DEF importer rejects unsupported orientation',()=>assert.throws(()=>importDEFPlacement(exportDEF(demo).replace(') N ;',') S ;'),demo),/orientation/));
test('camera anchored zoom preserves the world point under the pointer',()=>{const c=new ViewCamera();c.x=10;c.y=20;const p=c.screenToWorld(237,142);c.zoomAt(237,142,2.3);const q=c.screenToWorld(237,142);assert.ok(Math.abs(p.x-q.x)<1e-10);assert.ok(Math.abs(p.y-q.y)<1e-10);});
test('camera fit centers the bounding box',()=>{const c=new ViewCamera();c.width=1000;c.height=700;c.fit({x:30,y:40,w:600,h:300},50);const p=c.worldToScreen(330,190);assert.ok(Math.abs(p.x-500)<1e-8);assert.ok(Math.abs(p.y-350)<1e-8);});
test('scene instances pack into a 32-byte aligned vertex record',()=>{const s=new SceneBuilder();s.rect(1,2,3,4,'#ff0000',.5);const t=s.typed();assert.equal(t.byteLength,32);assert.deepEqual([...t],[1,2,3,4,1,0,0,.5]);});
test('display layers genuinely change submitted geometry',()=>{const full=buildLayoutScene(demo,LAYERS);const muted=buildLayoutScene(demo,LAYERS.map(l=>({...l,visible:false})));assert.ok(full.items.length>muted.items.length+5000);});

test('large spatial objects and queries use bounded allocation fallbacks', () => {
  const index = new SpatialIndex(1, 32);
  const huge = { id:'huge', x:-10000, y:-10000, w:20000, h:20000 };
  const small = { id:'small', x:3, y:3, w:2, h:2 };
  index.rebuild([huge, small]);
  assert.equal(index.large.length, 1);
  assert.ok(index.buckets.size <= 32);
  assert.deepEqual(index.query({x:3,y:3,w:1,h:1}).map(x=>x.id).sort(), ['huge','small']);
  assert.equal(index.query({x:-1e6,y:-1e6,w:2e6,h:2e6}).length, 2);
});
test('invalid spatial bucket dimensions are rejected', () => {
  for(const size of [0,-1,Infinity,NaN])assert.throws(()=>new SpatialIndex(size), RangeError);
});
test('deep logic graphs use iterative topological traversal', () => {
  const gates=Array.from({length:10000},(_,i)=>({id:`g${i}`,type:'BUF',width:1,inputs:[i?`g${i-1}`:'in:a']}));
  const logic={name:'deep',inputs:[{name:'a',width:1}],outputs:[{name:'y',width:1,source:'g9999'}],gates};
  assert.equal(orderedGates(logic).length,10000);
  assert.equal(evaluateLogic(logic,{a:1}).outputs.y,1);
});
test('editable graph output ports truncate to their declared width', () => {
  const logic={name:'slice_output',inputs:[{name:'a',width:8}],outputs:[{name:'y',width:1,source:'in:a'}],gates:[]};
  assert.equal(evaluateLogic(logic,{a:254}).outputs.y,0);
  assert.equal(evaluateLogic(logic,{a:255}).outputs.y,1);
});
test('HDL serialization allocates collision-free internal wire names', () => {
  const logic={name:'names',inputs:[{name:'n_g1',width:1}],outputs:[{name:'y',width:1,source:'g_a'}],gates:[
    {id:'g1',name:'a',type:'NOT',width:1,inputs:['in:n_g1']},
    {id:'g-a',name:'b',type:'BUF',width:1,inputs:['g1']},
    {id:'g_a',name:'c',type:'BUF',width:1,inputs:['g-a']},
  ]};
  const roundtrip=compileHDL(logicToHDL(logic));
  for(let value=0;value<2;value++)assert.deepEqual(evaluateLogic(roundtrip,{n_g1:value}).outputs,evaluateLogic(logic,{n_g1:value}).outputs);
});
test('constant-connected bit selections serialize to supported HDL', () => {
  const logic={name:'constant_slice',inputs:[],outputs:[{name:'y',width:1,source:'g1'}],gates:[{id:'g1',name:'slice',type:'SLICE',bit:3,width:1,inputs:['const:8:8']}]};
  assert.equal(evaluateLogic(compileHDL(logicToHDL(logic))).outputs.y,1);
});
test('constants outside declared graph widths are rejected', () => {
  const logic={name:'bad_constant',inputs:[],outputs:[{name:'y',width:1,source:'const:1:2'}],gates:[]};
  assert.throws(()=>validateLogic(logic),/Undriven/);
});
test('inherited object property names are not accepted as gate types', () => {
  const copy=structuredClone(demo);copy.cells.find(c=>c.kind==='cell').type='__proto__';
  assert.throws(()=>validateProject(copy),/Unknown cell type/);
  const logic=structuredClone(demo.logic);logic.gates[0].type='constructor';
  assert.throws(()=>validateLogic(logic),/Invalid/);
});
