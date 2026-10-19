import { describe, expect, it } from 'vitest';
import small from '../fixtures/small-pile-stock.json';
import medium from '../fixtures/atlas-photo-pile-20261013-stock.json';
import large from '../fixtures/large-pile-stock.json';
import { constructionApproaches } from './profiles';
import { assessSubjectOpportunity, createOpportunityContext } from './opportunity';
import type { SubjectOpportunity } from './opportunity';
import type { BuildBrief, FeatureNeed } from './types';

const feature=(name:string,types:string[],count=2):FeatureNeed=>({name,types,count,required:true,substitution:'Keep its defining shape using actual alternative pieces.'});
const brief=(features:FeatureNeed[]):BuildBrief=>({id:'test',name:'A familiar object',family:'objects',category:'Test',categoryId:'test',silhouette:'A connected shaped object',traits:['A shaped front','A supported body'],tags:[],parts:[20,60],colors:[{role:'body',colors:['black'],share:1,natural:true}],features,approaches:constructionApproaches('rounded-shell'),alternatives:[],status:'idea'});
const base={'brick-2x2-black':20};
const cost=(a:SubjectOpportunity)=>{
  const out:Record<string,number>={};
  for(const r of a.receipts)for(const p of [...r.parts,...r.carriers])out[p.id]=(out[p.id]??0)+p.count;
  for(const p of a.bodyReserve.reserved)out[p.id]=(out[p.id]??0)+p.count;
  return out;
};

describe('inventory opportunity evidence',()=>{
  it('keeps real fixture schemas and explicitly rejects unsupported connection IDs',()=>{
    const contexts=[small.stock,medium,large.stock].map(s=>createOpportunityContext(s));
    expect(contexts.map(c=>c.total)).toEqual([96,150,407]);
    expect(contexts[2].rejected.map(p=>p.id)).toEqual(['plate-3x8-dark-gray']);
    const invalid=createOpportunityContext({'curve-9x9-black':40,'plate-2x3-black':NaN,'wheel-1x1-black':4,'wheels-4x2-black':2,'slope-1x2-bogus':10});
    expect(invalid.total).toBe(0);expect(invalid.rejected).toHaveLength(5);
    expect(assessSubjectOpportunity(brief([feature('Housing',['curve'])]),invalid).tier).toBe('blocked');
  });

  it('reserves scarce exact singletons across features and the body on one immutable ledger',()=>{
    const stock={...base,'curve-1x2-black':1},ctx=createOpportunityContext(stock),before=JSON.stringify(ctx.stock);
    const a=assessSubjectOpportunity(brief([feature('Face',['curve'],1),feature('Tail',['curve'],1)]),ctx);
    expect(a.receipts.map(r=>r.allocated)).toEqual([1,0]);expect(a.blockers.some(b=>b.name==='Tail')).toBe(true);
    expect(a.receipts[0].singletonIds).toEqual(['curve-1x2-black']);
    for(const [id,n] of Object.entries(cost(a))){expect(n).toBeLessThanOrEqual(stock[id as keyof typeof stock]);expect(a.remaining[id]).toBe(stock[id as keyof typeof stock]-n);}
    expect(JSON.stringify(ctx.stock)).toBe(before);expect(assessSubjectOpportunity(brief([feature('Face',['curve'],1)]),ctx).receipts[0].allocated).toBe(1);
  });

  it('does not force every count-two feature into identical pairs but honors explicit compatible shape rules',()=>{
    const stock={...base,'curve-1x2-black':1,'curve-2x2-black':1},f=feature('Two contours',['curve']);
    expect(assessSubjectOpportunity(brief([f]),createOpportunityContext(stock)).receipts[0].allocated).toBe(2);
    f.opportunity={pairing:'same-shape'};
    expect(assessSubjectOpportunity(brief([f]),createOpportunityContext(stock)).blockers.some(b=>b.code==='pair-shape')).toBe(true);
    const compatible={...stock,'curve-1x2-dark-gray':1},paired=assessSubjectOpportunity(brief([f]),createOpportunityContext(compatible));
    expect(paired.receipts[0].parts.map(p=>p.id)).toEqual(['curve-1x2-black','curve-1x2-dark-gray']);expect(paired.blockers).toEqual([]);
    f.opportunity={pairing:'identical-id'};
    expect(assessSubjectOpportunity(brief([f]),createOpportunityContext(compatible)).blockers.some(b=>b.code==='pair-shape')).toBe(true);
  });

  it('only filters dimensions/ports when structured and leaves generic anatomy and whole geometry unchecked',()=>{
    const ctx=createOpportunityContext({...base,'curve-1x2-black':2}),f=feature('Contour',['curve']);
    expect(assessSubjectOpportunity(brief([f]),ctx).receipts[0].allocated).toBe(2);
    f.opportunity={w:2,d:2,heightPlates:2};expect(assessSubjectOpportunity(brief([f]),ctx).receipts[0].allocated).toBe(0);
    f.opportunity={port:{kind:'stud',direction:'top'}};expect(assessSubjectOpportunity(brief([f]),ctx).receipts[0].allocated).toBe(0);
    const generic=assessSubjectOpportunity({...brief([feature('Contour',['curve'])]),name:'Huge winged fox with broad shoulders'},ctx);
    expect(generic.receipts[0].structured).toBe(false);expect(generic.receipts[0].evidence).toBe('exact-allocation');
    expect(generic.geometryUnchecked).toContain('Contour');expect(generic.evidence).toBe('inventory-opportunity-estimate');
  });

  it('moves flexible features away from pieces needed for the separately reserved body',()=>{
    const stock={'brick-2x2-black':5,'tile-1x2-black':20},a=assessSubjectOpportunity(brief([feature('Surface',['brick','tile'],20)]),createOpportunityContext(stock));
    expect(a.blockers).toEqual([]);expect(a.receipts[0].parts).toEqual([{id:'tile-1x2-black',count:20,confidence:null}]);
    expect(a.bodyReserve.reserved).toEqual([{id:'brick-2x2-black',count:5,confidence:null}]);
    expect(a.status).toBe('adapt');
    const allTerminal=assessSubjectOpportunity(brief([feature('Surface',['tile'])]),createOpportunityContext({'tile-1x2-black':30}));
    expect(allTerminal.blockers.some(b=>b.code==='body-reserve')).toBe(true);
  });

  it('reports body span and footprint only from its reserved IDs, excluding an unused long plate',()=>{
    const stock={'brick-1x1-black':20,'plate-1x8-black':1,'curve-1x2-black':1},a=assessSubjectOpportunity(brief([feature('Contour',['curve'],1)]),createOpportunityContext(stock));
    expect(a.bodyReserve.reserved).toEqual([{id:'brick-1x1-black',count:5,confidence:null}]);
    expect(a.remaining['plate-1x8-black']).toBe(1);expect(a.bodyReserve.spanStuds).toBe(1);expect(a.bodyReserve.footprintCells).toBe(5);
  });

  it('compiles only an explicitly specified local static attachment and shares its actual carriers',()=>{
    const f=feature('Contour',['curve'],1);f.opportunity={carrier:{types:['plate'],count:1,connection:{parentPort:'stud:0:0',childPort:'grip:0:0'}}};
    const ctx=createOpportunityContext({...base,'curve-1x2-black':2,'plate-1x2-black':1});
    const a=assessSubjectOpportunity(brief([f,{...f,name:'Other contour'}]),ctx);
    expect(a.receipts.reduce((n,r)=>n+r.carriers.reduce((a,p)=>a+p.count,0),0)).toBe(1);
    expect(a.receipts.filter(r=>r.allocated>0).every(r=>r.evidence==='compiled-local-connection')).toBe(true);
    expect(a.blockers.some(b=>b.code==='carrier-parts')).toBe(true);
    const cached=ctx.techniqueCache.size;assessSubjectOpportunity(brief([f]),ctx);expect(ctx.techniqueCache.size).toBe(cached);
    const bad=feature('Cap',['brick'],1);bad.opportunity={carrier:{types:['curve'],count:1,connection:{parentPort:'stud:0:0',childPort:'grip:0:0'}}};
    expect(assessSubjectOpportunity(brief([bad]),ctx).blockers.some(b=>b.code==='local-connection')).toBe(true);
  });

  it('requires genuine wheel mount ports without deriving universal wheel counts from a chassis profile',()=>{
    const wheel=feature('Fixed wheel depictions',['roundplate'],4);wheel.opportunity={w:1,d:1,heightPlates:1,carrier:{types:['sidebrick'],count:4,w:1,d:1,heightPlates:3,connection:{parentPort:'side:0',childPort:'grip:0:0'}}};
    const b={...brief([wheel]),approaches:constructionApproaches('wheeled-chassis')},stock={...base,'roundplate-1x1-black':4,'sidebrick-1x1-black':4};
    const a=assessSubjectOpportunity(b,createOpportunityContext(stock));expect(a.blockers).toEqual([]);expect(a.receipts[0].evidence).toBe('compiled-local-connection');expect(a.receipts[0].carriers[0].count).toBe(4);
    expect(assessSubjectOpportunity(b,createOpportunityContext({...stock,'sidebrick-1x1-black':3})).receipts[0].allocated).toBe(3);
    const generic={...b,features:[feature('Running gear',['plate','roundplate'],2)]};
    expect(assessSubjectOpportunity(generic,createOpportunityContext({...base,'roundplate-1x1-black':4})).blockers).toContainEqual(expect.objectContaining({name:'Side-facing running-gear support',required:1,available:0}));
  });

  it('preserves original scan confidence without multiplying counts or treating missing metadata as certainty',()=>{
    const stock={...base,'curve-1x2-black':1},ctx=createOpportunityContext(stock,{confidence:{'curve-1x2-black':.2,'brick-2x2-black':.9}}),a=assessSubjectOpportunity(brief([feature('Contour',['curve'],1)]),ctx);
    expect(a.receipts[0].parts[0]).toEqual({id:'curve-1x2-black',count:1,confidence:.2});expect(a.confidence.minimum).toBe(.2);expect(a.confidence.cautionPieces).toBe(1);expect(a.confidence.note).toMatch(/not calibrated/);expect(ctx.total).toBe(21);
    const unknown=assessSubjectOpportunity(brief([feature('Contour',['curve'],1)]),createOpportunityContext(stock));expect(unknown.confidence.minimum).toBeNull();expect(unknown.confidence.unknownPieces).toBeGreaterThan(0);
    expect(createOpportunityContext(stock,{confidence:{'curve-1x2-black':2}}).confidenceWarnings).toEqual([{id:'curve-1x2-black',value:2}]);
  });
});
