import {beforeAll,describe,expect,it} from 'vitest';
import large from '../fixtures/large-pile-stock.json';
import {authoredWholeAnimalTestLayouts} from '../../../test/whole-animal-fixtures';
import {composeWholeAnimal,type WholeAnimalLayout,type WholeAnimalRole} from '../assembly-composer/animal-whole';
import {attachmentTwist,connectionPairs,frame} from '../connections';
import {animalSilhouetteKey} from '../assembly-composer/animal-silhouette';
import {connectedAnimalLayout,type WholeAnimalConnectionIntent} from './whole-animal-connections';
import {advanceWholeAnimalStage,type WholeAnimalStageState} from './whole-animal-stages';

const FEATURES=new Set(['neck','head','muzzle','nose','eye-left','eye-right','ear-left','ear-right']);
type Fixture={layout:WholeAnimalLayout;intent:WholeAnimalConnectionIntent;featureCount:number;coreCount:number;bodyCount:number;key:string};
let fixtures:Fixture[];
beforeAll(()=>{fixtures=authoredWholeAnimalTestLayouts().map(layout=>{
 const c=composeWholeAnimal(large.stock,layout),parts=c.build.steps.flatMap(s=>s.parts),ff=parts.map(frame);
 const roles=new Map(c.receipts.flatMap(r=>r.indices.map(i=>[i,r.role as WholeAnimalRole] as const)));
 const root=parts.findIndex((_,i)=>roles.get(i)==='head'),order=[root],parents=new Map<number,number>(),seen=new Set(order);
 const addPhase=(allowed:(role:WholeAnimalRole)=>boolean)=>{
  const pending=parts.flatMap((_,i)=>!seen.has(i)&&allowed(roles.get(i)!)?[i]:[]);
  while(pending.length) {
   let added=false;
   for(let p=0;p<pending.length;p++) {
    const i=pending[p],parent=order.find(j=>connectionPairs(ff[j],ff[i]).length>0);
    if(parent===undefined)continue;
    parents.set(i,parent);order.push(i);seen.add(i);pending.splice(p,1);added=true;break;
   }
   if(!added)throw Error('Test fixture lacks a legal stage traversal.');
  }
 };
 addPhase(role=>FEATURES.has(role));const featureCount=order.length;
 addPhase(role=>!FEATURES.has(role)&&role!=='tail'&&!role.startsWith('leg-'));const coreCount=order.length;
 addPhase(role=>role.startsWith('leg-'));const bodyCount=order.length;
 addPhase(role=>role==='tail');
 const rootRotation=parts[root].rot as WholeAnimalConnectionIntent['rootRotation'];
 const intent:WholeAnimalConnectionIntent={rootRotation,operations:order.map((i,n)=>{
  if(!n)return {partId:parts[i].partId,role:roles.get(i)!,parent:-1,parentPort:'',childPort:'',twist:0};
  const parent=parents.get(i)!;
  for(const [parentPort,childPort]of connectionPairs(ff[parent],ff[i])) {
   const twist=attachmentTwist(parts[parent],parentPort,parts[i],childPort);
   if(twist!==null)return {partId:parts[i].partId,role:roles.get(i)!,parent:order.indexOf(parent),parentPort,childPort,twist};
  }
  throw Error('Test fixture lacks a legal connector twist.');
 })};
 return {layout,intent,featureCount,coreCount,bodyCount,key:animalSilhouetteKey(c.build)};
});});
const take=(f:Fixture,count:number)=>({...structuredClone(f.intent),operations:structuredClone(f.intent.operations.slice(0,count))});
const expand=(f:Fixture,intent:WholeAnimalConnectionIntent)=>connectedAnimalLayout(large.stock,f.layout,intent);
const start=(f:Fixture)=>{const intent=take(f,f.featureCount);return advanceWholeAnimalStage(expand(f,intent),intent,large.stock);};
const body=(f:Fixture,state:WholeAnimalStageState)=>{const intent=take(f,f.bodyCount);return advanceWholeAnimalStage(expand(f,intent),intent,large.stock,state);};

describe('pure whole-animal stage progression',()=>{
 it('constructs actual features, body/feet and tail through the same immutable exact-stock program',()=>{
  for(const f of fixtures) {
   const before=JSON.stringify({f,stock:large.stock}),first=start(f);
   expect(f.featureCount).toBeLessThanOrEqual(28);expect(first.complete).toBe(false);expect(first.state!.stage).toBe('body');
   expect(new Set(first.state!.prefix.operations.map(p=>p.role))).toEqual(FEATURES);
   const second=body(f,first.state!);expect(second.complete).toBe(false);expect(second.state!.stage).toBe('tail');
   const layout=expand(f,f.intent),final=advanceWholeAnimalStage(layout,f.intent,large.stock,second.state);
   expect(final.complete).toBe(true);expect(final.state).toBeUndefined();expect(final.feedback).toContain('coverage ONLY');
   for(const progress of [first,second,final])expect(Object.values(progress.remaining).reduce((n,v)=>n+v,0)).toBe(408-(progress.state?.prefix.operations.length??f.intent.operations.length));
   const c=composeWholeAnimal(large.stock,layout);expect(final.remaining).toEqual(c.remaining);expect(animalSilhouetteKey(c.build)).toBe(f.key);
   expect(JSON.stringify({f,stock:large.stock})).toBe(before);
  }
 });

 it('clones accepted prefixes and states instead of sharing mutable provider/caller data',()=>{
  const f=fixtures[0],intent=take(f,f.featureCount),first=advanceWholeAnimalStage(expand(f,intent),intent,large.stock);
  const original=JSON.stringify(first.state);intent.operations[0].partId='mutated';expect(JSON.stringify(first.state)).toBe(original);
  const second=body(f,first.state!);const prior=JSON.stringify(first.state);second.state!.prefix.operations[0].partId='mutated';expect(JSON.stringify(first.state)).toBe(prior);
 });

 it('permits a new whole-origin translation when lower body/feet are appended without changing prior relative poses',()=>{
  const f=fixtures[0],first=start(f),intent=take(f,f.bodyCount),layout=expand(f,intent),head=expand(f,first.state!.prefix);
  expect(layout.parts[0].z).toBeGreaterThan(head.parts[0].z);
  const shifted={...layout,parts:layout.parts.map(p=>({...p,x:p.x+2,y:p.y+3,z:p.z+.8}))};
  expect(advanceWholeAnimalStage(shifted,intent,large.stock,first.state).state!.stage).toBe('tail');
 });

 it('preserves complete free-coordinate fixtures with no prior staged state, but never treats coverage as final acceptance',()=>{
  for(const layout of authoredWholeAnimalTestLayouts()) {
   const result=advanceWholeAnimalStage(layout,undefined,large.stock);expect(result.complete).toBe(true);expect(result.feedback).toContain('blueprint checks');
  }
  const f=fixtures[0],intent=take(f,f.featureCount);expect(()=>advanceWholeAnimalStage(expand(f,intent),undefined,large.stock)).toThrow('Partial stages require');
 });

 it('checks exact prepaid program values before complete true, including a attempted free-coordinate bypass',()=>{
  const f=fixtures[0],first=start(f);
  expect(()=>advanceWholeAnimalStage(f.layout,undefined,large.stock,first.state)).toThrow('cannot be completed or replaced with free coordinates');
  for(const mutate of [
   (i:WholeAnimalConnectionIntent)=>{i.rootRotation=((i.rootRotation+90)%360) as typeof i.rootRotation;},
   (i:WholeAnimalConnectionIntent)=>{i.operations[1].role='head';i.operations[1].partId='brick-1x1-black';},
   (i:WholeAnimalConnectionIntent)=>{[i.operations[1],i.operations[2]]=[i.operations[2],i.operations[1]];},
   (i:WholeAnimalConnectionIntent)=>{i.operations[1].twist=i.operations[1].twist===180?-180:180;},
  ]) {
   const changed=structuredClone(f.intent);mutate(changed);
   expect(()=>advanceWholeAnimalStage(expand(f,f.intent),changed,large.stock,first.state)).toThrow('prepaid prior operation exact');
  }
 });

 it('accepts reordered object keys when all six values and operation array order remain unchanged',()=>{
  const f=fixtures[0],first=start(f),intent=take(f,f.bodyCount);
  intent.operations=intent.operations.map(({partId,role,parent,parentPort,childPort,twist})=>({twist,childPort,parentPort,parent,role,partId}));
  expect(advanceWholeAnimalStage(expand(f,intent),intent,large.stock,first.state).state!.stage).toBe('tail');
 });

 it('rejects incomplete features, premature body/tail and more than 28 initial feature operations',()=>{
  const f=fixtures[0];for(const count of [1,5]){const intent=take(f,count);expect(()=>advanceWholeAnimalStage(expand(f,intent),intent,large.stock)).toThrow('Stage features is incomplete');}
  const premature=take(f,f.featureCount+1);expect(()=>advanceWholeAnimalStage(expand(f,premature),premature,large.stock)).toThrow('later-phase anatomy');
  const oversized=structuredClone(f.intent);oversized.operations.forEach(op=>{if(!FEATURES.has(op.role))op.role='head';});
  expect(()=>advanceWholeAnimalStage(expand(f,oversized),oversized,large.stock)).toThrow('28 operations');
 });

 it('requires every body/leg role before committing the body stage',()=>{
  const f=fixtures[0],first=start(f),intent=take(f,f.bodyCount);intent.operations.forEach(op=>{if(op.role==='torso')op.role='chest';});
  expect(()=>advanceWholeAnimalStage(expand(f,intent),intent,large.stock,first.state)).toThrow('required roles: torso');
  const second=body(f,first.state!),same=second.state!.prefix;
  expect(()=>advanceWholeAnimalStage(expand(f,same),same,large.stock,second.state)).toThrow('required roles: tail');
 });

 it('splits core and grounded legs into independently checked append-only stages without fixing a body template',()=>{
  for(const f of fixtures) {
   const first=start(f),core=take(f,f.coreCount),coreLayout=expand(f,core),coreProgress=advanceWholeAnimalStage(coreLayout,core,large.stock,first.state);
   expect(coreProgress.complete).toBe(false);expect(coreProgress.state!.stage).toBe('legs');
   expect(coreProgress.state!.prefix.operations.some(op=>op.role.startsWith('leg-'))).toBe(false);
   expect(first.feedback).toContain('Required next roles: chest, hips, torso');expect(first.feedback).not.toContain('Required next roles: chest, hips, torso, leg-');
   expect(coreProgress.feedback).toContain('Append ONLY leg roles');
   const withLegs=take(f,f.bodyCount),legLayout=expand(f,withLegs),legProgress=advanceWholeAnimalStage(legLayout,withLegs,large.stock,coreProgress.state);
   expect(legProgress.state!.stage).toBe('tail');expect(legLayout.parts[0].z).toBeGreaterThan(coreLayout.parts[0].z);
   for(const role of ['leg-front-left','leg-front-right','leg-rear-left','leg-rear-right'])expect(Math.min(...legLayout.parts.filter(p=>p.role===role).map(p=>p.z))).toBeCloseTo(0);
   const final=advanceWholeAnimalStage(expand(f,f.intent),f.intent,large.stock,legProgress.state);expect(final.complete).toBe(true);
   expect(final.remaining).toEqual(composeWholeAnimal(large.stock,expand(f,f.intent)).remaining);
   for(const progress of [coreProgress,legProgress])expect(Object.values(progress.remaining).reduce((n,v)=>n+v,0)).toBe(408-progress.state!.prefix.operations.length);
  }
 });

 it('accepts body core plus zero through three existing leg roles before requiring the separate legs stage',()=>{
  const f=fixtures[0],first=start(f);
  for(let legs=0;legs<4;legs++) {
   const core=take(f,f.coreCount+legs),progress=advanceWholeAnimalStage(expand(f,core),core,large.stock,first.state);
   expect(progress.state!.stage).toBe('legs');const before=JSON.stringify(progress.state);
   const remaining=take(f,f.bodyCount),completed=advanceWholeAnimalStage(expand(f,remaining),remaining,large.stock,progress.state);
   expect(completed.state!.stage).toBe('tail');expect(JSON.stringify(progress.state)).toBe(before);
  }
 });

 it('requires all four leg roles and rejects any non-leg append, even an otherwise complete whole target',()=>{
  const f=fixtures[0],first=start(f),core=take(f,f.coreCount),progress=advanceWholeAnimalStage(expand(f,core),core,large.stock,first.state);
  const missing=take(f,f.bodyCount);missing.operations.forEach(op=>{if(op.role==='leg-rear-right')op.role='leg-rear-left';});
  expect(()=>advanceWholeAnimalStage(expand(f,missing),missing,large.stock,progress.state)).toThrow('required roles: leg-rear-right');
  const wrong=take(f,f.bodyCount);wrong.operations.at(-1)!.role='hips';
  expect(()=>advanceWholeAnimalStage(expand(f,wrong),wrong,large.stock,progress.state)).toThrow('append ONLY leg roles');
  expect(()=>advanceWholeAnimalStage(expand(f,f.intent),f.intent,large.stock,progress.state)).toThrow('append ONLY leg roles');
 });

 it('does not confuse an elevated named leg with actual ground contact',()=>{
  const f=fixtures[0],intent=structuredClone(f.intent);
  for(const op of intent.operations)if(op.role==='leg-front-left')op.role='frame';
  intent.operations[0].role='leg-front-left';
  expect(()=>advanceWholeAnimalStage(expand(f,intent),intent,large.stock)).toThrow('leg-front-left does not reach the normalized ground');
 });

 it('rejects missing stock, malformed/unbounded input and unsupported physical pieces without mutating accepted state',()=>{
  const f=fixtures[0],first=start(f),intent=take(f,f.bodyCount),layout=expand(f,intent),before=JSON.stringify(first.state);
  expect(()=>advanceWholeAnimalStage(layout,intent,{...large.stock,[intent.operations[0].partId]:0},first.state)).toThrow('stock exhausted');
  expect(()=>advanceWholeAnimalStage(layout,intent,{...large.stock,'plate-1x1-black':NaN},first.state)).toThrow('exact integer counts');
  const tooMany=structuredClone(f.intent);tooMany.operations.push(...Array(81).fill(tooMany.operations[0]));
  expect(()=>advanceWholeAnimalStage(layout,tooMany,large.stock,first.state)).toThrow('1–80 operations');
  const bad=structuredClone(layout);bad.parts[0].partId='wheel-1x1-black';expect(()=>advanceWholeAnimalStage(bad,intent,large.stock,first.state)).toThrow();
  expect(JSON.stringify(first.state)).toBe(before);
 });

 it('rejects physically disconnected or colliding partial targets and layouts unrelated to the exact connector intent',()=>{
  const f=fixtures[0],intent=take(f,f.featureCount),original=expand(f,intent),disconnected=structuredClone(original);
  disconnected.parts.at(-1)!.x+=8;expect(()=>advanceWholeAnimalStage(disconnected,intent,large.stock)).toThrow('mating-contact graph');
  const overlap=structuredClone(original);Object.assign(overlap.parts.at(-1)!,{x:overlap.parts[0].x,y:overlap.parts[0].y,z:overlap.parts[0].z});
  expect(()=>advanceWholeAnimalStage(overlap,intent,large.stock)).toThrow();
  const changed=structuredClone(intent);changed.operations[0].role='muzzle';
  expect(()=>advanceWholeAnimalStage(original,changed,large.stock)).toThrow('changed an exact connector pose');
 });

 it('keeps all supported exact twist values rather than treating ±270 as editable aliases in a prepaid prefix',()=>{
  const f=fixtures[0],intent=take(f,f.featureCount),at=intent.operations.findIndex(op=>op.twist===90||op.twist===-90);
  expect(at).toBeGreaterThan(0);intent.operations[at].twist=intent.operations[at].twist===90?-270:270;
  const first=advanceWholeAnimalStage(expand(f,intent),intent,large.stock),next=take(f,f.bodyCount);
  next.operations.splice(0,intent.operations.length,...intent.operations);
  expect(advanceWholeAnimalStage(expand(f,next),next,large.stock,first.state).state!.stage).toBe('tail');
  const alias=structuredClone(next);alias.operations[at].twist=intent.operations[at].twist===270?-90:90;
  expect(()=>advanceWholeAnimalStage(expand(f,alias),alias,large.stock,first.state)).toThrow('prepaid prior operation exact');
 });
});
