import { expect,it } from 'vitest';
import { angleChoices, compileTechniques, expandTechniques, type TechniqueProgram } from './construction-techniques';
import { compileConnections, requiredContactIssues, frame } from './connections';
import { fitConnectionProgram } from './connection-fit';
import { constructionIssues } from './construction';
import photo from '../../test/fixtures/photo-stock.json';

const choices=angleChoices(photo.stock);
const sample=(choice=choices[0]):TechniqueProgram=>({name:'Angled feature',description:'A small reusable assembly',operations:[
 {kind:'part',id:'body',partId:choice.hosts[0],parent:'',parentPort:'',childPort:'',twist:0},
 {kind:'technique',id:'roof',choiceId:choice.id,parent:'body',parentPort:choice.hand===1?'stud:0:0':'stud:0:1',twist:0},
]});
it('binds all supported angles and handedness to actual photo stock',()=>{
 expect(new Set(choices.map(c=>c.length))).toEqual(new Set([3,4,6]));
 expect(new Set(choices.map(c=>c.hand))).toEqual(new Set([-1,1]));
 const before=structuredClone(photo.stock);
 for(const choice of choices){
  const result=compileTechniques(sample(choice),photo.stock,choices,choice.id);
  expect(result.program.operations).toHaveLength(4);expect(result.build.requiredContacts).toHaveLength(2);
  expect(constructionIssues(result.build,photo.stock,24)).toEqual([]);
  expect(Object.values(result.remaining).every(n=>n>=0)).toBe(true);
 }
 expect(photo.stock).toEqual(before);
});
it('reserves repeated constructions from one ledger and rejects exhausted supports',()=>{
 const p=sample();p.operations.push({kind:'technique',id:'other',choiceId:choices[0].id,parent:'body',parentPort:'stud:0:0',twist:0});
 expect(()=>expandTechniques(p,photo.stock,choices)).toThrow(/stock/);
});
it('never substitutes an unavailable choice, missing command or smooth tile',()=>{
 const p=sample();expect(()=>compileTechniques(p,photo.stock,[],choices[0].id)).toThrow(/unavailable/);
 p.operations.pop();expect(()=>compileTechniques(p,photo.stock,choices,choices[0].id)).toThrow(/missing/);
 expect(angleChoices({'tile-2x4-red':30,'plate-2x3-red':4,'tile-1x1-red':20})).toEqual([]);
});
it('validates both anchors even when a moved support leaves the whole build connected',()=>{
 const p=sample();(p.operations[0] as {partId:string}).partId='plate-4x6-reddish-brown';
 const result=compileTechniques(p,photo.stock,choices);
 const bad=structuredClone(result.program);bad.operations[2].parentPort='stud:5:3';
 // Remove only the contract to demonstrate why normal graph connectivity is insufficient.
 expect(()=>compileConnections({...bad,requiredContacts:undefined},photo.stock)).not.toThrow();
 expect(()=>compileConnections(bad,photo.stock)).toThrow(/Required connection/);
 const restored=JSON.parse(JSON.stringify(result.build));
 restored.steps[2].parts[0].x+=.25;
 expect(constructionIssues(restored,photo.stock,24).some(i=>i.message.includes('Required connection'))).toBe(true);
});
it('keeps exact angles and contracts through fitting and JSON export',()=>{
 const result=compileTechniques(sample(),photo.stock,choices);
 const fitted=fitConnectionProgram(result.program,photo.stock,{lockedOperations:result.lockedOperations});
 expect(fitted.changes).toEqual([]);
 expect(fitted.program.operations[3].twist).toBe(choices[0].angle);
 expect(constructionIssues(JSON.parse(JSON.stringify(fitted.build)),photo.stock,24)).toEqual([]);
 const bad=structuredClone(result.program);bad.operations[3].twist=45;
 expect(()=>fitConnectionProgram(bad,photo.stock,{lockedOperations:result.lockedOperations})).toThrow();
});
it('rejects forward or duplicate ids and nonexistent anchor locations',()=>{
 const p=sample();p.operations[1].parent='future';expect(()=>compileTechniques(p,photo.stock,choices)).toThrow(/earlier/);
 p.operations[1].parent='body';p.operations[1].id='body';expect(()=>compileTechniques(p,photo.stock,choices)).toThrow(/unique/);
 p.operations[1].id='roof';p.operations[1].parentPort='stud:100:100';expect(()=>compileTechniques(p,photo.stock,choices)).toThrow(/existing top stud/);
 p.operations[1].parentPort='stud:0:0';p.operations[1].twist=90;expect(()=>compileTechniques(p,photo.stock,choices)).toThrow(/other end/);
});
it('bounds and validates untrusted required contacts',()=>{
 for(const raw of [null,{},[{a:0,b:0,aPort:'a',bPort:'b'}],[{a:-1,b:1,aPort:'a',bPort:'b'}],[{a:0,b:500,aPort:'a',bPort:'b'}]])expect(requiredContactIssues([],raw)).not.toEqual([]);
 expect(requiredContactIssues([],[{a:0,b:1,aPort:'a',bPort:'b'}],false)).toEqual([]);
 expect(requiredContactIssues([],[{a:0,b:1,aPort:'a',bPort:'b'}],true)).not.toEqual([]);
});
it('later parts attach to the named panel and inherit its exact frame',()=>{
 const choice=choices[0],p=sample(choice),stock={...photo.stock,'plate-1x2-black':1};
 p.operations.push({kind:'part',id:'fin',partId:'plate-1x2-black',parent:'roof.panel',parentPort:'stud:0:0',childPort:'grip:0:0',twist:0});
 const result=compileTechniques(p,stock,choices),parts=result.build.steps.flatMap(s=>s.parts);
 expect(frame(parts[4]).rotation).toEqual(frame(parts[3]).rotation);
 expect(result.program.operations[4].parent).toBe(3);
});

it('reserves future feature stock before ordinary commands can consume it',()=>{
 const p=sample(),support=choices[0].supports[0];
 p.operations.splice(1,0,{kind:'part',id:'filler',partId:support,parent:'body',parentPort:'stud:0:0',childPort:'grip:0:0',twist:0});
 expect(()=>expandTechniques(p,photo.stock,choices)).toThrow(/unreserved actual stock/);
});

it('keeps the future panel clearance free while fitting earlier ordinary parts',()=>{
 const p=sample();(p.operations[0] as {partId:string}).partId='plate-4x6-reddish-brown';
 p.operations.splice(1,0,{kind:'part',id:'filler',partId:'brick-1x2-reddish-brown',parent:'body',parentPort:'stud:0:0',childPort:'grip:0:0',twist:0});
 const expanded=expandTechniques(p,photo.stock,choices);
 expect(()=>compileConnections(expanded.program,photo.stock)).toThrow();
 const result=fitConnectionProgram(expanded.program,photo.stock,{lockedOperations:expanded.lockedOperations});
 expect(result.changes.map(c=>c.operation)).toEqual([1]);expect(constructionIssues(result.build,photo.stock,24)).toEqual([]);
 for(const i of expanded.lockedOperations)expect(result.program.operations[i]).toEqual(expanded.program.operations[i]);
});
