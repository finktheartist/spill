import {describe,it,expect} from 'vitest';
import large from '../fixtures/large-pile-stock.json';
import fixtures from '../fixtures/fox-improv-test-layouts.json';
import {createFoxImprovContext,composeFoxImprovisation,foxImprovIssues} from '../assembly-composer/animal-improv';
import {frame} from '../connections';
import {foxLayoutProposal,foxLayoutDiagnostics,type FoxHeadLayout} from './fox-head-layout';
const context=createFoxImprovContext(large.stock)!;
const layout=(index=0)=>structuredClone(fixtures.layouts[index]) as FoxHeadLayout;
describe('fresh target layout to real connector operations',()=>{
 it('compiles both independent fixtures and preserves every world frame',()=>{
  for(const l of [layout(),layout(1)]){
   const p=foxLayoutProposal(context,l),c=composeFoxImprovisation(context,p);
   expect(foxImprovIssues(c)).toEqual([]);expect(p.operations).toHaveLength(l.parts.length);
   const all=c.build.steps.flatMap(s=>s.parts),receipt=c.receipts.find(r=>r.id==='head-neck')!;
   // Whole-build normalization shifts only XY. Compare relative solid frames,
   // with exact Z and geometry, independent of the new connector graph order.
   const wanted=l.parts.map(p=>frame({...p,z:p.z/.4}));
   const actual=receipt.indices.map(i=>frame(all[i]));
   const signature=(fs:ReturnType<typeof frame>[])=>{const min=[0,1,2].map(a=>Math.min(...fs.map(f=>f.bounds.min[a])));return fs.map(f=>JSON.stringify([f.bounds.min.map((n,a)=>+(n-min[a]).toFixed(5)),f.bounds.max.map((n,a)=>+(n-min[a]).toFixed(5))])).sort();};
   expect(signature(actual)).toEqual(signature(wanted));
  }
 });
 it('does not snap a floating eye onto a nearby carrier',()=>{
  const l=layout();l.parts.find(p=>p.role==='eye-left')!.x+=.25;
  expect(()=>foxLayoutProposal(context,l)).toThrow('No real connector path');
 });
 it('rejects unsupported IDs, nonfinite poses, off-layer heights and excess parts',()=>{
  for(const mutate of [(l:FoxHeadLayout)=>l.parts[0].partId='plate-3x8-dark-gray',(l:FoxHeadLayout)=>l.parts[0].z=NaN,(l:FoxHeadLayout)=>l.parts[0].z=3.7,(l:FoxHeadLayout)=>l.parts.push(...l.parts)]){
   const l=layout();mutate(l);expect(()=>foxLayoutProposal(context,l)).toThrow();
  }
 });
 it('requires an actual chest boundary, then keeps collision authority unchanged',()=>{
  const floating=layout();floating.parts.forEach(p=>p.z+=.4);
  expect(()=>foxLayoutProposal(context,floating)).toThrow('No neck part mates');
  const overlap=layout();overlap.parts.push({...overlap.parts.find(p=>p.role==='eye-left')!});
  const p=foxLayoutProposal(context,overlap);expect(()=>composeFoxImprovisation(context,p)).toThrow();
  expect(JSON.stringify(foxLayoutDiagnostics(context,overlap))).toContain('overlap');
 });
});
