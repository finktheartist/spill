import {describe,it,expect} from 'vitest';
import {POPULAR_MOLDS,popularMold} from './popular-molds';
import {parsePartId,heightOf,footprint,validate,type Placed,type Build} from './bricks';
import {madeIn,nativeKindForCatalog,partInfo} from './catalog';
import {definition,attachPart,frame,connectionPairs,connectionOnly} from './connections';
import {constructionIssues} from './construction';
import {createBench,editBench,finishBench} from './whole-model-workbench';
import {catalogContract} from './whole-model-catalog';
import {planBuildInstructions} from './instruction-order';
import {addPart,emptyInventory,counts,needsReviewCount,type OtherEntry} from './inventory';
import {readInventorySnapshot} from './inventory-snapshot';
import {scanKindIssue} from './gemini';
import {checkFeatures} from './identify';
import {tagsForCatalogPart} from './part-tags';
import type {PopularMold} from './popular-mold-types';
const idOf=(s:PopularMold)=>`${s.type}-${s.w}x${s.d}-${madeIn(`${s.type}-${s.w}x${s.d}`)![0]}`;
const place=(partId:string,z=0):Placed=>({partId,x:8,y:8,z,rot:0});
const stock=(ps:Placed[])=>ps.reduce<Record<string,number>>((s,p)=>(s[p.partId]=(s[p.partId]??0)+1,s),{});
const build=(ps:Placed[]):Build=>({engine:'connections-v2',name:'Contact fixture',description:'Geometry verification only',steps:ps.map(p=>({caption:'Attach to its real connector.',parts:[p]}))});
const normalize=(ps:Placed[])=>{const x=Math.min(...ps.map(p=>p.x)),y=Math.min(...ps.map(p=>p.y));return ps.map(p=>({...p,x:p.x-x+2,y:p.y-y+2}));};
function supported(m:PopularMold,avoid?:string){
 const id=idOf(m),base=place('brick-1x1-white'),carrier=place(base.partId,3),def=definition(parsePartId(id)!);
 const grip=def.ports.find(p=>p.kind==='grip'&&p.normal[2]===-1);
 if(grip){const root=attachPart(carrier,'stud:0:0',id,grip.id);return {ps:[base,carrier,root],root,anchor:grip.id};}
 const avoidZ=def.ports.find(p=>p.id===avoid)?.point[2],stud=def.ports.filter(p=>p.kind==='stud'&&p.normal[2]===1&&p.id!==avoid).sort((a,b)=>(avoidZ===undefined?0:Number(a.point[2]===avoidZ)-Number(b.point[2]===avoidZ))||b.point[2]-a.point[2])[0];expect(stud,m.num+' real top-only anchor').toBeDefined();
 const beam=place('plate-1x4-white',6),root=attachPart(beam,'grip:3:0',id,stud.id);return {ps:[base,carrier,beam,root],root,anchor:stud.id};
}
describe('popular molds enter the actual review and build path',()=>{
 it('keeps every collision section finite, convex and nondegenerate',()=>{
  for(const m of POPULAR_MOLDS){
   expect(m.solids.length+(m.hulls??[]).length,m.num).toBeGreaterThan(0);
   expect(new Set(m.ports.map(p=>p.id)).size,m.num).toBe(m.ports.length);
   for(const p of m.ports){expect([...p.point,...p.normal].every(Number.isFinite)).toBe(true);expect(p.normal.reduce((n,v)=>n+v*v,0)).toBeCloseTo(1,8);}
   for(const p of m.solids){expect(p.min).toBeLessThan(p.max);expect(p.polygon.length).toBeGreaterThanOrEqual(3);const crosses=p.polygon.map((a,i)=>{const b=p.polygon[(i+1)%p.polygon.length],c=p.polygon[(i+2)%p.polygon.length];return (b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);});expect(crosses.every(n=>n>=-1e-7)||crosses.every(n=>n<=1e-7),m.num+' convex prism').toBe(true);expect(crosses.some(n=>Math.abs(n)>1e-7)).toBe(true);}
   for(const h of m.hulls??[])for(const face of h.faces){expect(face.length).toBeGreaterThanOrEqual(3);expect(face.every(i=>Number.isSafeInteger(i)&&i>=0&&i<h.points.length)).toBe(true);const [a,b,c]=face.map(i=>h.points[i]);const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...n);expect(len,m.num+' face area').toBeGreaterThan(1e-8);const distances=h.points.map(p=>p.reduce((s,v,i)=>s+(v-a[i])*n[i]/len,0));expect(distances.every(d=>d<=1e-5)||distances.every(d=>d>=-1e-5),m.num+' convex hull face').toBe(true);}
  }
 });
 it('adds 24 distinct exact molds, not printed or approximate identity aliases',()=>{
  expect(POPULAR_MOLDS).toHaveLength(24);expect(new Set(POPULAR_MOLDS.map(m=>m.num)).size).toBe(24);
  for(const m of POPULAR_MOLDS){const id=idOf(m),k=parsePartId(id)!;expect(k).not.toBeNull();expect(nativeKindForCatalog(m.num,k.color)?.partId).toBe(id);expect(partInfo(id)?.number).toBe(m.num);expect(heightOf(k)).toBe(m.heightPlates);expect(footprint(k,0)).toEqual({fw:m.widthLdu/20,fd:m.depthLdu/20});expect(popularMold({...k,w:999})).toBeUndefined();expect(parsePartId(`${m.type}-999x999-white`)).toBeNull();expect(nativeKindForCatalog(m.num+'pr9999',k.color)).toBeNull();}
  expect(parsePartId('mold999999-1x1-white')).toBeNull();expect(parsePartId('mold2412b-1x2-white')).toBeNull();
 });
 it.each(POPULAR_MOLDS)('keeps exact #$num out until human confirmation and restores it once',m=>{
  const id=idOf(m),kind=parsePartId(id)!,box:[number,number,number,number]=[10,20,50,70];
  const inv=addPart(emptyInventory(),kind,1,{photo:1,box},.999,undefined,false);
  expect(counts(inv)).toEqual({});expect(needsReviewCount(inv.parts[id])).toBe(1);expect(scanKindIssue(kind)).toMatch(/human confirmation/);expect(checkFeatures(kind.type,kind.w,kind.d,{})).toHaveProperty('other');
  const other:OtherEntry={description:'Retained exact identity',color:kind.color,catalog:{num:m.num,name:m.name,color:kind.color},confirmed:true,confidence:.2,modelConfidence:.2,boxes:[{photo:1,box}]};
  const saved={...emptyInventory(),others:[other]},before=structuredClone(saved);expect(counts(saved)).toEqual({[id]:1});expect(saved).toEqual(before);
  expect(counts(readInventorySnapshot({stock:counts(saved),observedStock:{},inventory:saved}))).toEqual({[id]:1});expect(counts({...saved,others:[{...other,confirmed:false}]})).toEqual({});
 });
 it.each(POPULAR_MOLDS)('validates every real underside socket at four yaws: #$num',m=>{
  const id=idOf(m),base=place('brick-1x1-white'),carrier=place(base.partId,3),kind=parsePartId(id)!;
  const grips=definition(kind).ports.filter(p=>p.kind==='grip'&&p.normal[2]===-1);
  if(!grips.length){const f=supported(m),ps=normalize(f.ps);expect(constructionIssues(build(ps),stock(ps),24)).toEqual([]);expect(['24201','32803']).toContain(m.num);return;}
  for(const grip of grips)for(const rot of [0,90,180,-90]){
   const child=attachPart(carrier,'stud:0:0',id,grip.id,rot),ps=normalize([base,carrier,child]),ledger=stock(ps);
   expect(connectionPairs(frame(ps[1]),frame(ps[2]))).toContainEqual(['stud:0:0',grip.id]);
   expect(constructionIssues(build(ps),ledger,24),`${m.num}/${grip.id}/${rot}`).toEqual([]);
   expect(constructionIssues(build(ps),{...ledger,[id]:0},24).some(i=>i.kind==='inventory')).toBe(true);
  }
 });
 it.each(POPULAR_MOLDS)('exposes each actual top/side stud and rejects legacy approximation: #$num',m=>{
  const id=idOf(m),kind=parsePartId(id)!,f=supported(m),root=f.root;expect(connectionOnly(kind)).toBe(true);expect(validate({...build(f.ps),engine:undefined},stock(f.ps))[0]?.message).toContain('connections-v2');
  for(const stud of definition(kind).ports.filter(p=>p.kind==='stud')){
   const f=supported(m,stud.id),tile=attachPart(f.root,stud.id,'tile-1x1-white','grip:0:0'),ps=normalize([...f.ps,tile]);expect(constructionIssues(build(ps),stock(ps),24),`${m.num}/${stud.id}`).toEqual([]);
  }
  expect(()=>attachPart(root,'fabricated-port','tile-1x1-white','grip:0:0')).toThrow();
 });
 it.each(POPULAR_MOLDS)('uses #$num through normal bench, build order, tags and prompt geometry',m=>{
  const id=idOf(m),f=supported(m),ps=normalize(f.ps.map(p=>({partId:p.partId,x:p.x,y:p.y,z:p.z,rot:0}))),ledger=stock(ps),out=editBench(createBench(ledger),{remove:[],add:ps.slice().reverse()});
  expect(out.accepted,out.issues.join()).toBe(true);expect(finishBench(out.state).accepted).toBe(true);expect(constructionIssues(planBuildInstructions(out.candidate!).build,ledger,24)).toEqual([]);expect(catalogContract(ledger)).toContain(m.type);
  const tags=tagsForCatalogPart({num:m.num,name:m.name,shape:`${m.type}-${m.w}x${m.d}`},parsePartId(id)!.color);expect(tags.height).toEqual([String(m.heightPlates)]);expect(tags.studs).toEqual([String(m.ports.filter(p=>p.kind==='stud'&&p.normal[2]===1).length)]);
 });
});
