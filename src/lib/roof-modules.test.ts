import {expect,it} from 'vitest';
import {roofModules,moduleApproved,moduleSignature} from './roof-modules';
import reviews from './roof-module-reviews.json';
import fixture from './fixtures/large-pile-stock.json';
import {compileTechniques,constructionChoices,subjectConstructionChoices,type TechniqueProgram} from './construction-techniques';
import {constructionIssues} from './construction';
import {outlineOptions,confirmOutlineObservation,specialtyReviewNote} from './specialty-review';
import {emptyInventory,counts,type OtherEntry} from './inventory';
const stock=fixture.stock, roof=roofModules(stock)[0];
it('fits a continuous five-part roof against the actual larger photo stock',()=>{
 expect(roof.cost).toEqual({'plate-4x4-white':1,'slope-4x2-white':1,'slope-2x2-white':2,'tile-2x4-white':1});
 expect(constructionIssues(roof.build,stock,24)).toEqual([]);expect(moduleApproved(roof,reviews)).toBe(true);
 const before=JSON.stringify(stock);roofModules(stock);expect(JSON.stringify(stock)).toBe(before);
 expect(roofModules({...stock,'slope-2x2-white':1})).toEqual([]);
});
it('keeps the reviewed packing available when more parts allow a shorter unreviewed one',()=>{
 const expanded={...stock,'slope-4x2-white':3,'slope-1x2-white':8,'tile-1x4-white':6};
 const result=roofModules(expanded).find(m=>m.color==='white')!;
 expect(result.signature).toBe(roof.signature);expect(moduleApproved(result,reviews)).toBe(true);
 expect(constructionChoices(expanded).some(c=>c.id===roof.id)).toBe(true);
});
it('does not transfer visual approval to missing, recolored, repacked or edited geometry',()=>{
 expect(moduleApproved(roof,[])).toBe(false);expect(moduleApproved(roof,[{...reviews[0],finish:3}])).toBe(false);
 const kit={'plate-4x4-red':1,'slope-2x2-red':4,'tile-2x4-red':1};
 const red=roofModules(kit)[0];expect(red).toBeDefined();expect(moduleApproved(red,reviews)).toBe(false);expect(constructionChoices(kit)).toEqual([]);
 const changed=structuredClone(roof.build);changed.steps[1].parts[0].x++;
 expect(moduleApproved({...roof,signature:moduleSignature(changed)},reviews)).toBe(false);
});
it('offers the approved construction only to compatible subjects',()=>{
 expect(subjectConstructionChoices(stock,'Garden gatehouse').some(c=>c.family==='gable-roof')).toBe(true);
 expect(subjectConstructionChoices(stock,'Fox').some(c=>c.family==='gable-roof')).toBe(false);
 expect(subjectConstructionChoices(stock,'Boat').some(c=>c.family==='gable-roof')).toBe(false);
});
const program=(turn=0):TechniqueProgram=>({name:'Canopy',description:'Test carrier and roof',operations:[
 {kind:'part',id:'host',partId:'plate-6x6-tan',parent:'',parentPort:'',childPort:'',twist:0},
 {kind:'technique',id:'roof',choiceId:roof.id,parent:'host',parentPort:'stud:2:2',twist:turn},
]});
it('expands, reserves, locks and rotates every roof piece as one connected module',()=>{
 for(const turn of [0,90,180,270]){
  const result=compileTechniques(program(turn),stock);
  expect(result.receipts[0].parts).toHaveLength(5);expect(result.lockedOperations.size).toBe(5);
  expect(constructionIssues(result.build,stock,24)).toEqual([]);
  for(const [id,n]of Object.entries(roof.cost))expect(result.remaining[id]).toBe(stock[id as keyof typeof stock]-n);
 }
 const p=program();p.operations.push({...p.operations[1],id:'second'});expect(()=>compileTechniques(p,stock)).toThrow(/Not enough/);
});
it('requires a new observation and an exact supported connector selection before counting',()=>{
 const observation:OtherEntry={description:'bracket 1x2 - 1x2',color:'black',boxes:[{photo:1,box:[10,10,30,30]}]};
 const inv={...emptyInventory(),others:[observation]};expect(counts(inv)).toEqual({});
 expect(outlineOptions(observation).map(k=>k.partId)).toEqual(['bracket-1x2-black']);
 const confirmed=confirmOutlineObservation(inv,observation,'bracket-1x2-black');expect(counts(confirmed)).toEqual({'bracket-1x2-black':1});
 expect(confirmOutlineObservation(confirmed,observation,'bracket-1x2-black')).toBe(confirmed);
 expect(confirmOutlineObservation(inv,observation,'sidebrick-1x1-black')).toBe(inv);
 for(const description of ['bracket 1x2-2x2','brick 1x4 with studs on side','SNOT brick 1x2x1 2/3 with studs on side','bracket 1x1 with gold round plate']){
  const o={...observation,description};expect(outlineOptions(o)).toEqual([]);expect(specialtyReviewNote(o)).toBeTruthy();
 }
 expect(outlineOptions({...observation,description:'jumper plate 2x2'}).map(k=>k.partId)).toEqual(['jumper-2x2-black']);
 expect(outlineOptions({...observation,description:'jumper plate 1x2'}).map(k=>k.type)).toEqual(['jumper']);
 expect(outlineOptions({...observation,description:'brick 1x1 with side stud'}).map(k=>k.type)).toEqual(['sidebrick']);
});
