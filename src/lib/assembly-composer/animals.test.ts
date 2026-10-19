import { beforeAll, describe, expect, it } from 'vitest';
import small from '../fixtures/small-pile-stock.json';
import medium from '../fixtures/atlas-photo-pile-20261013-stock.json';
import large from '../fixtures/large-pile-stock.json';
import { parsePartId, type Placed } from '../bricks';
import { compileConnections, connectionPairs, frame, validateConnections } from '../connections';
import { animalCompositionIssues, animalModulePlans } from './animals';
import { composeModules, searchModuleCompositions } from './compose';
import type { AssemblyComposition, AssemblyPlan } from './types';

const stocks=[small.stock,medium,large.stock] as Record<string,number>[];
const opts={minParts:20,maxParts:80,maxMillis:10000};
const plans:AssemblyPlan[][]=[],models:AssemblyComposition[][]=[];
const pp=(c:AssemblyComposition,role:string)=>{const all=c.build.steps.flatMap(s=>s.parts);return c.receipts.find(r=>r.role===role)!.indices.map(i=>all[i]);};
const bounds=(parts:Placed[])=>{const ff=parts.map(frame),min=[0,1,2].map(a=>Math.min(...ff.map(f=>f.bounds.min[a]))/20),max=[0,1,2].map(a=>Math.max(...ff.map(f=>f.bounds.max[a]))/20);return {min,max,size:max.map((n,a)=>n-min[a])};};
const cost=(p:AssemblyPlan)=>{const out:Record<string,number>={};for(const n of p.nodes)for(const op of n.option.program.operations)out[op.partId]=(out[op.partId]??0)+1;return out;};
const shape=(c:AssemblyComposition)=>JSON.stringify(c.build.steps.flatMap(s=>s.parts).map(p=>{const k=parsePartId(p.partId)!,f=frame(p);return [k.type,k.w,k.d,...f.rotation,...f.translation];}).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
beforeAll(()=>{for(const stock of stocks){const p=animalModulePlans(stock,'Animal');plans.push(p);models.push(p.map(p=>composeModules(p,stock,opts)));}},45000);

describe('complete stock-aware animal assemblies',()=>{
  it('uses actual fixture schemas and compiles every immutable module and whole model against one stock',()=>{
    expect(stocks.map(s=>Object.values(s).reduce((n,v)=>n+v,0))).toEqual([96,150,408]);
    models.forEach((cc,i)=>{
      expect(cc.length).toBeGreaterThan(0);const before=JSON.stringify(plans[i]),ledger=JSON.stringify(stocks[i]);
      for(const c of cc){
        expect(['Dog','Fox','Bear']).toContain(c.plan.name);expect(c.plan.nodes.length).toBeGreaterThanOrEqual(15);expect(c.plan.nodes.length).toBeLessThanOrEqual(32);
        expect(c.build.steps.length).toBeGreaterThanOrEqual(20);expect(c.build.steps.length).toBeLessThanOrEqual(80);
        expect(validateConnections(c.build,stocks[i],24)).toEqual([]);expect(animalCompositionIssues(c)).toEqual([]);
        for(const node of c.plan.nodes){const own:Record<string,number>={};for(const op of node.option.program.operations)own[op.partId]=(own[op.partId]??0)+1;expect(()=>compileConnections(node.option.program,own)).not.toThrow();}
        for(const [id,n] of Object.entries(cost(c.plan))){expect(n).toBeLessThanOrEqual(stocks[i][id]);expect(c.remaining[id]).toBe(stocks[i][id]-n);}
      }
      expect(JSON.stringify(plans[i])).toBe(before);expect(JSON.stringify(stocks[i])).toBe(ledger);
    });
  });

  it('returns distinct physical species and multiple genuine torso/stance options',()=>{
    for(const cc of models){const seen=new Map<string,string>();for(const c of cc){const key=shape(c);if(seen.has(key))expect(seen.get(key)).toBe(c.plan.name);else seen.set(key,c.plan.name);}}
    for(const name of ['Dog','Fox','Bear']){
      const cc=models.flat().filter(c=>c.plan.name===name);expect(cc.length).toBeGreaterThan(0);expect(new Set(cc.map(shape)).size).toBeGreaterThan(1);
    }
    expect(models[1].some(c=>bounds(pp(c,'torso')).size[2]>1)).toBe(true);
  });

  it('measures morphology and rejects renaming one species as another',()=>{
    for(const cc of models)for(const c of cc){
      const refined=c.plan.id.startsWith('animal-refined:'),craft=c.plan.id.startsWith('animal-craft:');
      const head=bounds(pp(c,'head')),chest=bounds(pp(c,'chest')),tail=bounds(pp(c,'tail')),body=bounds(refined||craft?['chest','torso','hips'].flatMap(role=>pp(c,role)):pp(c,'frame'));
      const eyes=bounds(craft?['eye-left','eye-right'].flatMap(role=>pp(c,role)):pp(c,'face'));
      const muzzle=eyes.min[1]-bounds(pp(c,'muzzle')).min[1];
      if(c.plan.name==='Dog'){expect(muzzle).toBeCloseTo(1);expect(tail.size[0]).toBeCloseTo(1);expect(chest.size[0]).toBeCloseTo(refined?3:2);}
      if(c.plan.name==='Fox'){
        if(craft){expect(muzzle).toBeGreaterThanOrEqual(1);expect(muzzle).toBeLessThanOrEqual(body.size[1]*.65);expect(bounds(pp(c,'muzzle')).size[2]).toBeLessThanOrEqual(head.size[2]*.8);for(const role of ['ear-left','ear-right'])expect(bounds(pp(c,role)).max[2]).toBeGreaterThan(head.max[2]);}
        else expect(muzzle).toBeCloseTo(2);
        expect(tail.size[0]).toBeCloseTo(2);if(refined||craft)expect(tail.size[1]).toBeGreaterThanOrEqual(4);else expect(tail.size[1]).toBeCloseTo(4);
      }
      if(c.plan.name==='Bear'){expect(head.size[0]).toBeCloseTo(4);expect(chest.size[0]).toBeCloseTo(4);expect(tail.max[1]-body.max[1]).toBeLessThanOrEqual(1.01);}
      for(const label of ['Dog','Fox','Bear'].filter(n=>n!==c.plan.name)){const fake=structuredClone(c);fake.plan.name=label;expect(animalCompositionIssues(fake).length).toBeGreaterThan(0);}
    }
  });

  it('keeps feet grounded, all paw toes forward, a lower waist and real load-bearing/tail contacts',()=>{
    for(const cc of models)for(const c of cc){
      expect(bounds(pp(c,'frame')).min[2]).toBeGreaterThanOrEqual(1.2);expect(bounds(pp(c,'torso')).max[2]).toBeLessThan(bounds(pp(c,'chest')).max[2]);
      for(const role of ['leg-front-left','leg-front-right','leg-rear-left','leg-rear-right']){
        const shaft=pp(c,role),footRole=role.replace('leg-','foot-'),has=c.receipts.some(r=>r.role===footRole),foot=has?pp(c,footRole):shaft;
        expect(bounds(foot).min[2]).toBeCloseTo(0);expect(shaft.some(p=>pp(c,'frame').some(q=>connectionPairs(frame(p),frame(q)).length))).toBe(true);
        if(has){expect(foot.some(p=>shaft.some(q=>connectionPairs(frame(p),frame(q)).length))).toBe(true);expect(bounds(foot).min[1]).toBeCloseTo(bounds(shaft).min[1]-1);}
      }
      expect(pp(c,'tail').some(p=>pp(c,'hips').some(q=>connectionPairs(frame(p),frame(q)).length))).toBe(true);
    }
  });

  it('uses STUDS on every axis and preserves a visible forward nose',()=>{
    for(const cc of models)for(const c of cc){const real=bounds(c.build.steps.flatMap(s=>s.parts)),eyes=bounds(c.plan.id.startsWith('animal-craft:')?['eye-left','eye-right'].flatMap(role=>pp(c,role)):pp(c,'face'));c.size.forEach((n,a)=>expect(n).toBeCloseTo(real.size[a],8));expect(bounds(pp(c,'muzzle')).min[1]).toBeLessThan(eyes.min[1]);expect(bounds(pp(c,'muzzle')).min[1]).toBeLessThan(bounds(pp(c,'neck')).min[1]);}
  });

  it('prefers craft/refined recipes within each actual species while retaining small/medium fallback plans',()=>{
    for(const cc of models.slice(0,2)){expect(cc.length).toBeGreaterThan(0);expect(cc.every(c=>!c.plan.id.startsWith('animal-refined:')&&!c.plan.id.startsWith('animal-craft:'))).toBe(true);}
    expect(plans[2].some(p=>p.id.startsWith('animal-refined:dog:'))).toBe(true);
    expect(plans[2].some(p=>p.id.startsWith('animal-refined:bear:'))).toBe(true);
    const order=['Dog','Fox','Bear'];
    expect(plans[2].map(p=>order.indexOf(p.name))).toEqual(plans[2].map(p=>order.indexOf(p.name)).sort((a,b)=>a-b));
    for(const name of order){
      const rank=(p:AssemblyPlan)=>p.id.startsWith('animal-craft:')?0:p.id.startsWith('animal-refined:')?1:2;
      const ranks=plans[2].filter(p=>p.name===name).map(rank);expect(ranks).toEqual([...ranks].sort((a,b)=>a-b));
    }
  });

  it('integrates three distinct Fox craft recipes with guarded delegation and separate real eyes',()=>{
    const crafts=models[2].filter(c=>c.plan.id.startsWith('animal-craft:fox:'));
    expect(crafts.map(c=>c.plan.id)).toEqual(['animal-craft:fox:shallow-face','animal-craft:fox:broad-cheeks','animal-craft:fox:tapered-neck']);
    expect(new Set(crafts.map(shape)).size).toBe(3);expect(plans[2].filter(p=>p.name==='Fox').slice(0,3).map(p=>p.id)).toEqual(crafts.map(c=>c.plan.id));
    for(const c of crafts){
      expect(c.plan.name).toBe('Fox');expect(c.plan.nodes).toHaveLength(16);expect(animalCompositionIssues(c,'Animal')).toEqual([]);expect(animalCompositionIssues(c,'Fox')).toEqual([]);
      expect(pp(c,'eye-left')).toHaveLength(1);expect(pp(c,'eye-right')).toHaveLength(1);
      const missing=structuredClone(c);missing.receipts=missing.receipts.filter(r=>r.role!=='eye-left');
      expect(animalCompositionIssues(missing,'Dog')).toEqual(['Requested and actual animal kinds differ; review the explicitly labelled actual kind.']);
      expect(animalCompositionIssues(missing,'Rabbit')).toEqual(['Unsupported or noncanonical animal subject.']);
      expect(animalCompositionIssues(missing,'Fox').length).toBeGreaterThan(0);
      const noncanonical=structuredClone(c);noncanonical.plan.name='Red fox';
      expect(animalCompositionIssues(noncanonical,'Fox')).toEqual(['Unsupported or noncanonical animal subject.']);
      const fake=structuredClone(c);fake.plan.name='Dog';fake.build.name='Dog';expect(animalCompositionIssues(fake,'Dog').length).toBeGreaterThan(0);
    }
  });

  it('checks canonical actual names and requested species before delegating refined anatomy',()=>{
    const good=models[2].find(c=>c.plan.id.startsWith('animal-refined:dog:'))!;
    expect(good).toBeDefined();expect(animalCompositionIssues(good,'Animal')).toEqual([]);
    const missing=structuredClone(good);missing.receipts=[];
    expect(animalCompositionIssues(missing,'Rabbit')).toEqual(['Unsupported or noncanonical animal subject.']);
    expect(animalCompositionIssues(missing,'Fox')).toEqual(['Requested and actual animal kinds differ; review the explicitly labelled actual kind.']);
    const noncanonical=structuredClone(missing);noncanonical.plan.name='Labrador dog';
    expect(animalCompositionIssues(noncanonical,'Dog')).toEqual(['Unsupported or noncanonical animal subject.']);
    expect(animalCompositionIssues(missing,'Dog').length).toBeGreaterThan(0);
    const renamed=structuredClone(good);renamed.plan.name='Bear';renamed.build.name='Bear';
    expect(animalCompositionIssues(renamed,'Bear').length).toBeGreaterThan(0);
    const displaced=structuredClone(good);pp(displaced,'tail').forEach(p=>p.z+=1);
    expect(animalCompositionIssues(displaced).length).toBeGreaterThan(0);
    const forged=structuredClone(models[1][0]);forged.plan.id=`animal-refined:${forged.plan.name.toLowerCase()}:forged`;
    expect(animalCompositionIssues(forged).length).toBeGreaterThan(0);
  });

  it('rejects fake eyes/nose, missing roles, ungrounded feet and padding inside the belly opening',()=>{
    const good=models[1][0],missing=structuredClone(good);missing.receipts=missing.receipts.filter(r=>r.role!=='ear-left');expect(animalCompositionIssues(missing).join(' ')).toMatch(/anatomical roles/);
    const blind=structuredClone(good);pp(blind,'face').filter(p=>{const k=parsePartId(p.partId)!;return k.w===1&&k.d===1;}).forEach(p=>p.partId='plate-1x1-white');expect(animalCompositionIssues(blind).join(' ')).toMatch(/two real separated dark eyes/);
    const noNose=structuredClone(good);pp(noNose,'muzzle').filter(p=>parsePartId(p.partId)?.type==='plate').forEach(p=>p.partId='plate-1x2-white');expect(animalCompositionIssues(noNose).join(' ')).toMatch(/distinct visible nose/);
    const floating=structuredClone(good);pp(floating,'leg-front-left').forEach(p=>p.z+=2);expect(animalCompositionIssues(floating).join(' ')).toMatch(/ground plane/);
    const filled=structuredClone(good);pp(filled,'torso').forEach(p=>p.z-=4);expect(animalCompositionIssues(filled).join(' ')).toMatch(/belly opening/);
  });

  it('fails closed on depleted/malformed stock and never gives repeated modules separate ledgers',()=>{
    const p=plans[1][0],scarce={...stocks[1]},repeat=Object.entries(cost(p)).find(([,n])=>n>1)!;scarce[repeat[0]]=repeat[1]-1;
    expect(()=>composeModules(p,scarce,opts)).toThrow(/Shared stock exhausted/);expect(searchModuleCompositions([p],scarce,{...opts,limit:1}).candidates).toEqual([]);
    expect(animalModulePlans({},'Dog')).toEqual([]);expect(animalModulePlans({...stocks[1],'roundbrick-1x1-tan':NaN},'Dog')).toEqual([]);expect(animalModulePlans({...stocks[1],'roundbrick-1x1-tan':-1},'Dog')).toEqual([]);
  });

  it('supports singleton eye shades without multiplying either actual ID',()=>{
    const stock={...stocks[1]};for(const id of Object.keys(stock))if(/^plate-1x1-(black|dark-gray|dark-green|dark-blue|dark-azure|reddish-brown)$/.test(id))stock[id]=0;
    stock['plate-1x1-dark-green']=1;stock['plate-1x1-dark-azure']=1;
    const p=animalModulePlans(stock,'Dog');expect(p.length).toBeGreaterThan(0);for(const plan of p){expect(cost(plan)['plate-1x1-dark-green']).toBeLessThanOrEqual(1);expect(cost(plan)['plate-1x1-dark-azure']).toBeLessThanOrEqual(1);expect(animalCompositionIssues(composeModules(plan,stock,opts))).toEqual([]);}
  },15000);

  it('fails closed for misleading/unsupported names and puts the requested kind first when available',()=>{
    for(const name of ['Foxglove','Bear chair','Seafox','Dogfish','Rabbit','Giraffe','Dinosaur','Bird','Dog and fox','Boxer'])expect(animalModulePlans(stocks[1],name)).toEqual([]);
    const p=animalModulePlans(stocks[1],'Fox');if(p.some(p=>p.name==='Fox'))expect(p[0].name).toBe('Fox');expect(p.every(p=>['Dog','Fox','Bear'].includes(p.name))).toBe(true);
    expect(animalCompositionIssues(models[1][0],'Rabbit')).toContain('Unsupported or noncanonical animal subject.');
  },15000);
});
