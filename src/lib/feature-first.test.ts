import { describe,expect,it } from 'vitest';
import { compileFeatureBody,reserveFeature,simplifyFeatureBody,type FeatureBody,type FeaturePlan } from './feature-first';
import { featureChoices } from './moc-features';
import { frame,validateConnections } from './connections';

const stock={'plate-2x2-white':1,'curve-2x2-white':1,'plate-1x2-white':18};
const choice=featureChoices(stock).find(c=>c.studyId==='rounded-muzzle'&&c.program.operations[0].partId==='plate-2x2-white')!;
const plan:FeaturePlan={choiceId:choice.id,rotation:0,pose:'Upright',traits:['Rounded head','Narrow body'],bodySize:[4,4,6],colors:['white']};
const body:FeatureBody={reasoning:'Structural capability fixture, not a design-quality example.',parts:Array.from({length:18},(_,i)=>({partId:'plate-1x2-white',x:0,y:i%2,z:-1-Math.floor(i/2),rot:0,role:'Support'}))};
describe('feature-first stock and geometry contract',()=>{
  it('protects an actual open working bay while allowing small functional details',()=>{
    const pile={'plate-2x4-white':2,'brick-2x2-white':4,'curve-1x2-white':2,'roundbrick-1x1-white':2,'plate-1x2-white':16};
    const c=featureChoices(pile).find(c=>c.studyId==='open-working-bay')!;
    const seed=reserveFeature(c,{choiceId:c.id,rotation:0,pose:'Countertop',traits:['Open working bay','Overhanging head'],bodySize:[4,4,10],colors:['white']},pile);
    const supports=Array.from({length:14},(_,i)=>({partId:'plate-1x2-white',x:0,y:0,z:-i-1,rot:0,role:'Protocol support'}));
    const closed={reasoning:'A legal cabinet fill would erase the defining void.',parts:[...supports,
      {partId:'brick-2x2-white',x:0,y:0,z:1,rot:0,role:'Lower fill'}, {partId:'brick-2x2-white',x:0,y:0,z:4,rot:0,role:'Upper fill'}]};
    expect(()=>compileFeatureBody(seed,closed,pile,'Fixture','')).toThrow(/protected upper working bay/);
    const open={reasoning:'Two small cup depictions preserve the bay.',parts:[...supports,
      {partId:'roundbrick-1x1-white',x:0,y:0,z:1,rot:0,role:'Cup'}, {partId:'roundbrick-1x1-white',x:0,y:1,z:1,rot:0,role:'Cup'}]};
    const r=compileFeatureBody(seed,open,pile,'Fixture','');expect(validateConnections(r.build,pile,24)).toEqual([]);
    const slopedPile={...pile,'plate-2x2-white':2,'slope-2x2-white':1};
    const slopedSeed=reserveFeature(c,seed.plan,slopedPile);
    const sloped={reasoning:'The air above a slope remains part of the working opening.',parts:[...supports,
      {partId:'plate-2x2-white',x:0,y:0,z:1,rot:0,role:'Carrier'}, {partId:'plate-2x2-white',x:0,y:0,z:2,rot:0,role:'Carrier'},
      {partId:'slope-2x2-white',x:0,y:0,z:3,rot:0,role:'Sloped lower surface'}]};
    expect(()=>compileFeatureBody(slopedSeed,sloped,slopedPile,'Fixture','')).not.toThrow();
  });
  it('reserves exact parts, preserves seed geometry and orders instructions from the ground',()=>{
    const original=JSON.stringify(stock),seed=reserveFeature(choice,plan,stock),r=compileFeatureBody(seed,body,stock,'Fixture','Not an aesthetic example');
    expect(seed.remaining['plate-2x2-white']).toBe(0);expect(seed.remaining['curve-2x2-white']).toBe(0);
    expect(validateConnections(r.build,stock,24)).toEqual([]);expect(r.build.steps).toHaveLength(20);expect(JSON.stringify(stock)).toBe(original);
    const ps=r.build.steps.flatMap(s=>s.parts),actual=r.feature.indices.map(i=>frame(ps[i])),before=seed.parts.map(frame);
    expect(actual.map(f=>f.rotation)).toEqual(before.map(f=>f.rotation));
    const shift=actual[0].translation.map((v,i)=>v-before[0].translation[i]);
    actual.forEach((f,i)=>expect(f.translation.map((v,j)=>v-before[i].translation[j])).toEqual(shift));
    r.build.steps.slice(1).forEach((s,i)=>expect(Number(s.caption.match(/step (\d+)/)?.[1])).toBeLessThanOrEqual(i+1));
  });
  it('does not let the body steal reserved parts or mutate reservation on a rejected attempt',()=>{
    const seed=reserveFeature(choice,plan,stock),before=JSON.stringify(seed);
    expect(()=>compileFeatureBody(seed,{...body,parts:[...body.parts,{partId:'plate-2x2-white',x:0,y:0,z:-10,rot:0,role:'Stolen'}]},stock,'x','x')).toThrow(/unavailable after reserving/);
    expect(JSON.stringify(seed)).toBe(before);
  });
  it('rejects collisions, disconnected stock, undersized builds and body scale drift',()=>{
    const seed=reserveFeature(choice,plan,stock),changed=structuredClone(body);changed.parts[0].z=0;
    expect(()=>compileFeatureBody(seed,changed,stock,'x','x')).toThrow(/overlap/);
    changed.parts[0]={...body.parts[0],x:3};expect(()=>compileFeatureBody(seed,changed,stock,'x','x')).toThrow(/envelope|Disconnected/);
    expect(()=>compileFeatureBody(seed,{...body,parts:body.parts.slice(1)},stock,'x','x')).toThrow(/20–80/);
    expect(()=>reserveFeature(choice,{...plan,bodySize:[22,4,6]},stock)).toThrow(/extent/);
  });
  it('may omit a faulty extra piece, but cannot alter the seed or shrink below twenty parts',()=>{
    const seed=reserveFeature(choice,plan,stock),extra={...body,parts:[...body.parts,{...body.parts[0],role:'Invalid duplicate'}]};
    const r=simplifyFeatureBody(seed,extra,stock,'x','x');expect(r?.removed).toHaveLength(1);expect(r?.construction.build.steps).toHaveLength(20);
    expect(validateConnections(r!.construction.build,stock,24)).toEqual([]);
    const broken=structuredClone(body);broken.parts[0].z=0;
    expect(simplifyFeatureBody(seed,broken,stock,'x','x')).toBeNull();
  });
});
