import {describe,it,expect} from 'vitest';
import {createOpportunityContext} from '../build-atlas/opportunity';
import {assessIdeaParts} from './idea-opportunity';
import {selectDistinctIdeas} from './discovery';
import type {ShapeIdea,RankedIdea} from './pipeline';
const stock={'brick-2x2-white':30,'curve-1x2-black':2,'plate-1x2-white':6};
const idea=(overlap=false):ShapeIdea=>({name:'Workshop machine',pitch:'Static representation',why:'',length:6,width:4,height:5,palette:[{role:'body',color:'white',cells:40}],
 features:[{feature:'Curved hood',part:'curve',color:'black',pieces:[{partId:'curve-1x2-black',count:2}],carriers:[{partId:'plate-1x2-white',count:1}]},
 {feature:'Raised workbed',part:'plate',color:'white',pieces:[{partId:overlap?'curve-1x2-black':'plate-1x2-white',count:2}],carriers:[]}]});
describe('automatic subject piece plans',()=>{
 it('rejects spending the same scarce contour pair on two defining features',()=>{
  const result=assessIdeaParts(idea(true),createOpportunityContext(stock),20);
  expect(result.tier).toBe('blocked');expect(result.blockers.join()).toContain('only 0 remain');expect(stock['curve-1x2-black']).toBe(2);
 });
 it('pays for carriers and preserves a separate exact body reserve',()=>{
  const result=assessIdeaParts(idea(),createOpportunityContext(stock),20);
  expect(result.tier).toBe('scarce');expect(result.allocations[0].carriers).toEqual([{partId:'plate-1x2-white',count:1}]);
  const billed:Record<string,number>={};for(const a of result.allocations)for(const p of [...a.pieces,...a.carriers])billed[p.partId]=(billed[p.partId]??0)+p.count;
  for(const p of result.bodyReserved)billed[p.partId]=(billed[p.partId]??0)+p.count;
  for(const[id,n]of Object.entries(stock))expect((billed[id]??0)+result.remaining[id]).toBe(n);
  expect(result.bodyReserved.reduce((n,p)=>n+p.count,0)).toBe(5);expect(result.geometryUnchecked).toHaveLength(3);
 });
 it('requires exact feature evidence without pretending a missing plan makes the subject impossible',()=>{
  const input=idea();delete input.features;
  expect(assessIdeaParts(input,createOpportunityContext(stock),20).tier).toBe('unverified');
 });
 it('rejects unsupported nominal IDs and missing carrier copies',()=>{
  const input=idea();input.features![0].carriers=[{partId:'plate-3x8-dark-gray',count:1}];
  expect(assessIdeaParts(input,createOpportunityContext({...stock,'plate-3x8-dark-gray':1}),20).blockers.join()).toContain('no usable exact part geometry');
  input.features![0].carriers=[{partId:'plate-1x2-white',count:7}];
  expect(assessIdeaParts(input,createOpportunityContext(stock),20).tier).toBe('blocked');
 });
 it('rejects feature declarations contradicted by the actual reserved shape/color',()=>{
  const input=idea();input.features![0].part='slope';input.features![0].color='orange';
  expect(assessIdeaParts(input,createOpportunityContext(stock),20).blockers.join()).toContain('declared orange slope');
 });
 it('preserves unknown confidence and flags doubtful critical pieces without changing stock counts',()=>{
  const unknown=assessIdeaParts(idea(),createOpportunityContext(stock),20);
  expect(unknown.confidence.minimum).toBeNull();expect(unknown.confidence.unknownCopies).toBeGreaterThan(0);
  const known=assessIdeaParts(idea(),createOpportunityContext(stock,{confidence:{'curve-1x2-black':.2}}),20);
  expect(known.confidence.cautionCopies).toBe(2);expect(known.confidence.minimum).toBe(.2);expect(known.remaining).toEqual(unknown.remaining);
 });
 it('does not let a new category displace a better supported subject',()=>{
  const candidate:RankedIdea={...idea(),name:'Machine',worst:.5,cells:40,shortfall:0,discovery:{family:'machines',concept:'machine',form:'hood and bed'},pieceOpportunity:{...assessIdeaParts(idea(),createOpportunityContext(stock),20),tier:'candidate'}};
  const scarce:RankedIdea={...candidate,name:'Animal',discovery:{family:'animals',concept:'animal',form:'body and ears'},pieceOpportunity:{...candidate.pieceOpportunity!,tier:'scarce'}};
  expect(selectDistinctIdeas([scarce,candidate],1,[],'pile').selected[0].name).toBe('Machine');
 });
});
