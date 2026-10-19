import {describe,expect,it} from 'vitest';
import type {Build,Placed} from './bricks';
import {attachPart,connectionPairs,frame,requiredContactIssues} from './connections';
import {constructionIssues} from './construction';
import {planBuildInstructions} from './instruction-order';

const p=(partId:string,x=0,y=0,z=0,rot=0):Placed=>({partId,x,y,z,rot});
const model=(parts:Placed[]):Build=>({name:'Sequence fixture',description:'Literal geometry, not craft evidence.',engine:'connections-v2',source:{kind:'discovery',recipeId:'sequence-fixture'},steps:parts.map((p,i)=>({caption:`Original part ${i+1}`,parts:[p]}))});
const flat=(b:Build)=>b.steps.flatMap(s=>s.parts);
const stock=(b:Build)=>{const out:Record<string,number>={};for(const p of flat(b))out[p.partId]=(out[p.partId]??0)+1;return out;};
const poseKeys=(b:Build)=>flat(b).map(p=>JSON.stringify([p.partId,p.x,p.y,p.z,p.rot,p.orientation??null])).sort();
function assertUnchangedGeometry(a:Build,b:Build){
 expect(poseKeys(b)).toEqual(poseKeys(a));expect(stock(b)).toEqual(stock(a));expect(b.name).toBe(a.name);expect(b.description).toBe(a.description);expect(b.source).toEqual(a.source);
 expect(constructionIssues(b,stock(a),24)).toEqual([]);
}
/** Count parts added under an already placed downward-facing grip. Internal
 * mates within a separately preassembled step are not main-model insertions. */
function lateUnderside(b:Build){
 let count=0;const earlier:ReturnType<typeof frame>[]=[];
 for(const step of b.steps){
  const current=step.parts.map(frame);
  for(const f of current)if(earlier.some(e=>connectionPairs(f,e).some(([own,parent])=>f.ports.find(p=>p.id===own)!.kind==='stud'&&e.ports.find(p=>p.id===parent)!.normal[2]<-.5)))count++;
  earlier.push(...current);
 }
 return count;
}
function assertPrefix(b:Build){
 const frames=flat(b).map(frame);
 frames.forEach((f,i)=>expect(Math.abs(f.bounds.min[2])<1e-5||frames.slice(0,i).some(g=>connectionPairs(f,g).length>0)).toBe(true));
}
function hangingSnot(){
 const support=p('brick-1x1-red',2,2),cover=attachPart(support,'stud:0:0','plate-1x2-white','grip:0:0');
 const hanging=attachPart(cover,'grip:1:0','sidebrick-1x1-blue','side:0');
 return model([support,cover,hanging]);
}

describe('literal native instruction ordering',()=>{
 it('places a late foundation before its already-listed cover',()=>{
  const b=model([p('plate-1x1-red'),p('plate-1x2-white',0,0,1),p('plate-1x1-blue',1)]);
  expect(constructionIssues(b,stock(b),24)).toEqual([]);expect(lateUnderside(b)).toBe(1);
  const out=planBuildInstructions(b);
  expect(flat(out.build).map(p=>p.partId)).toEqual(['plate-1x1-red','plate-1x1-blue','plate-1x2-white']);
  expect(lateUnderside(out.build)).toBe(0);expect(out.reorderedParts).toBe(2);expect(out.subassemblies).toBe(0);assertUnchangedGeometry(b,out.build);assertPrefix(out.build);
 });

 it('lays out every grounded root before a higher bridge, allowing temporarily separate table pieces',()=>{
  const b=model([p('plate-1x1-red',0),p('plate-1x3-white',0,0,1),p('plate-1x1-blue',2)]),out=planBuildInstructions(b);
  expect(out.build.steps.slice(0,2).every(s=>s.caption.includes('on the table'))).toBe(true);
  expect(out.build.steps[2].parts[0].partId).toBe('plate-1x3-white');expect(out.subassemblies).toBe(0);
  assertUnchangedGeometry(b,out.build);assertPrefix(out.build);
 });

 it('corrects order-only prefix failures while preserving the unchanged complete contact graph',()=>{
  const b=model([p('tile-1x1-red',0,0,1),p('plate-1x1-white')]);
  expect(constructionIssues(b,stock(b),24).map(i=>i.message)).toEqual(['Part 1 has no mating connector on an earlier piece.']);
  const out=planBuildInstructions(b);expect(flat(out.build)[0].partId).toBe('plate-1x1-white');assertUnchangedGeometry(b,out.build);
 });

 it('prefers a same-height interior part before outer detail once both have actual earlier mates',()=>{
  const b=model([p('plate-4x4-black'),p('brick-1x1-red'),p('brick-1x1-blue',1,1)]);
  // Raise only the two brick details onto the base, preserving their footprints.
  b.steps[1].parts[0].z=1;b.steps[2].parts[0].z=1;
  const out=planBuildInstructions(b);expect(flat(out.build).map(p=>p.partId)).toEqual(['plate-4x4-black','brick-1x1-blue','brick-1x1-red']);assertUnchangedGeometry(b,out.build);
 });

 it('preassembles a genuinely hanging SNOT section, with an actionable independent lower-first contact sequence',()=>{
  const b=hangingSnot(),before=structuredClone(b),out=planBuildInstructions(b);
  expect(frame(flat(b)[2]).bounds.min[2]).toBeGreaterThan(0);expect(lateUnderside(b)).toBe(1);
  expect(out.subassemblies).toBe(1);expect(out.build.steps.map(s=>s.parts.length)).toEqual([1,2]);expect(lateUnderside(out.build)).toBe(0);
  const section=out.build.steps[1];
  expect(connectionPairs(frame(section.parts[0]),frame(section.parts[1]))).toContainEqual(['grip:1:0','side:0']);
  expect(section.caption).toContain('1) Start with sidebrick-1x1-blue.');
  expect(section.caption).toContain('2) Attach plate-1x2-white using grip:1:0 to section piece 1 at side:0.');
  expect(section.caption).toContain('Then attach section piece 2 (plate-1x2-white, grip:0:0) to main-model part 1 (brick-1x1-red) at stud:0:0.');
  expect(out.notices.join(' ')).toContain('moving clearance');expect(out.notices.join(' ')).toContain('not simulated');
  assertUnchangedGeometry(b,out.build);assertPrefix(out.build);expect(b).toEqual(before);
 });

 it('preserves proper non-upright orientation matrices and fractional source poses exactly',()=>{
  const b=hangingSnot(),out=planBuildInstructions(b),original=flat(b)[2];
  expect(original.orientation).toBeDefined();expect(original.y).toBe(1.8);expect(original.z).toBe(.5);
  expect(flat(out.build)[2]).toEqual(original);expect(flat(out.build)[2]).not.toBe(original);expect(flat(out.build)[2].orientation).not.toBe(original.orientation);
  assertUnchangedGeometry(b,out.build);
 });

 it('remaps both endpoints of exact required-contact contracts after reordering',()=>{
  const b=model([p('plate-1x1-red'),p('plate-1x3-white',0,0,1),p('plate-1x1-blue',2)]);
  b.requiredContacts=[{a:2,b:1,aPort:'stud:0:0',bPort:'grip:2:0'},{a:1,b:0,aPort:'grip:0:0',bPort:'stud:0:0'}];
  const before=structuredClone(b.requiredContacts),out=planBuildInstructions(b);
  expect(out.build.requiredContacts).toEqual([{a:1,b:2,aPort:'stud:0:0',bPort:'grip:2:0'},{a:2,b:0,aPort:'grip:0:0',bPort:'stud:0:0'}]);
  expect(requiredContactIssues(flat(out.build),out.build.requiredContacts)).toEqual([]);expect(b.requiredContacts).toEqual(before);assertUnchangedGeometry(b,out.build);
 });

 it('remaps closure contracts across grouped native parts as well as singleton steps',()=>{
  const b=hangingSnot();b.requiredContacts=[{a:2,b:1,aPort:'side:0',bPort:'grip:1:0'}];
  const out=planBuildInstructions(b);expect(out.subassemblies).toBe(1);expect(out.build.requiredContacts).toEqual(b.requiredContacts);
  expect(requiredContactIssues(flat(out.build),out.build.requiredContacts)).toEqual([]);assertPrefix(out.build);
 });

 it('never uses grouping to hide disconnected, colliding, below-ground or missing-closure geometry',()=>{
  const disconnected=model([p('plate-1x1-red'),p('plate-1x1-blue',3)]),overlap=model([p('plate-1x1-red'),p('plate-1x1-blue')]),below=model([p('plate-1x1-red',0,0,-1)]),missing=hangingSnot();
  missing.requiredContacts=[{a:0,b:2,aPort:'stud:0:0',bPort:'grip:0:0'}];
  for(const b of [disconnected,overlap,below,missing]){const out=planBuildInstructions(b);expect(out.build).toEqual(b);expect(out.subassemblies).toBe(0);expect(out.reorderedParts).toBe(0);expect(out.notices.join(' ')).toContain('invalid');}
 });

 it('fails closed on malformed/native unsupported poses and oversized models',()=>{
  const invalid=[model([p('wheel-1x1-black')]),model([{...p('brick-1x1-red'),orientation:[2,0,0,0,1,0,0,0,1]}]),model([p('plate-1x1-red',NaN)]),model(Array.from({length:81},(_,z)=>p('plate-1x1-red',0,0,z)))];
  for(const b of invalid){const out=planBuildInstructions(b);expect(out.build).toEqual(b);expect(out.subassemblies).toBe(0);expect(out.notices.length).toBeGreaterThan(0);}
  const empty=model([]);expect(planBuildInstructions(empty).build).toEqual(empty);
  const legacy={...model([p('plate-1x1-red')]),engine:undefined};expect(planBuildInstructions(legacy).notices.join(' ')).toContain('native connection');
 });

 it('rejects malformed placement/step arrays and over-budget closure contracts before graph planning',()=>{
  const malformed=[{...model([]),steps:null},{...model([]),steps:[{caption:'Bad',parts:null}]},{...model([]),steps:[{caption:'Bad',parts:[null]}]},null] as unknown as Build[];
  for(const b of malformed){const out=planBuildInstructions(b);expect(out.build).toEqual(b);expect(out.reorderedParts).toBe(0);expect(out.notices.join(' ')).toContain('Malformed');}
  const b=hangingSnot();b.requiredContacts=Array.from({length:161},()=>({a:1,b:2,aPort:'grip:1:0',bPort:'side:0'}));
  expect(planBuildInstructions(b).notices.join(' ')).toContain('required connection contract');
 });

 it('bounds native work and actual axis extents without widening any geometry tolerance',()=>{
  const tall=model(Array.from({length:61},(_,z)=>p('plate-1x1-red',0,0,z)));expect(planBuildInstructions(tall).notices.join(' ')).toContain('24-stud');
  const costly=model(Array.from({length:33},(_,z)=>p('plate-8x8-red',0,0,z)));expect(planBuildInstructions(costly).notices.join(' ')).toContain('budget');
  const outside=model([p('plate-1x1-red',24)]);expect(planBuildInstructions(outside).notices.join(' ')).toContain('invalid');
 });

 it('reports an unresolved large hanging section instead of inventing a disconnected or oversized preassembly',()=>{
  const support=p('brick-1x1-red',2,2),cover=attachPart(support,'stud:0:0','plate-1x10-white','grip:0:0');
  const hanging=Array.from({length:9},(_,i)=>attachPart(cover,`grip:${i+1}:0`,'plate-1x1-blue','stud:0:0'));
  const b=model([support,cover,...hanging]);expect(constructionIssues(b,stock(b),24)).toEqual([]);
  const out=planBuildInstructions(b);expect(out.build).toEqual(b);expect(out.subassemblies).toBe(0);expect(out.notices.join(' ')).toContain('at most eight');
 });

 it('is deterministic, idempotent and safe for deeply frozen source geometry and metadata',()=>{
  const b=hangingSnot(),before=JSON.stringify(b);
  function freeze(v:unknown){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}}
  freeze(b);const first=planBuildInstructions(b),second=planBuildInstructions(b),again=planBuildInstructions(first.build);
  expect(first).toEqual(second);expect(again.build).toEqual(first.build);expect(again.reorderedParts).toBe(0);expect(JSON.stringify(b)).toBe(before);
  first.build.source!.recipeId='Changed';expect(b.source!.recipeId).toBe('sequence-fixture');
 });

 it('replans the exact recovered 75-piece Airboat from 21 late underside mates to zero, without subassemblies or stock changes',()=>{
  const b:Build={name:'Airboat',description:'Exact recovered Airboat pose fixture',engine:'connections-v2',source:{kind:'discovery',recipeId:'whole-model:editable'},steps:AIRBOAT.map(([partId,x,y,z,rot])=>({caption:'Original native contact order',parts:[p(partId,x,y,z,rot)]}))};
  const before=JSON.stringify(b),out=planBuildInstructions(b);
  expect(flat(b)).toHaveLength(75);expect(lateUnderside(b)).toBe(21);expect(lateUnderside(out.build)).toBe(0);
  expect(out.reorderedParts).toBe(73);expect(out.subassemblies).toBe(0);expect(out.build.steps).toHaveLength(75);
  const reported=flat(b)[25],foundation=out.build.steps.findIndex(s=>s.parts.some(p=>JSON.stringify(p)===JSON.stringify(reported)));
  const oldCover=flat(b)[23],cover=out.build.steps.findIndex(s=>s.parts.some(p=>JSON.stringify(p)===JSON.stringify(oldCover)));
  expect(foundation).toBeLessThan(cover);assertUnchangedGeometry(b,out.build);assertPrefix(out.build);expect(JSON.stringify(b)).toBe(before);
 },15000);
});

// Exact literal poses copied from the frozen local recovered-airboat.json,
// shapeRuns.pile.slots[0].build. No authored or provider geometry is introduced.
const AIRBOAT:[string,number,number,number,number][]=[
["plate-4x12-dark-gray",10,5,0,90],
["plate-6x8-medium-nougat",9,9,1,90],
["plate-1x8-reddish-brown",9,9,0,90],
["plate-1x8-reddish-brown",14,9,0,90],
["plate-6x6-dark-orange",9,11,2,0],
["brick-2x2-light-gray",11,11,3,0],
["plate-2x4-azure",10,11,6,0],
["plate-1x6-bright-light-orange",9,15,3,0],
["plate-1x6-yellow",9,16,3,0],
["invslope-1x2-light-gray",10,11,3,0],
["invslope-1x2-light-gray",13,11,3,0],
["plate-1x2-black",10,11,7,90],
["plate-1x2-black",13,11,7,90],
["tile-1x2-dark-azure",13,11,8,90],
["tile-1x2-yellow",11,11,7,0],
["tile-1x2-dark-azure",10,11,8,90],
["plate-2x6-dark-blue",9,9,2,0],
["tile-2x4-dark-orange",10,8,3,0],
["tile-1x4-azure",10,10,3,0],
["slope-1x2-dark-azure",10,4,1,0],
["slope-1x2-dark-azure",13,4,1,0],
["plate-1x3-yellow",14,10,3,90],
["plate-2x3-medium-blue",9,7,2,0],
["tile-2x4-azure",10,6,3,0],
["plate-1x6-medium-blue",9,6,2,0],
["plate-2x3-medium-blue",12,7,2,0],
["plate-2x2-azure",9,7,1,0],
["plate-2x4-azure",11,7,1,0],
["plate-1x1-dark-azure",9,6,1,0],
["plate-1x1-dark-azure",14,6,1,0],
["slope-2x2-dark-azure",11,4,1,0],
["curve-1x2-azure",9,5,3,180],
["slope-1x2-dark-azure",9,4,1,0],
["curve-1x2-azure",14,5,3,180],
["slope-1x2-dark-azure",14,4,1,0],
["brick-1x2-dark-azure",11,12,7,0],
["tile-1x2-white",11,12,10,0],
["roundendplate-1x2-reddish-brown",9,5,0,90],
["roundendplate-1x2-reddish-brown",9,7,0,90],
["plate-1x3-reddish-brown",14,5,0,90],
["plate-1x1-reddish-brown",14,8,0,0],
["plate-1x6-bright-light-orange",9,14,3,0],
["jumper-1x2-medium-blue",11,14,4,0],
["jumper-1x2-medium-blue",11,15,4,0],
["plate-1x2-bright-light-orange",11.5,14,5,90],
["plate-1x2-bright-light-orange",11.5,14,6,90],
["plate-1x2-bright-light-orange",11.5,14,7,90],
["plate-1x3-yellow",10.5,14,8,0],
["plate-1x2-bright-light-orange",11.5,14,9,90],
["plate-1x2-bright-light-orange",11.5,14,10,90],
["tile-1x2-bright-light-orange",11.5,14,11,90],
["plate-1x2-bright-light-orange",11,16,4,0],
["plate-1x4-yellow",9,10,3,90],
["plate-1x3-yellow",12,13,3,0],
["tile-1x2-dark-azure",10,13,3,0],
["plate-1x3-red",10.5,15,8,0],
["slope-2x2-dark-orange",9,14,4,90],
["roundbrick-1x1-tan",9,16,4,0],
["brick-1x3-yellow",9,14,7,90],
["plate-1x2-red",9,14,10,90],
["plate-1x1-bright-light-orange",9,14,11,0],
["plate-1x1-dark-green",9,14,12,0],
["plate-1x6-bright-light-orange",9,14,13,0],
["plate-1x1-dark-green",14,14,12,0],
["plate-1x1-bright-light-orange",14,14,11,0],
["plate-1x4-bright-light-orange",10,14,14,0],
["tile-1x2-bright-light-orange",11,14,15,0],
["curve-1x2-red",9,14,14,270],
["curve-1x2-red",13,14,14,90],
["curve-1x2-red",9,15,10,180],
["slope-2x2-dark-orange",13,14,4,270],
["roundbrick-1x1-tan",14,16,4,0],
["brick-1x3-yellow",14,14,7,90],
["plate-1x2-red",14,14,10,90],
["curve-1x2-red",14,15,10,180],
];
