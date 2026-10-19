import { beforeAll, describe, expect, it } from 'vitest';
import large from '../fixtures/large-pile-stock.json';
import small from '../fixtures/small-pile-stock.json';
import medium from '../fixtures/atlas-photo-pile-20261013-stock.json';
import { authoredWholeAnimalTestLayouts, testBlueprint } from '../../../test/whole-animal-fixtures';
import { composeWholeAnimal } from '../assembly-composer/animal-whole';
import { connectionPairs, frame, solidContains } from '../connections';
import {
  ANIMAL_BLUEPRINT_SCHEMA, animalBlueprintBodiesDiffer, animalBlueprintIssues, animalBlueprintText,
  validateAnimalBlueprint, uniqueAnimalReservations, type AnimalBlueprint, type AnimalBlueprintComposition, type AnimalBlueprintFeature,
  type AnimalBlueprintRole, type AnimalBlueprintRoleIndices,
} from './animal-blueprint';

let fixtures: { c:AnimalBlueprintComposition; b:AnimalBlueprint }[];
beforeAll(()=>{ fixtures=authoredWholeAnimalTestLayouts().map(layout=>{const c=composeWholeAnimal(large.stock,layout);return {c,b:testBlueprint(c)};}); });
const clone=(i=0)=>structuredClone(fixtures[i]);
const all=(c:AnimalBlueprintComposition)=>c.build.steps.flatMap(s=>s.parts);
const own=(c:AnimalBlueprintComposition):AnimalBlueprintRoleIndices=>{
  const result:AnimalBlueprintRoleIndices={};
  for(const r of c.receipts)(result[r.role as AnimalBlueprintRole]??=[]).push(...r.indices);
  return result;
};
const muzzleFeature=(wide=false):AnimalBlueprintFeature=>({id:'layered-muzzle',description:'Actual nose and layered tapered muzzle surface on a reserved base.',intent:'projecting-muzzle',pairing:'none',
  pieces:[{partId:'plate-1x2-black',count:1,role:'nose'},{partId:'plate-1x2-tan',count:1,role:'muzzle'},{partId:'plate-1x2-reddish-brown',count:1,role:'muzzle'},{partId:'tile-1x2-tan',count:1,role:'muzzle'}],
  carriers:[{partId:wide?'plate-2x4-reddish-brown':'plate-2x3-tan',count:1,role:'muzzle'}]});
const sharedCrown=()=>{
  const f=clone(1);f.b.features[0].carriers[0].shared='crown';
  f.b.features.push({id:'skull-core',description:'Actual central skull brick also joins the existing crown plate.',intent:'contoured-body',pairing:'none',pieces:[{partId:'brick-1x2-reddish-brown',count:1,role:'head'}],carriers:[{partId:'plate-1x4-reddish-brown',count:1,role:'head',shared:'crown'}]});
  return f;
};
const crownSupportedEyes=()=>{
  const f=clone(1);f.b.features[0].carriers[0].shared='crown';
  f.b.features[1].carriers=[{...f.b.features[0].carriers[0]}];
  return f;
};

describe('editable whole-animal blueprint planning',()=>{
  it('uses provider-compatible schema with runtime bounds rather than unsupported schema keywords',()=>{
    const inspect=(v:unknown)=>{if(v&&typeof v==='object')for(const [key,value] of Object.entries(v)){expect(['minItems','maxItems'].includes(key)).toBe(false);if(key==='enum')expect((value as unknown[]).every(x=>typeof x==='string')).toBe(true);inspect(value);}};
    inspect(ANIMAL_BLUEPRINT_SCHEMA);
    const properties=ANIMAL_BLUEPRINT_SCHEMA.properties.features.items.properties;
    expect(properties.carriers.items.properties).toHaveProperty('shared');expect(properties.carriers.items.required).not.toContain('shared');expect(properties.pieces.items.properties).not.toHaveProperty('shared');
    expect(properties.supportMode.enum).toEqual(['reserved-only','anatomy']);expect(ANIMAL_BLUEPRINT_SCHEMA.properties.features.items.required).not.toContain('supportMode');
  });

  it('sanitizes independent plans, reserves one exact ledger before body construction and leaves inputs immutable',()=>{
    for(const {b} of fixtures) {
      const input={...structuredClone(b),ignored:'remove'},stock={...large.stock},before=JSON.stringify({input,stock});
      const checked=validateAnimalBlueprint(input,stock);
      expect(checked.issues).toEqual([]);expect(checked.blueprint).toEqual(b);expect(checked.blueprint).not.toHaveProperty('ignored');
      expect(checked.reservations!.total['slope-2x2-black']).toBe(2);
      for(const [id,count] of Object.entries(checked.reservations!.total))expect(checked.reservations!.remaining[id]).toBe(stock[id as keyof typeof stock]-count);
      expect(checked.reservations!.bodyAvailable).toBeGreaterThanOrEqual(5);expect(JSON.stringify({input,stock})).toBe(before);
      checked.blueprint!.regions[0].min[0]++;expect(input.regions[0].min).toEqual(b.regions[0].min);
    }
  });

  it('reports palette and incorrect paired roles in the same repair response',()=>{
    const {b}=clone();b.palette.coat=['reddish-brown','dark-brown','medium-nougat','orange','dark-orange'];
    b.features[0].pieces=[{partId:'slope-2x2-black',count:2,role:'ear-left'}];
    const result=validateAnimalBlueprint(b,large.stock);expect(result.blueprint).toBeNull();
    expect(result.issues.some(s=>s.includes('Palette'))).toBe(true);expect(result.issues.some(s=>s.includes('count1 in each separate role'))).toBe(true);
    expect(result.issues.some(s=>s.includes('both ears'))).toBe(true);
  });

  it('explains mixed face reservations must use pairing none or separate the eyes',()=>{
    const {b}=clone();b.features[1].pieces.push({partId:'plate-1x2-black',count:1,role:'nose'});
    expect(validateAnimalBlueprint(b,large.stock).issues.join(' ')).toContain('mixed nose + eyes');
    b.features[1].pairing='none';expect(validateAnimalBlueprint(b,large.stock).issues).toEqual([]);
  });

  it('does not turn generic two-piece counts into universal identical-pair requirements',()=>{
    const {b}=clone();b.features.push(muzzleFeature());expect(validateAnimalBlueprint(b,large.stock).issues).toEqual([]);
    b.features[2].pairing='same-shape';expect(validateAnimalBlueprint(b,large.stock).issues.join(' ')).toContain('exactly two compatible pieces');
  });

  it('rejects unknown IDs, unsupported wheel physics, malformed counts and missing carrier ports',()=>{
    for(const id of ['invented-1x2-black','brick-3x99-black','wheels-2x2-black']) {
      const {b}=clone();b.features[0].pieces[0].partId=id;
      expect(validateAnimalBlueprint(b,{...large.stock,[id]:2}).issues.join(' ')).toContain('unsupported');
    }
    for(const count of [0,-1,1.5,NaN,Infinity,81]) {
      const {b}=clone();b.features[0].pieces[0].count=count;
      expect(validateAnimalBlueprint(b,large.stock).blueprint).toBeNull();
    }
    const {b}=clone();b.features[0].carriers=[{partId:'tile-2x2-reddish-brown',count:1,role:'head'}];
    expect(validateAnimalBlueprint(b,large.stock).issues.join(' ')).toContain('no real stud/grip capability');
    expect(validateAnimalBlueprint(fixtures[0].b,{...large.stock,'brick-1x1-black':-1}).blueprint).toBeNull();
  });

  it('fails exact scarcity and cross-feature carrier spending without borrowing unsupported stock',()=>{
    const {b}=clone();expect(validateAnimalBlueprint(b,{...large.stock,'slope-2x2-black':1}).issues.join(' ')).toContain('shared ledger');
    b.features[1].carriers=[...b.features[0].carriers];
    expect(validateAnimalBlueprint(b,{...large.stock,'plate-1x4-reddish-brown':1}).issues.join(' ')).toContain('double-spent');
    const text=animalBlueprintText({...large.stock,'unsupported-1x1-black':100});expect(text).not.toContain('unsupported-1x1-black');
  });

  it('retains a meaningful studded body reserve and honestly rejects smaller incompatible piles',()=>{
    const {b}=clone(),onlyFeatures=validateAnimalBlueprint(b,large.stock).reservations!.total;
    expect(validateAnimalBlueprint(b,onlyFeatures).issues.join(' ')).toContain('body supply');
    for(const stock of [small.stock,medium])expect(validateAnimalBlueprint(b,stock).blueprint).toBeNull();
  });

  it('collects safely checkable errors for malformed independent structures without throwing',()=>{
    const {b}=clone();const bad={...b,palette:null,regions:null,parts:null,size:null,proportions:null,emptyRegions:null,features:[null,b.features[0]]};
    expect(()=>validateAnimalBlueprint(bad,large.stock)).not.toThrow();expect(validateAnimalBlueprint(bad,large.stock).issues.length).toBeGreaterThanOrEqual(7);
  });

  it('validates and copies optional support mode without changing exact physical costs or default semantics',()=>{
    const {b}=clone(),baseline=validateAnimalBlueprint(b,large.stock);expect(baseline.blueprint!.features[0]).not.toHaveProperty('supportMode');
    b.features[0].supportMode='anatomy';b.features[1].supportMode='reserved-only';const before=JSON.stringify(b),result=validateAnimalBlueprint(b,large.stock);
    expect(result.issues).toEqual([]);expect(result.blueprint!.features[0].supportMode).toBe('anatomy');expect(result.reservations!.features[0].supportMode).toBe('anatomy');
    expect(result.reservations!.total).toEqual(baseline.reservations!.total);expect(result.reservations!.remaining).toEqual(baseline.reservations!.remaining);expect(uniqueAnimalReservations(result.blueprint!)).toEqual(uniqueAnimalReservations(baseline.blueprint!));
    result.blueprint!.features[0].supportMode='reserved-only';expect(JSON.stringify(b)).toBe(before);
    for(const invalid of ['head','ANATOMY','',null,undefined,1]) {
      const input=structuredClone(b);(input.features[0] as unknown as Record<string,unknown>).supportMode=invalid;
      expect(validateAnimalBlueprint(input,large.stock).issues.join(' ')).toContain('supportMode must be');
    }
    const text=animalBlueprintText(large.stock);for(const phrase of ['defaults to "reserved-only"','supportMode:"anatomy"','authoritative anatomy role','stock-billed','intermediate-only','explicit revision may change supportMode'])expect(text).toContain(phrase);
  });

  it('accepts a larger declared belly box by meaningful central-corridor intersection',()=>{
    const {b}=clone();
    for(const r of b.regions) {
      if(r.role==='leg-front-left'){r.min=[0,4,0];r.max=[1,6,2];}
      if(r.role==='leg-front-right'){r.min=[3,4,0];r.max=[4,6,2];}
      if(r.role==='leg-rear-left'){r.min=[0,10,0];r.max=[1,12,2];}
      if(r.role==='leg-rear-right'){r.min=[3,10,0];r.max=[4,12,2];}
    }
    b.emptyRegions=[{id:'broad-belly',min:[0,6,0],max:[4,10,2]}];expect(validateAnimalBlueprint(b,large.stock).issues).toEqual([]);
    b.emptyRegions[0]={id:'tiny-belly',min:[1,6,0],max:[1.1,10,2]};expect(validateAnimalBlueprint(b,large.stock).issues.join(' ')).toContain('central open belly corridor');
  });

  it('counts tail/body geometry as diversity while ignoring head, neck, labels and paint alone',()=>{
    const a=fixtures[0].b,b=structuredClone(a);b.id='new-label';b.description='Changed text';b.palette.coat=['orange'];
    for(const r of b.regions.filter(r=>r.role==='head'||r.role==='neck'))r.max[0]++;
    expect(animalBlueprintBodiesDiffer(a,b)).toBe(false);
    b.regions.find(r=>r.role==='tail')!.max[1]++;expect(animalBlueprintBodiesDiffer(a,b)).toBe(true);
    expect(animalBlueprintBodiesDiffer(fixtures[0].b,fixtures[1].b)).toBe(true);
    const translated=structuredClone(a);translated.regions.forEach(r=>{r.min[0]+=2;r.max[0]+=2;r.min[1]+=3;r.max[1]+=3;});
    expect(animalBlueprintBodiesDiffer(a,translated)).toBe(false);
  });

  it('gives bounded explicit palette, paired-role and induced-contact instructions without complete fixture examples',()=>{
    const text=animalBlueprintText(large.stock);for(const phrase of ['1–3 distinct','ONE family','count1 EACH','pairing:"none"','THROUGH','no unreserved parts','conservative nominal boxes','not measured exposed shape','REAL CARRIERS','1-stud tolerance','broad positive overall size','not disjoint artistic zones'])expect(text).toContain(phrase);
    expect(text).not.toContain('test-compact');expect(text).not.toContain('test-wide');
  });

  it('rejects the real half-tolerance disjoint muzzle/head plan on integer stock, while tolerance1 remains an editable valid target',()=>{
    const {b,c}=clone(),head=b.regions.find(r=>r.role==='head')!,muzzle=b.regions.find(r=>r.role==='muzzle')!;
    head.min[1]=2;head.max[1]=5;head.tolerance=.5;muzzle.min[1]=0;muzzle.max[1]=2;muzzle.tolerance=.5;
    const before=JSON.stringify(b),result=validateAnimalBlueprint(b,large.stock);
    expect(result.blueprint).toBeNull();expect(result.issues.join(' ')).toContain('muzzle ↔ head');expect(result.issues.join(' ')).toContain('1-stud grid');expect(JSON.stringify(b)).toBe(before);
    head.tolerance=1;muzzle.tolerance=1;expect(validateAnimalBlueprint(b,large.stock).issues).toEqual([]);expect(animalBlueprintIssues(c,b,large.stock)).toEqual([]);
  });

  it('rejects a tail partition touching the hips boundary when neither hips nor torso has a one-stud landing',()=>{
    const {b,c}=clone(),hips=b.regions.find(r=>r.role==='hips')!,tail=b.regions.find(r=>r.role==='tail')!;
    tail.min[1]=hips.max[1];tail.tolerance=.5;hips.tolerance=.5;
    expect(validateAnimalBlueprint(b,large.stock).issues.join(' ')).toContain('tail ↔ hips or torso');
    tail.tolerance=1;hips.tolerance=1;expect(validateAnimalBlueprint(b,large.stock).issues).toEqual([]);expect(animalBlueprintIssues(c,b,large.stock)).toEqual([]);
  });

  it('uses actual supported offset availability for the conservative grid, without fabricating a geometry proof',()=>{
    const {b}=clone(),head=b.regions.find(r=>r.role==='head')!,muzzle=b.regions.find(r=>r.role==='muzzle')!;
    head.min[1]=2;head.max[1]=5;head.tolerance=.5;muzzle.min[1]=0;muzzle.max[1]=2;muzzle.tolerance=.5;
    expect(validateAnimalBlueprint(b,{...large.stock,'jumper-1x2-tan':1}).issues).toEqual([]);
    expect(animalBlueprintText({...large.stock,'jumper-1x2-tan':1})).toContain('possible grid (0.5 studs)');
    expect(validateAnimalBlueprint(b,{...large.stock,'bracket-1x2-white':1}).issues).toEqual([]);
    expect(animalBlueprintText({...large.stock,'bracket-1x2-white':1})).toContain('possible grid (0.1 studs)');
    const noOffsets:Record<string,number>[]=[{'jumper-1x2-tan':0},{'jumper-9x9-tan':5},{'sidebrick-1x1-white':1}];
    for(const extra of noOffsets)expect(validateAnimalBlueprint(b,{...large.stock,...extra}).issues.join(' ')).toContain('muzzle ↔ head');
  });

  it('checks both XY axes for the required direct anatomy pairs without requiring arbitrary feature/carrier direct mates',()=>{
    for(const role of ['nose','eye-left','eye-right','ear-left','ear-right','neck'] as const) {
      const {b}=clone(),r=b.regions.find(v=>v.role===role)!;r.min[0]=12;r.max[0]=14;
      expect(validateAnimalBlueprint(b,large.stock).issues.some(s=>s.includes(`direct ${role} ↔`))).toBe(true);
    }
    const {b}=clone();b.features.push(muzzleFeature());expect(validateAnimalBlueprint(b,large.stock).issues).toEqual([]);
  });

  it('accepts either named neck/tail landing and does not demand direct chest/torso/hips overlap through a real frame',()=>{
    const chestCase=clone(),chest=chestCase.b.regions.find(r=>r.role==='chest')!;
    chest.min[1]=12;chest.max[1]=14;expect(validateAnimalBlueprint(chestCase.b,large.stock).issues).toEqual([]);
    const tailCase=clone(),hips=tailCase.b.regions.find(r=>r.role==='hips')!,torso=tailCase.b.regions.find(r=>r.role==='torso')!;
    hips.min[1]=15;hips.max[1]=17;torso.max[1]=9;expect(validateAnimalBlueprint(tailCase.b,large.stock).issues).toEqual([]);
  });

  it('rejects the real eight-stud tail reservation against a 6.6-by-4 expanded envelope without rewriting either',()=>{
    const {b}=clone(),tail=b.regions.find(r=>r.role==='tail')!;
    tail.max[0]=tail.min[0]+2.4;tail.max[1]=tail.min[1]+5;tail.tolerance=.8;
    b.features.push({id:'tail-span',description:'Actual eight-stud tail panel and its body carrier.',intent:'sweeping-tail',pairing:'none',pieces:[{partId:'plate-2x8-reddish-brown',count:1,role:'tail'}],carriers:[{partId:'brick-2x2-reddish-brown',count:1,role:'tail'}]});
    const before=JSON.stringify(b),result=validateAnimalBlueprint(b,large.stock);
    expect(result.blueprint).toBeNull();expect(result.issues.join(' ')).toContain('reserved plate-2x8-reddish-brown in tail');
    expect(result.issues.join(' ')).toContain('8 × 2 × 0.4');expect(result.issues.join(' ')).toContain('4 × 6.6');expect(JSON.stringify(b)).toBe(before);
  });

  it('accepts the quarter-turn orientation that fits without requiring the part to fit both yaws',()=>{
    const {b}=clone(),tail=b.regions.find(r=>r.role==='tail')!;
    tail.max[0]=tail.min[0]+2;tail.max[1]=tail.min[1]+8;tail.tolerance=0;b.size.max[1]=20;
    b.features.push({id:'long-tail-panel',description:'Eight-stud panel planned along the long tail axis.',intent:'sweeping-tail',pairing:'none',pieces:[{partId:'plate-2x8-reddish-brown',count:1,role:'tail'}],carriers:[{partId:'brick-2x2-reddish-brown',count:1,role:'tail'}]});
    expect(validateAnimalBlueprint(b,large.stock).issues).toEqual([]);
  });

  it('checks actual carrier size as well as feature size and reports it alongside palette and pairing repairs',()=>{
    const {b}=clone();b.features[0].carriers=[{partId:'plate-2x8-reddish-brown',count:1,role:'head'}];
    b.palette.coat=['reddish-brown','orange'];b.features[0].pieces=[{partId:'slope-2x2-black',count:2,role:'ear-left'}];
    const result=validateAnimalBlueprint(b,large.stock);expect(result.issues.some(i=>i.includes('Palette'))).toBe(true);
    expect(result.issues.some(i=>i.includes('count1 in each separate role'))).toBe(true);expect(result.issues.some(i=>i.includes('reserved plate-2x8-reddish-brown in head'))).toBe(true);
  });

  it('checks world-stud height independently of XY footprint and tolerates malformed adjacent reservations safely',()=>{
    const {b}=clone(),nose=b.regions.find(r=>r.role==='nose')!;nose.max[2]=nose.min[2]+.1;nose.tolerance=0;b.features.push(muzzleFeature());
    b.features[2].pieces.push({partId:'unsupported-1x1-black',count:1,role:'nose'});
    const result=validateAnimalBlueprint(b,large.stock);expect(result.issues.some(i=>i.includes('reserved plate-1x2-black in nose'))).toBe(true);
    expect(result.issues.some(i=>i.includes('2 × 1 × 0.4')&&i.includes('2 × 1 × 0.1'))).toBe(true);expect(result.issues.some(i=>i.includes('unsupported'))).toBe(true);
    expect(animalBlueprintText(large.stock)).toContain('Every reserved feature piece AND carrier');
  });

  it('rejects the smoke8 two-wide black nose with small intent but permits its truthful thin intent',()=>{
    const {b,c}=clone(),nose=b.regions.find(r=>r.role==='nose')!;b.features.push(muzzleFeature());nose.intent='small';
    const before=JSON.stringify(b),result=validateAnimalBlueprint(b,large.stock);
    expect(result.blueprint).toBeNull();expect(result.issues.join(' ')).toContain('plate-1x2-black in nose');expect(result.issues.join(' ')).toContain('contradicts small intent');expect(JSON.stringify(b)).toBe(before);
    nose.intent='thin';expect(validateAnimalBlueprint(b,large.stock).issues).toEqual([]);expect(animalBlueprintIssues(c,b,large.stock)).toEqual([]);
  });

  it('checks carrier intent and sound thin limits while leaving tapered composite carriers available',()=>{
    const carrier=clone();carrier.b.regions.find(r=>r.role==='head')!.intent='small';
    expect(validateAnimalBlueprint(carrier.b,large.stock).issues.join(' ')).toContain('plate-1x4-reddish-brown in head');
    const thick=clone(),tail=thick.b.regions.find(r=>r.role==='tail')!;tail.intent='thin';
    thick.b.features.push({id:'tail-core',description:'Actual thick tail core and carrier.',intent:'sweeping-tail',pairing:'none',pieces:[{partId:'brick-2x2-reddish-brown',count:1,role:'tail'}],carriers:[{partId:'plate-2x4-reddish-brown',count:1,role:'tail'}]});
    expect(validateAnimalBlueprint(thick.b,large.stock).issues.join(' ')).toContain('contradicts thin intent');
    tail.intent='taper';expect(validateAnimalBlueprint(thick.b,large.stock).issues).toEqual([]);
  });

  it('collects incompatible envelope, intent and palette promises together and documents exact final semantics',()=>{
    const {b}=clone(),nose=b.regions.find(r=>r.role==='nose')!;b.features.push(muzzleFeature());nose.intent='small';nose.max[2]=nose.min[2]+.1;nose.tolerance=0;b.palette.coat=['orange','reddish-brown'];
    const result=validateAnimalBlueprint(b,large.stock);expect(result.issues.some(s=>s.includes('Palette'))).toBe(true);expect(result.issues.some(s=>s.includes('neither quarter orientation'))).toBe(true);expect(result.issues.some(s=>s.includes('contradicts small intent'))).toBe(true);
    const text=animalBlueprintText(large.stock);for(const phrase of ['small requires EVERY axis <=1.5','thin requires at least ONE axis <=1','at least .39 stud','at least .49 stud','Ordinary rectangular carriers'])expect(text).toContain(phrase);
  });

  it('bills a matching count1 shared carrier only once across two features, while unmarked copies remain separate',()=>{
    const {b}=sharedCrown(),stock={...large.stock,'plate-1x4-reddish-brown':1},before=JSON.stringify(b),result=validateAnimalBlueprint(b,stock);
    expect(result.issues).toEqual([]);expect(result.reservations!.total['plate-1x4-reddish-brown']).toBe(1);expect(result.reservations!.remaining['plate-1x4-reddish-brown']).toBe(0);
    expect(result.blueprint!.features[0].carriers[0].shared).toBe('crown');expect(result.blueprint!.features[2].carriers[0].shared).toBe('crown');
    const rows=uniqueAnimalReservations(result.blueprint!);expect(rows.filter(p=>p.shared==='crown')).toHaveLength(1);
    const total:Record<string,number>={};for(const p of rows)total[p.partId]=(total[p.partId]??0)+p.count;expect(total).toEqual(result.reservations!.total);
    rows[0].count++;expect(JSON.stringify(b)).toBe(before);delete b.features[0].carriers[0].shared;delete b.features[2].carriers[0].shared;
    expect(validateAnimalBlueprint(b,stock).issues.join(' ')).toContain('double-spent');expect(uniqueAnimalReservations(b).filter(p=>p.partId==='plate-1x4-reddish-brown')).toHaveLength(2);
  });

  it('rejects malformed sharing, conflicting identity/role/count and repeated tokens within one feature',()=>{
    for(const mutate of [
      (b:AnimalBlueprint)=>{b.features[2].carriers[0].partId='plate-2x4-reddish-brown';},
      (b:AnimalBlueprint)=>{b.features[2].carriers[0].role='frame';},
      (b:AnimalBlueprint)=>{b.features[2].carriers[0].count=2;},
      (b:AnimalBlueprint)=>{b.features[2].carriers[0].shared='Bad token';},
      (b:AnimalBlueprint)=>{b.features[2].carriers[0].shared='a'.repeat(65);},
      (b:AnimalBlueprint)=>{b.features[2].carriers.push({...b.features[2].carriers[0]});},
      (b:AnimalBlueprint)=>{b.features[2].pieces[0].shared='illegal-piece';},
    ]) {
      const {b}=sharedCrown();mutate(b);expect(validateAnimalBlueprint(b,large.stock).blueprint).toBeNull();expect(()=>uniqueAnimalReservations(b)).toThrow();
    }
    const {b}=sharedCrown();b.features[2].carriers[0].shared='another-crown';
    expect(uniqueAnimalReservations(b).filter(p=>p.partId==='plate-1x4-reddish-brown')).toHaveLength(2);
    expect(validateAnimalBlueprint(b,{...large.stock,'plate-1x4-reddish-brown':1}).issues.join(' ')).toContain('double-spent');
    expect(animalBlueprintText(large.stock)).toContain('billed ONCE');
  });
});

describe('blueprint promises checked against actual whole construction',()=>{
  it('accepts both independent exact-stock whole fixtures without modifying plans, parts or stock',()=>{
    for(const {c,b} of fixtures) {const before=JSON.stringify({c,b,stock:large.stock});expect(animalBlueprintIssues(c,b,large.stock)).toEqual([]);expect(JSON.stringify({c,b,stock:large.stock})).toBe(before);}
  });

  it('permits layered feature-to-feature paths to a carrier rather than requiring every direct mate',()=>{
    for(const [i,{c,b}] of fixtures.entries()) {
      const plan=structuredClone(b);plan.features.push(muzzleFeature(i===1));
      const pp=all(c),tile=pp.find(p=>p.partId==='tile-1x2-tan')!,base=pp.find(p=>p.partId===plan.features[2].carriers[0].partId&&c.receipts.some(r=>r.role==='muzzle'&&r.indices.includes(pp.indexOf(p))))!;
      expect(connectionPairs(frame(tile),frame(base))).toEqual([]);
      expect(animalBlueprintIssues(c,plan,large.stock)).toEqual([]);
    }
  });

  it('rejects paths through unreserved model parts and unused carriers',()=>{
    const {c,b}=clone();const f=muzzleFeature();f.pieces=f.pieces.filter(p=>p.partId!=='plate-1x2-reddish-brown');b.features.push(f);
    expect(validateAnimalBlueprint(b,large.stock).issues).toEqual([]);expect(animalBlueprintIssues(c,b,large.stock).join(' ')).toContain('reserved contact graph');
    const spare=clone();spare.b.features[0].carriers.push({partId:'plate-2x6-white',count:1,role:'frame'});
    expect(animalBlueprintIssues(spare.c,spare.b,large.stock).join(' ')).toContain('participating carrier');
  });

  it('allows the same real head bridges only in anatomy mode, without changing poses or reservation bindings',()=>{
    const {c,b}=crownSupportedEyes(),pp=all(c),indices=own(c),crown=indices.head!.find(i=>pp[i].partId==='plate-1x4-reddish-brown')!;
    for(const role of ['eye-left','eye-right'] as const)expect(connectionPairs(frame(pp[indices[role]![0]]),frame(pp[crown]))).toEqual([]);
    expect(validateAnimalBlueprint(b,large.stock).issues).toEqual([]);expect(animalBlueprintIssues(c,b,large.stock).join(' ')).toContain('reserved contact graph');
    b.features[1].supportMode='reserved-only';expect(animalBlueprintIssues(c,b,large.stock).join(' ')).toContain('reserved contact graph');
    b.features[1].supportMode='anatomy';const before=JSON.stringify({c,b,stock:large.stock});expect(animalBlueprintIssues(c,b,large.stock)).toEqual([]);expect(JSON.stringify({c,b,stock:large.stock})).toBe(before);
  });

  it('permits actual muzzle-role layering but excludes a bridge authoritatively owned by another role',()=>{
    const {c,b}=clone(),f=muzzleFeature();f.pieces=f.pieces.filter(p=>p.partId!=='plate-1x2-reddish-brown');f.supportMode='anatomy';b.features.push(f);
    expect(animalBlueprintIssues(c,b,large.stock)).toEqual([]);
    const indices=own(c),bridge=indices.muzzle!.find(i=>all(c)[i].partId==='plate-1x2-reddish-brown')!;
    indices.muzzle=indices.muzzle!.filter(i=>i!==bridge);indices.head!.push(bridge);c.roleIndices=indices;
    const issues=animalBlueprintIssues(c,b,large.stock);expect(issues).toHaveLength(1);expect(issues[0]).toContain('reserved contact graph');
  });

  it('ignores disconnected intermediate-only anatomy components while requiring every selected carrier to participate',()=>{
    const {c,b}=crownSupportedEyes();b.features[1].supportMode='anatomy';
    const indices=own(c),pp=all(c),extra=indices.hips!.find(i=>pp[i].partId==='brick-1x4-tan')!;
    expect(extra).toBeDefined();indices.hips=indices.hips!.filter(i=>i!==extra);indices.head!.push(extra);c.roleIndices=indices;
    const head=b.regions.find(r=>r.role==='head')!,actual=frame(pp[extra]);for(const axis of [0,1,2]){head.min[axis]=Math.min(head.min[axis],actual.bounds.min[axis]/20);head.max[axis]=Math.max(head.max[axis],actual.bounds.max[axis]/20);}
    expect(indices.head!.filter(i=>i!==extra).every(i=>connectionPairs(frame(pp[i]),frame(pp[extra])).length===0)).toBe(true);
    expect(animalBlueprintIssues(c,b,large.stock)).toEqual([]);
    b.features[1].carriers.push({partId:'brick-1x4-tan',count:1,role:'head'});
    expect(animalBlueprintIssues(c,b,large.stock).join(' ')).toContain('participating carrier');
    const wrong=crownSupportedEyes();wrong.b.features[1].supportMode='anatomy';wrong.b.features[1].carriers=[{partId:'plate-1x6-reddish-brown',count:1,role:'frame'}];
    expect(animalBlueprintIssues(wrong.c,wrong.b,large.stock).join(' ')).toContain('reserved contact graph');
  });

  it('does not accept unbilled or disconnected bridges merely because their role permits anatomy traversal',()=>{
    const {c,b}=clone(),f=muzzleFeature();f.pieces=f.pieces.filter(p=>p.partId!=='plate-1x2-reddish-brown');f.supportMode='anatomy';b.features.push(f);
    const id='plate-1x2-reddish-brown',stock={...large.stock,[id]:all(c).filter(p=>p.partId===id).length-1};
    expect(validateAnimalBlueprint(b,stock).issues).toEqual([]);expect(animalBlueprintIssues(c,b,stock).length).toBeGreaterThan(0);
    const moved=structuredClone(c),bridge=own(moved).muzzle!.find(i=>all(moved)[i].partId===id)!;all(moved)[bridge].z+=1;
    expect(animalBlueprintIssues(moved,b,large.stock).length).toBeGreaterThan(0);
  });

  it('retains shared-token and piece exclusivity in anatomy mode even when role bridges are available',()=>{
    const {c,b}=crownSupportedEyes();b.features.forEach(f=>{f.supportMode='anatomy';});expect(animalBlueprintIssues(c,b,large.stock)).toEqual([]);
    for(const binding of ['other-crown',undefined]) {
      const plan=structuredClone(b);if(binding)plan.features[1].carriers[0].shared=binding;else delete plan.features[1].carriers[0].shared;
      expect(validateAnimalBlueprint(plan,large.stock).issues).toEqual([]);expect(animalBlueprintIssues(c,plan,large.stock).join(' ')).toContain('globally exclusive assignment');
    }
    const alias=structuredClone(b);alias.features.push({...structuredClone(alias.features[1]),id:'duplicate-eyes'});
    expect(validateAnimalBlueprint(alias,{...large.stock,'plate-1x1-dark-gray':4}).issues).toEqual([]);expect(animalBlueprintIssues(c,alias,{...large.stock,'plate-1x1-dark-gray':4}).join(' ')).toContain('globally exclusive assignment');
    const piece=structuredClone(b);piece.features[1].pairing='none';piece.features[1].pieces=[{partId:'plate-1x4-reddish-brown',count:1,role:'head'}];
    expect(animalBlueprintIssues(c,piece,large.stock).join(' ')).toContain('globally exclusive assignment');
  });

  it('jointly chooses the matching identical carrier copy instead of the first receipt copy',()=>{
    const {c,b}=clone(),pp=all(c),indices=own(c),rear=indices['leg-rear-left']![0];
    const bars=indices.frame!.filter(i=>pp[i].partId==='plate-1x4-reddish-brown');
    bars.sort((a,z)=>connectionPairs(frame(pp[a]),frame(pp[rear])).length-connectionPairs(frame(pp[z]),frame(pp[rear])).length);
    expect(connectionPairs(frame(pp[bars[0]]),frame(pp[rear]))).toEqual([]);expect(connectionPairs(frame(pp[bars[1]]),frame(pp[rear])).length).toBeGreaterThan(0);
    indices.frame=[...bars,...indices.frame!.filter(i=>!bars.includes(i))];c.roleIndices=indices;
    b.features.push({id:'rear-load',description:'Rear leg through its actual matching crossbar.',intent:'contoured-body',pairing:'none',pieces:[{partId:'roundbrick-1x1-tan',count:1,role:'leg-rear-left'}],carriers:[{partId:'plate-1x4-reddish-brown',count:1,role:'frame'}]});
    expect(animalBlueprintIssues(c,b,large.stock)).toEqual([]);
  });

  it('cannot reuse identical actual indices across two features despite surplus unplaced stock',()=>{
    const {c,b}=clone();b.features.push({...structuredClone(b.features[0]),id:'reused-ear-parts'});
    const stock={...large.stock,'slope-2x2-black':4};expect(validateAnimalBlueprint(b,stock).issues).toEqual([]);
    expect(animalBlueprintIssues(c,b,stock).join(' ')).toContain('globally exclusive assignment');
  });

  it('binds the same explicit token to one real carrier index participating in each feature graph',()=>{
    const {c,b}=sharedCrown(),stock={...large.stock,'plate-1x4-reddish-brown':1};
    expect(all(c).filter(p=>p.partId==='plate-1x4-reddish-brown')).toHaveLength(1);expect(animalBlueprintIssues(c,b,stock)).toEqual([]);
    for(const binding of ['another-crown',undefined]) {
      const plan=structuredClone(b);if(binding)plan.features[2].carriers[0].shared=binding;else delete plan.features[2].carriers[0].shared;
      expect(validateAnimalBlueprint(plan,large.stock).issues).toEqual([]);expect(animalBlueprintIssues(c,plan,large.stock).join(' ')).toContain('globally exclusive assignment');
    }
  });

  it('backtracks a shared token selected by an earlier feature when a later real contact needs the other identical carrier',()=>{
    const {c,b}=clone(),pp=all(c),indices=own(c),rear=indices['leg-rear-left']![0],white=indices.frame!.find(i=>pp[i].partId==='plate-2x6-white')!;
    const bars=indices.frame!.filter(i=>pp[i].partId==='plate-1x4-reddish-brown');bars.sort((a,z)=>connectionPairs(frame(pp[a]),frame(pp[rear])).length-connectionPairs(frame(pp[z]),frame(pp[rear])).length);
    expect(bars.every(i=>connectionPairs(frame(pp[i]),frame(pp[white])).length>0)).toBe(true);expect(connectionPairs(frame(pp[bars[0]]),frame(pp[rear]))).toEqual([]);
    indices.frame=[...bars,...indices.frame!.filter(i=>!bars.includes(i))];c.roleIndices=indices;
    const carrier={partId:'plate-1x4-reddish-brown',count:1,role:'frame' as const,shared:'rear-crossbar'};
    b.features.push({id:'bridge-support',description:'Bridge can mate either identical crossbar initially.',intent:'contoured-body',pairing:'none',pieces:[{partId:'plate-2x6-white',count:1,role:'frame'}],carriers:[{...carrier}]});
    b.features.push({id:'rear-load',description:'Rear foot requires the same reserved crossbar at the rear.',intent:'contoured-body',pairing:'none',pieces:[{partId:'roundbrick-1x1-tan',count:1,role:'leg-rear-left'}],carriers:[{...carrier}]});
    expect(animalBlueprintIssues(c,b,large.stock)).toEqual([]);
    const impossible=structuredClone(b);impossible.features[2].pieces=[{partId:'roundbrick-1x1-tan',count:1,role:'leg-front-left'}];
    expect(animalBlueprintIssues(c,impossible,large.stock).join(' ')).toContain('reserved contact graph');
  });

  it('does not permit a feature piece to alias a shared carrier or traverse unreserved parts through it',()=>{
    const {c,b}=sharedCrown();b.features[2].pieces=[{partId:'plate-1x4-reddish-brown',count:1,role:'head'}];
    expect(validateAnimalBlueprint(b,large.stock).issues).toEqual([]);expect(animalBlueprintIssues(c,b,large.stock).join(' ')).toContain('globally exclusive assignment');
    const f=sharedCrown();f.b.features[2].pieces=[{partId:'plate-1x1-dark-gray',count:1,role:'eye-left'}];
    const stock={...large.stock,'plate-1x1-dark-gray':3};expect(validateAnimalBlueprint(f.b,stock).issues).toEqual([]);expect(animalBlueprintIssues(f.c,f.b,stock).length).toBeGreaterThan(0);
  });

  it('uses exact convex SAT for the clear inverse-slope neck undercut, while rejecting real occupied volume',()=>{
    const {c,b}=clone(1),empty={id:'neck-undercut',min:[3.7,4.1,3.25] as [number,number,number],max:[3.9,4.9,3.4] as [number,number,number]};
    const solids=all(c).flatMap(p=>frame(p).solids),center=empty.min.map((n,a)=>(n+empty.max[a])*10) as [number,number,number];
    expect(solids.some(s=>[0,1,2].every(a=>center[a]>s.bounds.min[a]&&center[a]<s.bounds.max[a]))).toBe(true);
    expect(solids.some(s=>solidContains(s,center))).toBe(false);
    b.emptyRegions.push(empty);expect(animalBlueprintIssues(c,b,large.stock)).toEqual([]);
    empty.min[2]=4.1;empty.max[2]=4.3;expect(animalBlueprintIssues(c,b,large.stock).join(' ')).toContain('neck-undercut: deliberate empty region contains');
  });

  it('keeps whole-box solid checking authoritative even when belly corridor intersection is sufficient',()=>{
    const {c,b}=clone();b.emptyRegions[0].min[0]=0;b.emptyRegions[0].max[0]=4;
    expect(animalBlueprintIssues(c,b,large.stock)).toEqual([]);
    b.emptyRegions[0].max[1]++;expect(validateAnimalBlueprint(b,large.stock).issues).toEqual([]);
    expect(animalBlueprintIssues(c,b,large.stock).join(' ')).toContain('deliberate empty region contains');
  });

  it('enforces stance, pose/physics, proportions, selected budget, envelopes, actual palette and exact role ownership',()=>{
    const stance=clone();stance.b.stance='crouching';expect(animalBlueprintIssues(stance.c,stance.b,large.stock).join(' ')).toContain('supported stance');
    const pose=clone();all(pose.c).find(p=>p.partId==='slope-2x2-black')!.z+=1;expect(animalBlueprintIssues(pose.c,pose.b,large.stock).length).toBeGreaterThan(0);
    const proportions=clone();proportions.b.proportions.muzzleProjection=[4,5];expect(animalBlueprintIssues(proportions.c,proportions.b,large.stock).join(' ')).toContain('projecting muzzle');
    const envelope=clone();envelope.b.regions.find(r=>r.role==='head')!.max[2]-=.5;expect(animalBlueprintIssues(envelope.c,envelope.b,large.stock).join(' ')).toContain('head: actual anatomy exceeds');
    const palette=clone();palette.b.palette.accent=['tan','white'];expect(animalBlueprintIssues(palette.c,palette.b,large.stock).join(' ')).toContain('unplanned color');
    const budget=clone();budget.b.parts.max=30;expect(animalBlueprintIssues(budget.c,budget.b,large.stock).join(' ')).toContain('part count');
    const ownership=clone();ownership.c.roleIndices=own(ownership.c);ownership.c.roleIndices.head!.push(ownership.c.roleIndices['ear-left']![0]);
    expect(animalBlueprintIssues(ownership.c,ownership.b,large.stock).join(' ')).toContain('unbound final blueprint');
  });
});
