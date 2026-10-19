import {describe,it,expect} from 'vitest';
import large from '../fixtures/large-pile-stock.json';
import {authoredWholeAnimalTestLayouts} from '../../../test/whole-animal-fixtures';
import {composeWholeAnimal,wholeAnimalIssues,type WholeAnimalRole} from '../assembly-composer/animal-whole';
import {attachmentTwist,connectionPairs,frame,validateConnections} from '../connections';
import {animalSilhouetteKey} from '../assembly-composer/animal-silhouette';
import {connectedAnimalLayout,type WholeAnimalConnectionIntent} from './whole-animal-connections';
import {expandWholeAnimalProposal} from './whole-animal-synthesis';
function intentFixture(){return authoredWholeAnimalTestLayouts().map(layout=>{
 const c=composeWholeAnimal(large.stock,layout),parts=c.build.steps.flatMap(s=>s.parts),roles=new Map(c.receipts.flatMap(r=>r.indices.map(i=>[i,r.role as WholeAnimalRole] as const)));
 const intent:WholeAnimalConnectionIntent={rootRotation:0,operations:parts.map((p,i)=>{
  if(!i)return {partId:p.partId,role:roles.get(i)!,parent:-1,parentPort:'',childPort:'',twist:0};
  for(let parent=i-1;parent>=0;parent--)for(const[parentPort,childPort]of connectionPairs(frame(parts[parent]),frame(p))){const twist=attachmentTwist(parts[parent],parentPort,p,childPort);if(twist!==null)return {partId:p.partId,role:roles.get(i)!,parent,parentPort,childPort,twist};}
  throw Error('Fixture lacks earlier actual parent.');
 })};return {layout,c,intent};
});}
describe('fresh whole-animal connector intent',()=>{
 it('derives exact poses from real joins, then independently recompiles every anatomical role',()=>{
  for(const {layout,c,intent}of intentFixture()){
   const before=JSON.stringify(intent),target=connectedAnimalLayout(large.stock,layout,intent),actual=composeWholeAnimal(large.stock,target);
   expect(JSON.stringify(intent)).toBe(before);expect(wholeAnimalIssues(actual)).toEqual([]);expect(validateConnections(actual.build,large.stock,24)).toEqual([]);expect(animalSilhouetteKey(actual.build)).toBe(animalSilhouetteKey(c.build));expect(actual.remaining).toEqual(c.remaining);expect(actual.receipts.length).toBeGreaterThan(15);
   const original=Object.fromEntries(c.build.steps.flatMap(s=>s.parts).map((p,i)=>[i,frame(p)]));const derived=target.parts.map(p=>frame({...p,z:p.z/.4}));derived.forEach((f,i)=>{expect(f.rotation).toEqual(original[i].rotation);f.translation.forEach((n,a)=>expect(n).toBeCloseTo(original[i].translation[a],7));});
  }
 });
 it('starts from a body piece in design order and applies just one complete translation to ground it',()=>{
  const {layout,intent}=intentFixture()[0];
  // Change the chosen design root by traversing the exact undirected graph.
  const c=composeWholeAnimal(large.stock,layout),parts=c.build.steps.flatMap(s=>s.parts),root=c.receipts.find(r=>r.role==='torso')!.indices[0],order=[root],seen=new Set(order),parent=new Map<number,number>();
  for(let at=0;at<order.length;at++)for(let i=0;i<parts.length;i++)if(!seen.has(i)&&connectionPairs(frame(parts[order[at]]),frame(parts[i])).length){seen.add(i);parent.set(i,order[at]);order.push(i);}
  const role=new Map(c.receipts.flatMap(r=>r.indices.map(i=>[i,r.role as WholeAnimalRole] as const))),rootYaw=((Math.round(Math.atan2(frame(parts[root]).rotation[3],frame(parts[root]).rotation[0])*180/Math.PI)+360)%360) as 0|90|180|270;
  const reroot:WholeAnimalConnectionIntent={rootRotation:rootYaw,operations:order.map((i,n)=>{if(!n)return {...intent.operations[i],parent:-1,parentPort:'',childPort:'',twist:0};const pi=parent.get(i)!,ports=connectionPairs(frame(parts[pi]),frame(parts[i]))[0];return {partId:parts[i].partId,role:role.get(i)!,parent:order.indexOf(pi),parentPort:ports[0],childPort:ports[1],twist:attachmentTwist(parts[pi],ports[0],parts[i],ports[1])!};})};
  const target=connectedAnimalLayout(large.stock,layout,reroot),actual=composeWholeAnimal(large.stock,target);expect(animalSilhouetteKey(actual.build)).toBe(animalSilhouetteKey(c.build));expect(Math.min(...target.parts.map(p=>p.z))).toBeCloseTo(0);
 });
 it('rejects invented ports, future parents, scarce stock and mixed coordinate modes',()=>{
  const {layout,intent}=intentFixture()[0];
  for(const mutate of [(i:WholeAnimalConnectionIntent)=>{i.operations[1].parent=3;},(i:WholeAnimalConnectionIntent)=>{i.operations[1].parentPort='invented';},(i:WholeAnimalConnectionIntent)=>{i.operations[1].twist=23;}]){const bad=structuredClone(intent);mutate(bad);expect(()=>connectedAnimalLayout(large.stock,layout,bad)).toThrow();}
  const stock={...large.stock,[intent.operations[0].partId]:0};expect(()=>connectedAnimalLayout(stock,layout,intent)).toThrow('exhausts');
  expect(()=>expandWholeAnimalProposal({...layout,blueprintId:'test',connections:intent},large.stock)).toThrow('either connector intent');
  const expanded=expandWholeAnimalProposal({...layout,parts:[],blueprintId:'test',connections:intent},large.stock);expect(expanded.uses).toEqual([]);expect(expanded.layout.parts).toHaveLength(intent.operations.length);
 });
 it('normalizes advertised270/-270 child twists to the physically identical signed quarter turns',()=>{
  const {layout,intent}=intentFixture()[0];for(const [a,b]of [[270,-90],[-270,90],[180,-180]]){const x=structuredClone(intent),y=structuredClone(intent);x.operations.at(-1)!.twist=a;y.operations.at(-1)!.twist=b;expect(connectedAnimalLayout(large.stock,layout,x)).toEqual(connectedAnimalLayout(large.stock,layout,y));}
 });

 it('expands a partial design intent without accepting it as a complete animal',()=>{
  const {layout,intent}=intentFixture()[0],partial={...intent,operations:intent.operations.slice(0,1)},target=connectedAnimalLayout(large.stock,layout,partial);expect(target.parts).toHaveLength(1);expect(()=>composeWholeAnimal(large.stock,target)).toThrow('20–80');
 });

});
