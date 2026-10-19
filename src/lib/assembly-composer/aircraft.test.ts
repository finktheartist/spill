import { describe, expect, it } from 'vitest';
import stock from '../fixtures/atlas-photo-pile-20261013-stock.json';
import { parsePartId } from '../bricks';
import { compileConnections, connectionPairs, frame, validateConnections } from '../connections';
import { aircraftCompositionIssues, aircraftModulePlans } from './aircraft';
import { composeModules, searchModuleCompositions } from './compose';
import type { AssemblyComposition, AssemblyPlan } from './types';

const subject='Twin-Boom Seaplane';
const options={minParts:20,maxParts:60,maxMillis:3000};
const costs=(plan:AssemblyPlan) => {
  const cost:Record<string,number>={};
  for(const node of plan.nodes) for(const op of node.option.program.operations) cost[op.partId]=(cost[op.partId]??0)+1;
  return cost;
};
const moduleParts=(candidate:AssemblyComposition,role:string) => {
  const parts=candidate.build.steps.flatMap(s=>s.parts);
  return candidate.receipts.find(r=>r.role===role)!.indices.map(i=>parts[i]);
};
const extents=(candidate:AssemblyComposition,role:string) => {
  const frames=moduleParts(candidate,role).map(frame);
  return [0,1,2].map(a=>(Math.max(...frames.map(f=>f.bounds.max[a]))-Math.min(...frames.map(f=>f.bounds.min[a])))/20);
};
const shapeKey=(candidate:AssemblyComposition) => JSON.stringify(candidate.receipts.map(receipt=>[
  receipt.role,extents(candidate,receipt.role),moduleParts(candidate,receipt.role).map(p=>{
    const k=parsePartId(p.partId)!; const f=frame(p);
    return [k.type,k.w,k.d,...f.rotation,...f.translation];
  }),
]));

describe('stock-aware twin-boom aircraft assemblies',()=>{
  it('compiles every pilot layout and every immutable module through the real compiler',()=>{
    const plans=aircraftModulePlans(stock,subject);
    expect(plans.length).toBeGreaterThan(8);
    const before=JSON.stringify(plans), ledgerBefore=JSON.stringify(stock);
    for(const plan of plans) {
      for(const node of plan.nodes) {
        const ownCost:Record<string,number>={};
        for(const op of node.option.program.operations) ownCost[op.partId]=(ownCost[op.partId]??0)+1;
        expect(()=>compileConnections(node.option.program,ownCost)).not.toThrow();
      }
      const candidate=composeModules(plan,stock,options);
      expect(validateConnections(candidate.build,stock,24)).toEqual([]);
      expect(aircraftCompositionIssues(candidate,subject)).toEqual([]);
      expect(candidate.build.steps.length).toBeGreaterThanOrEqual(20);
      expect(candidate.build.steps.length).toBeLessThanOrEqual(60);
      for(const [id,n] of Object.entries(costs(plan))) {
        expect(n).toBeLessThanOrEqual((stock as Record<string,number>)[id]);
        expect(candidate.remaining[id]).toBe((stock as Record<string,number>)[id]-n);
      }
    }
    expect(JSON.stringify(plans)).toBe(before);
    expect(JSON.stringify(stock)).toBe(ledgerBefore);
  });

  it('returns materially different legal shapes early in the bounded production search',()=>{
    const result=searchModuleCompositions(aircraftModulePlans(stock,subject),stock,{
      ...options,maxParts:80,limit:8,maxAttempts:5000,validate:c=>aircraftCompositionIssues(c,subject),
    });
    expect(result.candidates).toHaveLength(8);
    expect(result.exhausted).toBe(false);
    expect(new Set(result.candidates.map(shapeKey)).size).toBe(8);
    expect(result.candidates.every(c=>c.plan.id.includes('crafted-'))).toBe(true);
    expect(new Set(result.candidates.map(c=>extents(c,'wing-left')[0])).size).toBe(2);
    expect(new Set(result.candidates.map(c=>extents(c,'float-left')[1])).size).toBe(2);
    expect(new Set(result.candidates.map(c=>extents(c,'boom-left')[1])).size).toBe(2);
    expect(new Set(result.candidates.map(c=>c.size[2])).size).toBe(2);
    for(const c of result.candidates) {
      const floats=['float-left','float-right'].flatMap(role=>moduleParts(c,role)).map(frame);
      const outerFloatSpan=(Math.max(...floats.map(f=>f.bounds.max[0]))-Math.min(...floats.map(f=>f.bounds.min[0])))/20;
      expect(c.size[0]).toBeGreaterThanOrEqual(1.4*outerFloatSpan);
      expect(c.build.steps).toHaveLength(30);
    }
  });

  it('uses real closure connections from the horizontal tailplane to BOTH boom tips',()=>{
    for(const plan of aircraftModulePlans(stock,subject)) {
      const candidate=composeModules(plan,stock,options);
      const tail=moduleParts(candidate,'tail')[0];
      for(const side of ['left','right']) {
        const boom=moduleParts(candidate,`boom-${side}`)[0];
        expect(connectionPairs(frame(boom),frame(tail)).length).toBeGreaterThan(0);
      }
      if(plan.id.includes('crafted-')) {
        const tailParts=moduleParts(candidate,'tail');
        expect(tailParts).toHaveLength(7);
        for(const [a,b] of [[1,4],[2,5],[3,6]]) expect(tailParts[a].partId).toBe(tailParts[b].partId);
        expect(tailParts.filter(p=>parsePartId(p.partId)?.type==='plate')).toHaveLength(5);
        expect(tailParts.filter(p=>parsePartId(p.partId)?.type==='slope')).toHaveLength(2);
        expect(extents(candidate,'tail')[2]).toBeCloseTo(2.4);
        continue;
      }
      const finParts=moduleParts(candidate,'tail').filter(p=>parsePartId(p.partId)?.type==='brick');
      expect(finParts).toHaveLength(2);
      for(const fin of finParts) {
        const b=frame(fin).bounds;
        expect((b.max[0]-b.min[0])/20).toBeCloseTo(1);
        expect((b.max[2]-b.min[2])/20).toBeCloseTo(1.2);
      }
    }
  });

  it('measures all extents in studs, including actual non-plate height',()=>{
    const candidate=composeModules(aircraftModulePlans(stock,subject)[0],stock,options);
    const frames=candidate.build.steps.flatMap(s=>s.parts).map(frame);
    const actual=[0,1,2].map(a=>(Math.max(...frames.map(f=>f.bounds.max[a]))-Math.min(...frames.map(f=>f.bounds.min[a])))/20);
    candidate.size.forEach((n,a)=>expect(n).toBeCloseTo(actual[a],8));
    expect(candidate.size[2]).toBeCloseTo(6);
    const floats=candidate.receipts.filter(r=>r.role.startsWith('float-') && r.role!=='float-crossbeam');
    for(const receipt of floats) expect(extents(candidate,receipt.role)[1]).toBeGreaterThanOrEqual(6);
    expect(aircraftCompositionIssues(candidate,subject)).toEqual([]);
  });

  it('does not change unsupported subjects into a twin-boom floatplane',()=>{
    for(const name of ['Flying boat','Biplane seaplane','Single-float seaplane','Jet seaplane','Twin-boom airplane','Sailplane','Helicopter']) {
      expect(aircraftModulePlans(stock,name)).toEqual([]);
    }
    expect(aircraftModulePlans(stock,'twin boom floatplane').length).toBeGreaterThan(0);
    expect(aircraftModulePlans(stock,'Seaplane').length).toBeGreaterThan(0);
    const candidate=composeModules(aircraftModulePlans(stock,subject)[0],stock,options);
    expect(aircraftCompositionIssues(candidate,'Biplane seaplane')).toContain('This aircraft subject needs an unsupported layout.');
  });

  it('stitches two coplanar wing panels into a two-stud inner chord with narrow tips and real paired fairings',()=>{
    const plans=aircraftModulePlans(stock,subject).filter(p=>p.id.includes('crafted-'));
    expect(plans).toHaveLength(12);
    for(const plan of plans) {
      const candidate=composeModules(plan,stock,options);
      const nacelles=[];
      for(const side of ['left','right']) {
        const [leading,carrier,trailing,nacelle]=moduleParts(candidate,`wing-${side}`);
        const [a,b,c,d]=[leading,carrier,trailing,nacelle].map(frame);
        expect(c.bounds.min[2]).toBeCloseTo(a.bounds.min[2]);
        expect(c.bounds.max[2]).toBeCloseTo(a.bounds.max[2]);
        expect(c.bounds.min[1]).toBeCloseTo(a.bounds.max[1]);
        expect((c.bounds.max[0]-c.bounds.min[0])/20).toBeCloseTo(4);
        expect((c.bounds.max[1]-a.bounds.min[1])/20).toBeCloseTo(2);
        expect((a.bounds.max[0]-a.bounds.min[0]-(c.bounds.max[0]-c.bounds.min[0]))/20).toBeGreaterThanOrEqual(2);
        expect(side==='left'?c.bounds.max[0]:c.bounds.min[0]).toBeCloseTo(side==='left'?a.bounds.max[0]:a.bounds.min[0]);
        expect(connectionPairs(a,b).length).toBeGreaterThan(0);
        expect(connectionPairs(c,b).length).toBeGreaterThan(0);
        expect((b.bounds.max[2]-a.bounds.min[2])/20).toBeCloseTo(.8);
        expect(connectionPairs(b,d).length).toBeGreaterThan(0);
        expect(nacelle.partId).toBe('curve-1x2-red');
        expect((d.bounds.max[0]-d.bounds.min[0])/20).toBeCloseTo(1);
        expect((d.bounds.max[1]-d.bounds.min[1])/20).toBeCloseTo(2);
        // The fairing is intentionally taller than the flying surface. Its
        // separate identity is the only reason it is excluded from thinness.
        expect((d.bounds.max[2]-a.bounds.min[2])/20).toBeCloseTo(1.2);
        expect(connectionPairs(b,d).some(([,socket])=>socket==='grip:0:1')).toBe(true);
        nacelles.push(nacelle);
      }
      expect(nacelles[0].partId).toBe(nacelles[1].partId);
      expect(costs(plan)['plate-1x4-bright-light-orange']).toBe(2);
      expect(costs(plan)['cornerplate-2x2-bright-light-orange']).toBe(2);
      expect(costs(plan)['curve-1x2-red']).toBe(2);
      expect(costs(plan)['plate-1x2-bright-light-orange']).toBe(4);
      expect(aircraftCompositionIssues(candidate,subject)).toEqual([]);
    }
  });

  it('keeps simpler layouts available when the pile cannot supply paired composite panels or engines',()=>{
    for(const id of ['plate-1x4-bright-light-orange','cornerplate-2x2-bright-light-orange','curve-1x2-red']) {
      const scarce={...stock,[id]:1};
      // The paired carrier can come in another paint; remove those actual
      // alternatives as well when testing the capability itself.
      if(id.startsWith('cornerplate')) for(const partId of Object.keys(scarce)) {
        if(partId.startsWith('cornerplate-2x2-')) (scarce as Record<string,number>)[partId]=1;
      }
      const plans=aircraftModulePlans(scarce,subject);
      expect(plans.length).toBeGreaterThan(0);
      expect(plans.some(p=>p.id.includes('crafted-'))).toBe(false);
      const result=searchModuleCompositions(plans,scarce,{...options,limit:2,validate:c=>aircraftCompositionIssues(c,subject)});
      expect(result.candidates).toHaveLength(2);
    }
  });

  it('does not exempt arbitrary engine blocks or tolerate mismatched short fins and panel gaps',()=>{
    const good=composeModules(aircraftModulePlans(stock,subject)[0],stock,options);
    const fakeEngine=structuredClone(good);
    moduleParts(fakeEngine,'wing-left')[3].partId='brick-1x2-dark-blue';
    expect(aircraftCompositionIssues(fakeEngine,subject).join(' ')).toMatch(/Engine fairings must be real/);
    const gap=structuredClone(good);moduleParts(gap,'wing-right')[2].x+=1;
    expect(aircraftCompositionIssues(gap,subject).join(' ')).toMatch(/coplanar leading\/trailing/);
    const mismatch=structuredClone(good);moduleParts(mismatch,'tail')[6].partId='slope-1x2-white';
    expect(aircraftCompositionIssues(mismatch,subject).join(' ')).toMatch(/Short twin fins must match/);
    const narrowSpan=structuredClone(good);
    moduleParts(narrowSpan,'float-left').forEach(p=>p.x-=2);
    moduleParts(narrowSpan,'float-right').forEach(p=>p.x+=2);
    expect(aircraftCompositionIssues(narrowSpan,subject).join(' ')).toMatch(/1.4 times the outer float span/);
  });

  it('fails closed on exhausted or malformed stock and never multiplies singleton colors',()=>{
    expect(aircraftModulePlans({},subject)).toEqual([]);
    const singletons=Object.fromEntries(Object.keys(stock).map(id=>[id,1]));
    expect(aircraftModulePlans(singletons,subject)).toEqual([]);
    expect(aircraftModulePlans({...stock,'plate-1x6-bright-light-orange':NaN},subject)).toEqual([]);
    expect(aircraftModulePlans({...stock,'plate-1x6-bright-light-orange':-1},subject)).toEqual([]);
    const plan=aircraftModulePlans(stock,subject)[0];
    const scarce={...stock}; const repeated=Object.entries(costs(plan)).find(([,n])=>n>1)!;
    (scarce as Record<string,number>)[repeated[0]]=repeated[1]-1;
    expect(()=>composeModules(plan,scarce,options)).toThrow(/Shared stock exhausted/);
    expect(searchModuleCompositions([plan],scarce,{...options,limit:1}).candidates).toEqual([]);
  });

  it('can plan from a smaller derived pile instead of requiring the frozen inventory',()=>{
    const plan=aircraftModulePlans(stock,subject).find(p=>p.id.includes('f2-4e-w1-6-b8-shoulder-0-slim'))!;
    const minimal=costs(plan);
    const result=searchModuleCompositions(aircraftModulePlans(minimal,subject),minimal,{
      ...options,limit:4,validate:c=>aircraftCompositionIssues(c,subject),
    });
    expect(result.candidates.length).toBeGreaterThan(0);
    for(const candidate of result.candidates) expect(validateConnections(candidate.build,minimal)).toEqual([]);
  });

  it('rejects a structurally legal off-center cockpit and wing layout',()=>{
    const plan=structuredClone(aircraftModulePlans(stock,subject)[0]);
    plan.nodes.find(n=>n.id==='fuselage')!.attachment!.parentPort='stud:1:0';
    const candidate=composeModules(plan,stock,options);
    expect(validateConnections(candidate.build,stock)).toEqual([]);
    expect(aircraftCompositionIssues(candidate,subject).join(' ')).toMatch(/centered|symmetrically/);
    expect(searchModuleCompositions([plan],stock,{...options,limit:1,validate:c=>aircraftCompositionIssues(c,subject)}).candidates).toEqual([]);
  });

  it('rejects structurally legal thick wing blocks rather than counting them as flying surfaces',()=>{
    const plan=structuredClone(aircraftModulePlans(stock,subject)[0]);
    plan.nodes.find(n=>n.id==='wing-left')!.option.program.operations.push({
      partId:'brick-2x2-light-gray',parent:0,parentPort:'stud:0:0',childPort:'grip:0:0',twist:0,
    });
    const candidate=composeModules(plan,stock,options);
    expect(validateConnections(candidate.build,stock)).toEqual([]);
    expect(aircraftCompositionIssues(candidate,subject).join(' ')).toMatch(/thin matched|stacked body bricks/);
  });

  it('rejects missing roles, forward tails and asymmetric float geometry',()=>{
    const good=composeModules(aircraftModulePlans(stock,subject)[0],stock,options);
    const missing=structuredClone(good); missing.receipts=missing.receipts.filter(r=>r.role!=='boom-right');
    expect(aircraftCompositionIssues(missing,subject).join(' ')).toMatch(/ten supported/);
    const forward=structuredClone(good); moduleParts(forward,'tail').forEach(p=>p.y-=8);
    expect(aircraftCompositionIssues(forward,subject).join(' ')).toMatch(/tail must sit behind|connect to both boom/);
    const asymmetric=structuredClone(good); moduleParts(asymmetric,'float-right')[1].y+=1;
    expect(aircraftCompositionIssues(asymmetric,subject).join(' ')).toMatch(/matching shapes.*relative geometry/);
  });
});
