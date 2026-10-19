import {beforeAll,describe,expect,it} from 'vitest';
import large from '../fixtures/large-pile-stock.json';
import {authoredWholeAnimalTestLayouts,testBlueprint} from '../../../test/whole-animal-fixtures';
import {composeWholeAnimal} from '../assembly-composer/animal-whole';
import {validateAnimalBlueprint,type AnimalBlueprint} from './animal-blueprint';
import {validateWholeAnimalPlanRevision} from './whole-animal-plan-revision';

let original:AnimalBlueprint;
beforeAll(()=>{original=testBlueprint(composeWholeAnimal(large.stock,authoredWholeAnimalTestLayouts()[0]));});
const proposal=()=>({reason:'Widen structural envelopes to allow actual carriers while retaining exact promised parts.',blueprint:structuredClone(original)});

describe('explicit whole-animal plan revision policy',()=>{
 it('permits a transparent wider geometry/intent/size/proportion/void/max-budget revision without mutating any input',()=>{
  const input=proposal(),head=input.blueprint.regions.find(r=>r.role==='head')!;head.tolerance=1;head.intent='taper';head.exterior=false;
  input.blueprint.description='Explicitly revised flexible design target.';input.blueprint.features[0].description='Same exact parts with an explicit new description.';
  input.blueprint.size.min=[3,8,3];input.blueprint.size.max=[8,20,12];input.blueprint.parts.max=70;
  input.blueprint.proportions.bodyLengthToWidth=[1.3,4];input.blueprint.emptyRegions[0].min[0]=0;input.blueprint.emptyRegions[0].max[0]=4;
  const before=JSON.stringify({original,input,stock:large.stock}),result=validateWholeAnimalPlanRevision(original,input,large.stock,20);
  expect(result.issues).toEqual([]);expect(result.blueprint).toEqual(input.blueprint);expect(result.reason).toBe(input.reason);expect(JSON.stringify({original,input,stock:large.stock})).toBe(before);
  result.blueprint!.regions[0].min[0]++;expect(JSON.stringify({original,input,stock:large.stock})).toBe(before);
 });

 it('can repair an originally impossible small nose to truthful thin without changing its reservation',()=>{
  const base=structuredClone(original);base.features.push({id:'nose-detail',description:'Exact flat black nose and its actual muzzle carrier.',intent:'projecting-muzzle',pairing:'none',pieces:[{partId:'plate-1x2-black',count:1,role:'nose'}],carriers:[{partId:'plate-2x3-tan',count:1,role:'muzzle'}]});
  base.regions.find(r=>r.role==='nose')!.intent='small';expect(validateAnimalBlueprint(base,large.stock).issues.join(' ')).toContain('contradicts small intent');
  const revised=structuredClone(base);revised.regions.find(r=>r.role==='nose')!.intent='thin';
  const result=validateWholeAnimalPlanRevision(base,{reason:'The reserved flat 2-wide nose is thin, while small would falsely cap width at1.5.',blueprint:revised},large.stock,20);
  expect(result.issues).toEqual([]);expect(result.blueprint!.features).toEqual(base.features);expect(base.regions.find(r=>r.role==='nose')!.intent).toBe('small');
 });

 it('repairs old incompatible structural envelopes rather than demanding the old geometry validate first',()=>{
  const base=structuredClone(original),head=base.regions.find(r=>r.role==='head')!,muzzle=base.regions.find(r=>r.role==='muzzle')!;
  head.min[1]=2;head.max[1]=5;head.tolerance=.5;muzzle.min[1]=0;muzzle.max[1]=2;muzzle.tolerance=.5;
  expect(validateAnimalBlueprint(base,large.stock).issues.join(' ')).toContain('muzzle ↔ head');
  const revised=structuredClone(base);for(const r of revised.regions)if(r.role==='head'||r.role==='muzzle')r.tolerance=1;
  expect(validateWholeAnimalPlanRevision(base,{reason:'Expand structural tolerances to permit a real integer-grid muzzle landing.',blueprint:revised},large.stock,20).issues).toEqual([]);
 });

 it('accepts reordered palette/features/reservation entries and equivalent exact physical count grouping',()=>{
  const input=proposal();for(const colors of Object.values(input.blueprint.palette))colors.reverse();input.blueprint.features.reverse();
  for(const f of input.blueprint.features){f.pieces.reverse();f.carriers.reverse();}
  const eyes=input.blueprint.features.find(f=>f.id==='eyes')!,carrier=eyes.carriers[0];eyes.carriers=[{...carrier,count:1},{...carrier,count:1}];
  expect(validateWholeAnimalPlanRevision(original,input,large.stock,20).issues).toEqual([]);
 });

 it('allows an explicit support-mode revision while retaining protected exact bindings and rejecting invalid modes',()=>{
  const base=structuredClone(original);base.features[0].carriers[0].shared='crown';
  for(const mode of ['anatomy','reserved-only',undefined] as const) {
   const input={reason:'Use actual stock-billed head bridges while retaining every exact reserved feature and carrier.',blueprint:structuredClone(base)};
   if(mode)input.blueprint.features[0].supportMode=mode;else delete input.blueprint.features[0].supportMode;
   const before=JSON.stringify({base,input}),result=validateWholeAnimalPlanRevision(base,input,large.stock,20);
   expect(result.issues).toEqual([]);expect(result.blueprint!.features[0].supportMode).toBe(mode);expect(result.blueprint!.features[0].carriers).toEqual(base.features[0].carriers);expect(JSON.stringify({base,input})).toBe(before);
  }
  const anatomy=structuredClone(base);anatomy.features[0].supportMode='anatomy';
  expect(validateWholeAnimalPlanRevision(anatomy,{reason:'Restore reserved-only support.',blueprint:base},large.stock,20).issues).toEqual([]);
  for(const change of ['token','count','role','piece'] as const) {
   const revised=structuredClone(anatomy);
   if(change==='token')revised.features[0].carriers[0].shared='changed-crown';
   if(change==='count')revised.features[0].carriers[0].count=2;
   if(change==='role')revised.features[0].carriers[0].role='frame';
   if(change==='piece')revised.features[0].pieces[0].partId='slope-2x2-white';
   expect(validateWholeAnimalPlanRevision(base,{reason:'Mode edit cannot authorize binding edits.',blueprint:revised},large.stock,20).issues.join(' ')).toContain('reservation multiset');
  }
  (anatomy.features[0] as unknown as Record<string,unknown>).supportMode='whole-model';expect(validateWholeAnimalPlanRevision(base,{reason:'Invalid support-mode promise.',blueprint:anatomy},large.stock,20).issues.join(' ')).toContain('supportMode must be');
 });

 it('preserves exact identity, canonical subject, stance and original minimum even if a change would otherwise be valid',()=>{
  for(const [field,value]of [['id','different-plan'],['subject','Dog'],['stance','crouching']] as const) {
   const input=proposal();(input.blueprint as unknown as Record<string,unknown>)[field]=value;
   const result=validateWholeAnimalPlanRevision(original,input,large.stock,20);expect(result.blueprint).toBeNull();expect(result.issues.some(i=>i.includes(field==='stance'?'original stance':'original id'))).toBe(true);
  }
  for(const minimum of [19,21,30]) {const input=proposal();input.blueprint.parts.min=minimum;expect(validateWholeAnimalPlanRevision(original,input,large.stock,20).issues.join(' ')).toContain('exact original parts.min');}
  expect(validateWholeAnimalPlanRevision(original,proposal(),large.stock,21).issues.join(' ')).toContain('below the requested minimum 21');
 });

 it('rejects palette additions, removals and role transfers even when the resulting union remains coherent',()=>{
  for(const mutate of [
   (b:AnimalBlueprint)=>{b.palette.coat.push('dark-brown');},
   (b:AnimalBlueprint)=>{b.palette.accent.pop();},
   (b:AnimalBlueprint)=>{b.palette.coat=b.palette.coat.filter(c=>c!=='medium-nougat');b.palette.accent=['medium-nougat','tan','white'];},
  ]) {const input=proposal();mutate(input.blueprint);expect(validateWholeAnimalPlanRevision(original,input,large.stock,20).issues.join(' ')).toContain('palette sets');}
 });

 it('rejects changed feature id/intent/pairing, exact ID/count/role, piece-carrier transfer and missing features',()=>{
  for(const mutate of [
   (b:AnimalBlueprint)=>{b.features[0].id='renamed';},
   (b:AnimalBlueprint)=>{b.features[0].intent='contoured-body';},
   (b:AnimalBlueprint)=>{b.features[0].pairing='same-shape';},
   (b:AnimalBlueprint)=>{b.features[0].pieces[0].partId='slope-2x2-white';},
   (b:AnimalBlueprint)=>{b.features[0].pieces[0].count=2;},
   (b:AnimalBlueprint)=>{b.features[0].pieces[0].role='head';},
   (b:AnimalBlueprint)=>{b.features[0].carriers[0].partId='plate-2x4-reddish-brown';},
   (b:AnimalBlueprint)=>{const p=b.features[0].pieces.pop()!;b.features[0].carriers.push(p);},
   (b:AnimalBlueprint)=>{b.features.pop();},
  ]) {const input=proposal();mutate(input.blueprint);const result=validateWholeAnimalPlanRevision(original,input,large.stock,20);expect(result.blueprint).toBeNull();expect(result.issues.join(' ')).toContain('reservation multiset');}
 });

 it('requires an explicit bounded reason and a complete globally valid revised blueprint',()=>{
  for(const reason of [undefined,null,42,'','  ','a'.repeat(601)]) {const result=validateWholeAnimalPlanRevision(original,{reason,blueprint:original},large.stock,20);expect(result.blueprint).toBeNull();expect(result.issues.join(' ')).toContain('Revision reason');}
  const input=proposal();input.blueprint.regions.find(r=>r.role==='head')!.tolerance=1.1;expect(validateWholeAnimalPlanRevision(original,input,large.stock,20).issues.join(' ')).toContain('0–1 stud tolerance');
  expect(validateWholeAnimalPlanRevision(original,{reason:'Valid reason but no blueprint.'},large.stock,20).blueprint).toBeNull();
  expect(validateWholeAnimalPlanRevision(original,proposal(),{...large.stock,'slope-2x2-black':1},20).issues.join(' ')).toContain('shared ledger');
 });

 it('fails closed for malformed protected originals and malformed requested minimum, without throwing or repairing them',()=>{
  for(const base of [null,{...original,features:null},{...original,palette:{...original.palette,coat:[]}},{...original,parts:{...original.parts,min:NaN}}]) {
   expect(()=>validateWholeAnimalPlanRevision(base as AnimalBlueprint,proposal(),large.stock,20)).not.toThrow();expect(validateWholeAnimalPlanRevision(base as AnimalBlueprint,proposal(),large.stock,20).blueprint).toBeNull();
  }
  for(const minParts of [NaN,Infinity,20.5,-1,81])expect(validateWholeAnimalPlanRevision(original,proposal(),large.stock,minParts).blueprint).toBeNull();
 });

 it('is a pure policy check with no hidden revision counter, no silent geometry rewrite and sanitized output',()=>{
  const input={...proposal(),reason:'  Explicit unchanged valid target.  ',ignored:'discard'};const before=JSON.stringify(input);
  for(let i=0;i<3;i++) {const result=validateWholeAnimalPlanRevision(original,input,large.stock,20);expect(result.issues).toEqual([]);expect(result.reason).toBe('Explicit unchanged valid target.');expect(result.blueprint).toEqual(original);expect(result).not.toHaveProperty('ignored');}
  expect(JSON.stringify(input)).toBe(before);
 });

 it('preserves exact shared carrier tokens as protected physical bindings during revisions',()=>{
  const base=structuredClone(original);base.features[0].carriers[0].shared='crown';
  base.features.push({id:'skull-core',description:'Actual brick shares the exact crown carrier.',intent:'contoured-body',pairing:'none',pieces:[{partId:'brick-1x2-reddish-brown',count:1,role:'head'}],carriers:[{partId:'plate-1x4-reddish-brown',count:1,role:'head',shared:'crown'}]});
  const revised=structuredClone(base);revised.regions.find(r=>r.role==='head')!.tolerance=1;
  const result=validateWholeAnimalPlanRevision(base,{reason:'Widen head envelope; keep the same shared physical crown.',blueprint:revised},large.stock,20);
  expect(result.issues).toEqual([]);expect(result.blueprint!.features[2].carriers[0].shared).toBe('crown');
  for(const mode of ['remove','rename','split'] as const) {
   const changed=structuredClone(revised);
   if(mode==='remove')for(const f of changed.features)for(const p of f.carriers)delete p.shared;
   if(mode==='rename')for(const f of changed.features)for(const p of f.carriers)if(p.shared)p.shared='renamed-crown';
   if(mode==='split')changed.features[2].carriers[0].shared='second-crown';
   expect(validateWholeAnimalPlanRevision(base,{reason:'Attempted binding change.',blueprint:changed},large.stock,20).issues.join(' ')).toContain('shared bindings');
  }
  const added=structuredClone(original);added.features[0].carriers[0].shared='new-binding';
  expect(validateWholeAnimalPlanRevision(original,{reason:'Attempted new binding.',blueprint:added},large.stock,20).issues.join(' ')).toContain('shared bindings');
 });
});
