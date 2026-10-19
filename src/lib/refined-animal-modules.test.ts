import { describe, expect, it } from 'vitest';
import { refinedPlan, refinedAnimalCandidates, refinedAnimalReceipts } from './refined-animal-modules';
import { animalModuleCandidates, allocatedModuleReceipts } from './animal-modules';
import { compileComponents } from './component-kit';
import { buildCounts, recipeExample } from './library';
import { constructionIssues } from './construction';
import { partCount, parsePartId, voxels } from './bricks';
import data from '../../test/fixtures/photo-stock.json';
import reviews from '../../test/fixtures/refined-reviews.json';
import comparison from '../../test/fixtures/comparison.json';

const stock: Record<string,number> = data.stock;
const original=structuredClone(stock), matches=refinedAnimalCandidates(stock);
const volume=(b: ReturnType<typeof recipeExample>)=>b.steps.flatMap(s=>s.parts).flatMap(p=>voxels(parsePartId(p.partId)!,p).map(c=>c.join(','))).sort();

describe('focused hound refinement',()=>{
 it('retains three whole-inventory alternatives and rejects the unavailable fourth',()=>{
  expect(matches.map(m=>m.recipeId)).toEqual(['components:refined-hound-low-swept','components:refined-hound-low-upright','components:refined-hound-tall-swept']);
  expect(matches.map(m=>partCount(m.build))).toEqual([49,49,54]);
  expect(stock).toEqual(original);
  // The raised tail and tall legs compete for the same brown bricks.
  expect(refinedAnimalCandidates({...stock,'brick-1x2-reddish-brown':stock['brick-1x2-reddish-brown']+1}).map(m=>m.recipeId)).toContain('components:refined-hound-tall-upright');
 });
 it.each(matches)('$recipeId preserves authored geometry and partitions into connected modules',match=>{
  const [,stance,tail]=/^components:refined-hound-(low|tall)-(swept|upright)$/.exec(match.recipeId)!;
  const {recipe,summary}=compileComponents(refinedPlan(stance as 'low'|'tall',tail as 'swept'|'upright'));
  expect(summary.interfaces.every(i=>i.contacts>=2)).toBe(true);
  expect(constructionIssues(match.build,stock,24)).toEqual([]);
  expect(volume(match.build)).toEqual(volume(recipeExample(recipe)));
  const receipts=refinedAnimalReceipts(match),totals:Record<string,number>={};
  expect(receipts).toHaveLength(4);
  const restored=receipts.flatMap(r=>r.build.steps.flatMap(s=>s.parts).map(p=>({...p,x:p.x+r.placement[0],y:p.y+r.placement[1],z:p.z+r.placement[2]})));
  const signatures=(ps:typeof restored)=>ps.map(p=>JSON.stringify([p.partId,p.x,p.y,p.z,p.rot])).sort();
  expect(signatures(restored)).toEqual(signatures(match.build.steps.flatMap(s=>s.parts)));
  for(const r of receipts){
   expect(constructionIssues(r.build,r.parts,24)).toEqual([]);
   expect(buildCounts(r.build)).toEqual(r.parts);
   for(const [id,n] of Object.entries(r.parts))totals[id]=(totals[id]??0)+n;
  }
  expect(totals).toEqual(match.parts);
  for(const [id,n] of Object.entries(totals))expect(n).toBeLessThanOrEqual(stock[id]??0);
  const feet=match.build.steps.flatMap(s=>s.parts).filter(p=>p.z===0);
  expect(feet).toHaveLength(4);
  expect(feet.every(p=>p.partId==='plate-1x2-reddish-brown')).toBe(true);
  const head=receipts.find(r=>r.id==='animal-head-hound')!;
  expect(head.parts['invslope-2x2-white']).toBe(1);
  expect(Object.keys(head.parts).some(id=>id.endsWith('-tan'))).toBe(false);
  for(let n=1;n<=match.build.steps.length;n++)expect(constructionIssues({...match.build,steps:match.build.steps.slice(0,n)},stock,24).filter(i=>i.kind!=='loose')).toEqual([]);
 });
 it('requires the shaped muzzle and exact eye stock, and respects the budget',()=>{
  expect(refinedAnimalCandidates({...stock,'invslope-2x2-white':0})).toEqual([]);
  expect(refinedAnimalCandidates({...stock,'tile-1x1-black':1})).toEqual([]);
  expect(refinedAnimalCandidates(stock,48)).toEqual([]);
 });
 it('rejects receipts for a mismatched plan',()=>{
  expect(()=>allocatedModuleReceipts(refinedPlan('low','upright'),matches[0])).toThrow('does not match');
 });
 it('binds standalone and comparative reviews to the exact reviewed builds',()=>{
  const reviewed=matches.find(m=>m.recipeId==='components:refined-hound-low-upright')!;
  expect(reviews[0].buildSignature).toBe(JSON.stringify(reviewed.build));
  expect(comparison.afterSignature).toBe(JSON.stringify(reviewed.build));
  const before=animalModuleCandidates(stock).find(m=>m.recipeId==='components:animal-kit-hound-low-upright')!;
  expect(comparison.beforeSignature).toBe(JSON.stringify(before.build));
 });
});
