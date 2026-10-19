import {describe,it,expect} from 'vitest';
import {EXPANDED_PLAIN_MOLD_SPECS} from './expanded-plain-molds';
import {FLAT_MOLD_SPECS} from './expanded-flat-molds';
import {CONNECTOR_MOLD_SPECS} from './connector-mold-geometry';
import {specialMold} from './special-mold-geometry';
import {parsePartId,type Placed,type Build,validate} from './bricks';
import {madeIn,nativeKindForCatalog,partInfo} from './catalog';
import {definition,attachPart,frame,connectionPairs,connectionOnly,compileConnections} from './connections';
import {constructionIssues} from './construction';
import {createBench,editBench,finishBench} from './whole-model-workbench';
import {catalogContract} from './whole-model-catalog';
import {wholeModelPrompt} from './shape-first/whole-model-prompt';
import {planBuildInstructions} from './instruction-order';
import {addPart,emptyInventory,counts,needsReviewCount,type OtherEntry} from './inventory';
import {readInventorySnapshot} from './inventory-snapshot';
import {scanKindIssue} from './gemini';
import {checkFeatures} from './identify';
import type {RankedIdea} from './shape-first/pipeline';

const specs=[...EXPANDED_PLAIN_MOLD_SPECS,...FLAT_MOLD_SPECS,...CONNECTOR_MOLD_SPECS];
const idOf=(s:typeof specs[number])=>`${s.type}-${s.w}x${s.d}-${madeIn(`${s.type}-${s.w}x${s.d}`)!.includes('white')?'white':madeIn(`${s.type}-${s.w}x${s.d}`)![0]}`;
const p=(partId:string,x=4,y=4,z=0,rot=0):Placed=>({partId,x,y,z,rot});
const stock=(ps:Placed[])=>ps.reduce<Record<string,number>>((s,p)=>(s[p.partId]=(s[p.partId]??0)+1,s),{});
const build=(ps:Placed[]):Build=>({engine:'connections-v2',name:'Exact mold regression',description:'Controlled contact proof, not a subject or craft claim.',steps:ps.map(p=>({caption:'Attach the actual part.',parts:[p]}))});
const upright=(part:Placed,rot=0):Placed=>({partId:part.partId,x:part.x,y:part.y,z:part.z,rot});
describe('sixteen new exact molds reach normal review, stock and construction',()=>{
 it('adds sixteen distinct exact mappings without aliasing printed or fabricated molds',()=>{
  expect(specs).toHaveLength(16);expect(new Set(specs.map(s=>s.num)).size).toBe(16);
  for(const s of specs){const id=idOf(s),k=parsePartId(id)!;expect(nativeKindForCatalog(s.num,k.color)?.partId).toBe(id);expect(partInfo(id)?.number).toBe(s.num);}
  for(const num of ['41740','92593pr0001','14769pr0001','4070pr0001','99780pr0001'])expect(nativeKindForCatalog(num,'white')).toBeNull();
  expect(()=>createBench({'plate-3x8-white':1})).toThrow();
 });
 it.each(specs)('keeps $num out of stock until its exact human confirmation',s=>{
  const id=idOf(s),k=parsePartId(id)!,box:[number,number,number,number]=[10,20,50,70];
  const inv=addPart(emptyInventory(),k,1,{photo:1,box},.999,undefined,false);
  expect(counts(inv)).toEqual({});expect(needsReviewCount(inv.parts[id])).toBe(1);expect(scanKindIssue(k)).toMatch(/human confirmation/);expect(checkFeatures(k.type,k.w,k.d,{})).toHaveProperty('other');
  const other:OtherEntry={description:'Original exact catalog observation',color:k.color,catalog:{num:s.num,name:'Recorded mold',color:k.color},confirmed:true,confidence:.3,modelConfidence:.3,boxes:[{photo:1,box}]};
  const saved={...emptyInventory(),others:[other]},before=structuredClone(saved);
  expect(counts(saved)).toEqual({[id]:1});expect(saved).toEqual(before);
  const restored=readInventorySnapshot({stock:counts(saved),observedStock:{},inventory:saved});expect(counts(restored)).toEqual({[id]:1});expect(restored.others[0]).toMatchObject(other);
  expect(counts({...saved,others:[{...other,confirmed:false}]})).toEqual({});
 });
 it.each(specs)('mates the actual underside of $num at four exact yaws without changing stock',s=>{
  const id=idOf(s),k=parsePartId(id)!,base=p('plate-1x1-white'),grips=definition(k).ports.filter(g=>g.kind==='grip'&&g.normal[2]===-1);
  expect(grips.length).toBeGreaterThan(0);
  const chosen=grips.length>5?[grips[0],grips[Math.floor(grips.length/2)],grips.at(-1)!]:grips;
  for(const grip of chosen)for(const turn of [0,90,180,-90]){
    const child=attachPart(base,'stud:0:0',id,grip.id,turn),raw=[base,child],minX=Math.min(...raw.map(p=>p.x)),minY=Math.min(...raw.map(p=>p.y));
    const ps=raw.map(p=>({...p,x:p.x-minX+1,y:p.y-minY+1})),ledger=stock(ps),before=structuredClone({ps,ledger});
    expect(connectionPairs(frame(ps[0]),frame(ps[1]))).toContainEqual(['stud:0:0',grip.id]);
    expect(constructionIssues(build(ps),ledger,24),`${id}/${grip.id}/${turn}`).toEqual([]);
    expect({ps,ledger}).toEqual(before);
    expect(constructionIssues(build(ps),{...ledger,[id]:0},24).some(i=>i.kind==='inventory')).toBe(true);
  }
 });
 it.each(specs)('commits and instructs $num through the actual normal upright workbench',s=>{
  const id=idOf(s),base=p('plate-1x1-white'),grip=definition(parsePartId(id)!).ports.find(g=>g.kind==='grip'&&g.normal[2]===-1)!;
  const child=upright(attachPart(base,'stud:0:0',id,grip.id)),ps=[base,child],ledger=stock(ps),state=createBench(ledger);
  const result=editBench(state,{remove:[],add:ps.slice().reverse()});
  expect(result.accepted,result.issues.join('\n')).toBe(true);expect(finishBench(result.state).accepted).toBe(true);
  expect(result.candidate!.steps[0].parts[0].partId).toBe(base.partId);
  const ordered=planBuildInstructions(result.candidate!).build;expect(constructionIssues(ordered,ledger,24)).toEqual([]);
  expect(catalogContract(ledger)).toContain(`${s.type}-${s.w}x${s.d}`);
 });
 it('exposes real recessed/offset/raised planes and refuses approximate legacy authority',()=>{
  const cases=[['headlight-1x1-white','side:0',[10,4,14]],['invertedbracket-1x2-white','stud:0:0',[10,14,8]],['offsetplate-1x3-white','stud:0.5:0',[20,10,8]],['roundjumper-2x2-white','stud:0.5:0.5',[20,20,8]]] as const;
  for(const [id,port,point]of cases){
    const k=parsePartId(id)!;expect(definition(k).ports.find(p=>p.id===port)?.point).toEqual(point);expect(connectionOnly(k)).toBe(true);
    const ps=[p(id)];expect(validate({...build(ps),engine:undefined},stock(ps))[0].message).toContain('connections-v2');
  }
  const key='headlight-1x1-white',tile='tile-1x1-white';
  const actual=compileConnections({name:'Recessed headlight face',description:'Real front clutch',operations:[{partId:key,parent:-1,parentPort:'',childPort:'',twist:0},{partId:tile,parent:0,parentPort:'side:0',childPort:'grip:0:0',twist:0}]},{[key]:1,[tile]:1});
  expect(constructionIssues(actual,{[key]:1,[tile]:1},24)).toEqual([]);
  expect(connectionPairs(...actual.steps.flatMap(s=>s.parts).map(frame) as [ReturnType<typeof frame>,ReturnType<typeof frame>])).toContainEqual(['side:0','grip:0:0']);
 });
 it('keeps real centered/offset top joins and rejects a guessed ordinary grid stud',()=>{
  for(const [id,port]of [['offsetplate-1x3-white','stud:0.5:0'],['roundjumper-2x2-white','stud:0.5:0.5']]){
    const base=p(id),child=attachPart(base,port,'tile-1x1-white','grip:0:0'),ps=[base,upright(child)],ledger=stock(ps);
    const good=editBench(createBench(ledger),{remove:[],add:ps});expect(good.accepted,good.issues.join()).toBe(true);
    const wrong={...ps[1],x:ps[1].x+.5};expect(editBench(createBench(ledger),{remove:[],add:[base,wrong]}).accepted).toBe(false);
    expect(()=>attachPart(base,'stud:0:0',child.partId,'grip:0:0')).toThrow();
  }
 });
 it('allows literal LDU offsets and fractional plate planes while preserving physical checks and poses',()=>{
  const base=p('brick-1x2-white'),bracket=p('bracket-1x2-white',4,3.8,1.5),ps=[base,bracket],ledger=stock(ps);
  expect(constructionIssues(build(ps),ledger,24)).toEqual([]);
  const out=editBench(createBench(ledger),{remove:[],add:ps});expect(out.accepted,out.issues.join()).toBe(true);expect(out.state.pieces[1]).toMatchObject(bracket);
  expect(finishBench(JSON.parse(JSON.stringify(out.state))).accepted).toBe(true);
  const single=createBench({'plate-1x1-white':1});
  for(const x of [.001,.025,.200000001,NaN,Infinity]){const bad=editBench(single,{remove:[],add:[p('plate-1x1-white',x)]});expect(bad.accepted).toBe(false);expect(bad.state).toEqual(single);}
  expect(editBench(single,{remove:[],add:[p('plate-1x1-white',.05,.15)]}).accepted).toBe(true);
  expect(editBench(single,{remove:[],add:[p('plate-1x1-white',0,0,.125)]}).accepted).toBe(false); // No invented ground support.
  const idea={name:'Test',pitch:'Test only',why:'Fixture',length:2,width:2,height:2,palette:[],cells:20,worst:1,shortfall:0} as RankedIdea;
  const prompt=wholeModelPrompt(idea,ledger,20,4);expect(prompt.schema.properties.add.items.properties.z.type).toBe('NUMBER');expect(prompt.text).toContain('1-LDU pose grid');expect(prompt.text).not.toContain('z is INTEGER');
 });
 it('uses real clipped/round profiles without inventing extra triangle or round-bore sockets',()=>{
  for(const id of ['roundtile-2x2-white','halftile-1x1-white','quarterroundtile-1x1-white','triangletile-2x2-white']){
    const k=parsePartId(id)!,m=specialMold(k)!;expect(m.studs).toHaveLength(0);expect(definition(k).convex).toHaveLength(m.sections.length);
  }
  const triangle=definition(parsePartId('triangletile-2x2-white')!);expect(triangle.ports.map(p=>p.id)).toEqual(['grip:0:0']);
  expect(definition(parsePartId('roundtile-2x2-white')!).ports).toHaveLength(4);expect(definition(parsePartId('roundjumper-2x2-white')!).ports).toHaveLength(5);
 });
});
