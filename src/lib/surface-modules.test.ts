import {expect,it} from 'vitest';
import {surfaceChoices} from './surface-modules';
import {compileTechniques,expandTechniques,type TechniqueProgram} from './construction-techniques';
import {axisAngle,attachPart,attachmentTwist,frame,validateConnections,compileConnections} from './connections';
import {constructionIssues} from './construction';
import type {Build,Placed} from './bricks';
import photo from '../../test/fixtures/photo-stock.json';
const stock={'brick-2x4-white':1,'bracket-1x2-light-gray':4,'tile-2x2-white':2,'slope-2x2-white':2,'plate-2x2-black':1};
const choices=surfaceChoices(stock);
const program=(choice=choices[0]):TechniqueProgram=>({name:'Mounted surface',description:'Exact rigid fixture',operations:[{kind:'part',id:'body',partId:'brick-2x4-white',parent:'',parentPort:'',childPort:'',twist:0},{kind:'technique',id:'skin',choiceId:choice.id,parent:'body',parentPort:'stud:0:0',twist:0}]});
it('compiles every handed surface with both mandatory side contacts and no stock mutation',()=>{
 const before=JSON.stringify(stock);
 for(const c of choices){const r=compileTechniques(program(c),stock,choices,c.id);expect(constructionIssues(r.build,stock,24)).toEqual([]);expect(r.program.requiredContacts).toHaveLength(2);expect(r.lockedOperations).toEqual(new Set([1,2]));expect(r.remaining[c.mount]).toBe(stock[c.mount as keyof typeof stock]-1);expect(c.contract.solids.flat().every(p=>p.every(Number.isFinite))).toBe(true);}
 expect(JSON.stringify(stock)).toBe(before);
});
it('never pretends the saved photo inventory has the missing mounting brackets',()=>{
 expect(surfaceChoices(photo.stock)).toEqual([]);
 expect(()=>compileTechniques(program(),photo.stock,[])).toThrow(/unavailable/);
});
it('reserves paired surfaces atomically before any core filler',()=>{
 const c=choices.find(c=>c.face.startsWith('tile'))!,p=program(c);
 p.operations.push({kind:'technique',id:'other',choiceId:c.id,parent:'body',parentPort:'stud:2:0',twist:0});
 const r=compileTechniques(p,stock,choices);
 expect(r.remaining[c.face]).toBe(0);expect(r.program.requiredContacts).toHaveLength(4);
 const parts=r.build.steps.flatMap(s=>s.parts),a=frame(parts[2]).bounds,b=frame(parts[4]).bounds;
 expect(a.max[0]).toBeCloseTo(b.min[0]);expect(a.min[1]).toBeCloseTo(b.min[1]);expect(a.max[2]).toBeCloseTo(b.max[2]);
 expect(()=>expandTechniques(p,{...stock,[c.face]:1},choices)).toThrow(/reserved construction/);
});
it('rejects embedded brackets, damaged closure edges and unknown output aliases',()=>{
 const p=program(),c=choices[0];
 p.operations[0]={...p.operations[0],partId:'plate-2x4-white'} as any;
 expect(()=>compileTechniques(p,{...stock,'plate-2x4-white':1},choices)).toThrow(/ground/);
 const r=compileTechniques(program(c),stock,choices),bad=structuredClone(r.program);bad.requiredContacts![1].bPort='grip:55:55';
 expect(()=>compileConnections(bad,stock)).toThrow(/Required connection/);
 const q=program(c);q.operations.push({kind:'part',id:'detail',partId:'tile-2x2-white',parent:'skin.panel',parentPort:'stud:0:0',childPort:'grip:0:0',twist:0});
 expect(()=>expandTechniques(q,stock,choices)).toThrow(/earlier part/);
});
it('a descendant inherits the mounted face orientation and consumes its own stock',()=>{
 const c=choices.find(c=>c.face==='plate-2x2-black')!,p=program(c);
 p.operations.push({kind:'part',id:'finish',partId:'tile-2x2-white',parent:'skin.face',parentPort:'stud:0:0',childPort:'grip:0:0',twist:0});
 const r=compileTechniques(p,stock,choices),parts=r.build.steps.flatMap(s=>s.parts);
 expect(frame(parts[2]).rotation).toEqual(frame(parts[3]).rotation);expect(r.remaining['tile-2x2-white']).toBe(1);
});
it('straight hulls release truly empty slope space but still reject penetration',()=>{
 const a:Placed={partId:'slope-2x2-white',x:0,y:0,z:0,rot:0};
 const b:Placed={partId:'cheese-1x1-white',x:0,y:0,z:2,rot:0,orientation:axisAngle([1,0,0],180)};
 const have={[a.partId]:1,[b.partId]:1};
 const check=(parts:Placed[])=>validateConnections({name:'Hull',description:'Geometric isolation',engine:'connections-v2',steps:[{caption:'',parts}]} as Build,have).filter(i=>i.kind==='overlap');
 expect(frame(a).bounds.max[2]).toBeGreaterThan(frame(b).bounds.min[2]);
 expect(check([a,b])).toEqual([]);
 expect(check([a,{...b,z:1}]).length).toBeGreaterThan(0);
});
it('recovers arbitrary attachment twists in inherited sideways frames without snapping',()=>{
 const parent:Placed={partId:'sidebrick-1x1-white',x:3,y:4,z:5,rot:0,orientation:axisAngle([1,1,1],29)};
 for(const turn of [0,90,-90,37.125,-22.619864948]){
  const child=attachPart(parent,'side:0','plate-1x2-white','grip:0:0',turn);
  expect(attachmentTwist(parent,'side:0',child,'grip:0:0')).toBeCloseTo(turn,7);
 }
 expect(attachmentTwist(parent,'stud:0:0',attachPart(parent,'side:0','plate-1x2-white','grip:0:0',31),'grip:0:0')).toBeNull();
});
it('offers alternate support colors so one scarce bracket does not limit every surface',()=>{
 const have={'brick-2x4-white':1,'tile-2x2-white':2,'bracket-1x2-white':1,'bracket-1x2-light-gray':1};
 const options=surfaceChoices(have);expect(options).toHaveLength(2);expect(new Set(options.map(c=>c.id)).size).toBe(2);
 const p=program(options[0]);p.operations.push({kind:'technique',id:'other',choiceId:options[1].id,parent:'body',parentPort:'stud:2:0',twist:0});
 expect(compileTechniques(p,have,options).build.steps).toHaveLength(5);
 expect(surfaceChoices({'bracket-1x2-invalid-color':3,'tile-2x2-white':2})).toEqual([]);
});
