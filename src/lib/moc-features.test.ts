import { describe, expect, it } from 'vitest';
import { FEATURE_STUDIES, FEATURE_VARIANTS, featureChoices, featureCost, featureProgram, studyFixture } from './moc-features';
import { applyFeaturePatch, type FeaturePatch } from './moc-feature-edit';
import { compileConnections, frame, validateConnections } from './connections';
import type { Build } from './bricks';

describe('MOC feature studies',()=>{
  it('has twenty-three distinct studies with working before/after instructions, including complete object features',()=>{
    expect(new Set(FEATURE_STUDIES.map(s=>s.id)).size).toBe(23);
    for(const group of ['head','transition','wing','pose'])expect(FEATURE_STUDIES.filter(s=>s.group===group)).toHaveLength(5);
    expect(FEATURE_STUDIES.filter(s=>s.group==='object')).toHaveLength(3);
    for(const study of FEATURE_STUDIES)for(const variant of ['before','after'] as const){
      const b=studyFixture(study,variant),p=featureProgram(study,'white','black',variant);
      expect(validateConnections(b,featureCost(p))).toEqual([]);
      expect(study.alternatives.every(id=>FEATURE_STUDIES.some(s=>s.id===id))).toBe(true);
    }
  });
  it('keeps exact recipe transforms through quarter-turn composition and serialization',()=>{
    for(const study of FEATURE_STUDIES)for(const rootRotation of [0,90,180,270]){
      const p={...featureProgram(study,'white','black'),rootRotation};
      const b=compileConnections(JSON.parse(JSON.stringify(p)),featureCost(p));
      expect(validateConnections(b,featureCost(p))).toEqual([]);
    }
    const turned=studyFixture(FEATURE_STUDIES.find(s=>s.id==='turned-head')!,'after');
    expect(frame(turned.steps[2].parts[0]).rotation.some(n=>n!==0&&Math.abs(n)!==1)).toBe(true);
  });
  it('only offers complete feasible recipes and reserves paired features as a unit',()=>{
    const stock={'plate-1x4-white':1,'cheese-1x1-white':1};
    expect(featureChoices(stock).some(c=>c.studyId==='separated-ears')).toBe(false);
    const two={...stock,'cheese-1x1-white':2};
    expect(featureChoices(two).some(c=>c.studyId==='separated-ears')).toBe(true);
    expect(featureChoices(two,'ears',['black'])).toEqual([]);
    expect(stock['cheese-1x1-white']).toBe(1);
  });
  it('compiles alternate constructions at every quarter turn and charges all color roles',()=>{
    for(const v of FEATURE_VARIANTS){
      const program={name:v.name,description:v.lesson,operations:v.parts.map(({shape,color,...op})=>({...op,partId:`${shape}-${color==='accent'?'black':'white'}`}))};
      for(const rootRotation of [0,90,180,270])expect(validateConnections(compileConnections({...program,rootRotation},featureCost(program)),featureCost(program))).toEqual([]);
    }
    const mixed={'plate-2x2-azure':1,'curve-1x2-azure':2,'plate-1x2-black':2,'plate-1x2-bright-light-orange':1};
    const head=featureChoices(mixed,'kingfisher',undefined,100).find(c=>c.variant==='curved-bird-head'&&c.accent==='black');
    expect(head?.cost).toEqual(mixed);
    expect(featureChoices({...mixed,'plate-1x2-black':1},'kingfisher',undefined,100).some(c=>c.variant==='curved-bird-head'&&c.accent==='black')).toBe(false);
    expect(featureChoices(mixed,'kingfisher',['azure','black'],100).some(c=>c.variant==='curved-bird-head')).toBe(false);
    const centeredStock={...mixed,'plate-1x2-bright-light-orange':2,'jumper-1x2-medium-blue':1};
    const centered=featureChoices(centeredStock,'kingfisher',undefined,150).find(c=>c.variant==='centered-bird-head'&&c.accent==='black');
    expect(centered?.cost).toEqual(centeredStock);expect(centered?.connector).toBe('medium-blue');
    const b=compileConnections(centered!.program,centeredStock),parts=b.steps.flatMap(s=>s.parts);
    const midX=(i:number)=>{const f=frame(parts[i]);return (f.bounds.min[0]+f.bounds.max[0])/2;};
    expect(midX(2)).toBe(midX(0));expect(midX(7)).toBe(midX(0));
    expect(featureChoices({...centeredStock,'jumper-1x2-medium-blue':0},'kingfisher',undefined,150).some(c=>c.variant==='centered-bird-head')).toBe(false);
  });
  it('requires the second anchor even when the swept panel is otherwise connected',()=>{
    const study=FEATURE_STUDIES.find(s=>s.id==='swept-wing')!;
    const p=featureProgram(study,'white'),b=studyFixture(study,'after');
    b.steps[2].parts[0].x+=1;
    expect(validateConnections(b,featureCost(p)).some(i=>i.message.includes('Required'))).toBe(true);
  });
});

const stock={'plate-2x2-white':22,'slope-2x2-white':1};
const base:Build={name:'Fixture',description:'A capability fixture, not an appearance result',steps:Array.from({length:20},(_,z)=>({caption:'Layer',parts:[{partId:'plate-2x2-white',x:2,y:2,z,rot:0}]}))};
const choices=featureChoices(stock),muzzle=choices.find(c=>c.studyId==='pointed-muzzle')!;
const patch:FeaturePatch={focus:'Taper the top',remove:[],add:[{id:'muzzle',choiceId:muzzle.id,parent:'p19',parentPort:'stud:0:0',childPort:'grip:0:0',twist:0}]};

describe('atomic feature replacements',()=>{
  it('uses actual stock and leaves every surrounding placement unchanged',()=>{
    const snapshot=JSON.stringify({base,stock}),r=applyFeaturePatch(base,patch,stock,choices);
    expect(r.build.engine).toBe('connections-v2');expect(r.added).toBe(2);
    expect(validateConnections(r.build,stock)).toEqual([]);
    const parts=r.build.steps.flatMap(s=>s.parts);
    for(const p of base.steps.flatMap(s=>s.parts))expect(parts).toContainEqual(p);
    expect(JSON.stringify({base,stock})).toBe(snapshot);
    expect(r.receipts[0].studyId).toBe('pointed-muzzle');
    expect(()=>applyFeaturePatch(r.build,{...patch,remove:[20,21]},stock,choices)).toThrow(/same geometry/);
    r.build.steps.forEach((step,i)=>{if(i){const parent=Number(/step (\d+)/.exec(step.caption)?.[1]);expect(parent).toBeGreaterThan(0);expect(parent).toBeLessThanOrEqual(i);}});
  });
  it('rejects stock overuse, collisions, unsupported retained pieces and excessive deletions atomically',()=>{
    const snapshot=JSON.stringify(base);
    expect(()=>applyFeaturePatch(base,patch,{...stock,'slope-2x2-white':0},choices)).toThrow(/bucket/);
    expect(()=>applyFeaturePatch(base,{...patch,add:[{...patch.add[0],parent:'p18'}]},stock,choices)).toThrow(/overlap|connector/);
    expect(()=>applyFeaturePatch(base,{focus:'Remove a support',remove:[10],add:[]},stock,choices,10)).toThrow(/disconnected/);
    expect(()=>applyFeaturePatch(base,{...patch,remove:Array.from({length:8},(_,i)=>i)},stock,choices)).toThrow(/35%/);
    expect(JSON.stringify(base)).toBe(snapshot);
  });
  it('can refund a removed cap without moving the retained model',()=>{
    const capped=structuredClone(base);capped.steps.push({caption:'Old cap',parts:[{partId:'slope-2x2-white',x:2,y:2,z:20,rot:0}]});
    const r=applyFeaturePatch(capped,{...patch,remove:[20]},stock,choices);
    expect(r.build.steps.flatMap(s=>s.parts).filter(p=>p.partId==='slope-2x2-white')).toHaveLength(1);
    expect(r.removed).toEqual([20]);
  });
  it('preserves existing required contacts and rejects unsupported invented recipe IDs',()=>{
    const locked={...base,requiredContacts:[{a:0,b:1,aPort:'stud:0:0',bPort:'grip:0:0'}]};
    expect(()=>applyFeaturePatch(locked,{...patch,remove:[1]},stock,choices)).toThrow(/locked/);
    expect(()=>applyFeaturePatch(base,{...patch,add:[{...patch.add[0],choiceId:'invented'}]},stock,choices)).toThrow(/offered/);
  });
});
