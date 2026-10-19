import {describe,expect,it} from 'vitest';
import type {Card} from '../screens/Builds';
import type {Mode} from './gemini';
import type {Build} from './bricks';
import {constructionIssues} from './construction';
import {invalidateRequestStock} from './request-stock-freshness';
import {createBench,editBench} from './whole-model-workbench';

// Legal geometry is a stock/transition fixture, not evidence of visual craft.
const stock={'plate-1x2-tan':19,'tile-1x2-black':1};
function build():Build {
 return {name:'Stock recheck fixture',description:'Synthetic connected geometry',engine:'connections-v2',steps:Array.from({length:20},(_,z)=>({caption:'Attach',parts:[{partId:z===19?'tile-1x2-black':'plate-1x2-tan',x:0,y:0,z,rot:0}]}))};
}
function ready(mode?:Mode):Card {
 return {key:'typed-request',idea:{name:'Fixture',pitch:'Test only',estimatedParts:20,difficulty:1,keyParts:[],request:'Fixture',...(mode?{mode}:{})},
  phase:'ready',stage:'review',startedAt:100,rounds:0,build:build(),partsUsed:20,craftPass:true,
  verdict:{looksLike:'fixture',recognizable:4,complete:4,colors:4,impressive:4,fixes:[],review:'blind-v1',subjectMatched:true},
  log:[{text:'Reviewed original model',tone:'good',t:10}]};
}

describe('typed request stock freshness',()=>{
 it('removes the final-build handle when a required singleton disappears, preserving only a stale preview',()=>{
  const card=ready('bucket'),before=structuredClone(card),next={'plate-1x2-tan':19};
  expect(constructionIssues(card.build!,stock,24)).toEqual([]);
  const [result]=invalidateRequestStock([card],next);
  expect(result.phase).toBe('failed');expect(result.craftPass).toBe(false);expect(result.build).toBeUndefined();
  expect(result.preview).toBe(card.build);expect(result.log.at(-1)?.text).toContain('Inventory changed');
  expect(result.log.at(-1)?.text).toContain('tile-1x2-black');expect(result.log.at(-1)?.tone).toBe('note');
  expect(card).toEqual(before);expect(next).toEqual({'plate-1x2-tan':19});
 });

 it('rechecks exact colors/counts and treats missing mode as bucket',()=>{
  const card=ready();
  const [wrongColor]=invalidateRequestStock([card],{'plate-1x2-tan':19,'tile-1x2-white':1});
  expect(wrongColor.phase).toBe('failed');expect(wrongColor.build).toBeUndefined();
  const [shortCount]=invalidateRequestStock([card],{'plate-1x2-tan':18,'tile-1x2-black':1});
  expect(shortCount.phase).toBe('failed');expect(shortCount.log.at(-1)?.text).toContain('bucket has 18');
 });

 it('preserves a compatible completed bucket model and its existing draft gate without regrading',()=>{
  const good=ready('bucket'),draft={...ready(),craftPass:false};
  const next={...stock,'brick-1x1-red':100};
  const cards=[good,draft],out=invalidateRequestStock(cards,next);
  expect(out).not.toBe(cards);expect(out[0]).toBe(good);expect(out[1]).toBe(draft);
  expect(out[0].build).toBe(good.build);expect(out[1].craftPass).toBe(false);
 });

 it.each(['accurate','super'] as const)('leaves a completed %s request unchanged when owned stock cannot supply it',mode=>{
  const card=ready(mode);
  expect(invalidateRequestStock([card],{})[0]).toBe(card);
 });

 it('reruns actual geometry checks even when the new stock has every required piece',()=>{
  const overlap=ready('bucket');overlap.build!.steps[19].parts[0].z=18;
  const disconnected=ready('bucket');disconnected.build!.steps[19].parts[0].x=5;disconnected.build!.steps[19].parts[0].z=0;
  const outside=ready('bucket');outside.build!.steps.forEach(step=>step.parts.forEach(p=>p.x=24));
  const ungrounded=ready('bucket');ungrounded.build!.steps.forEach(step=>step.parts.forEach(p=>p.z++));
  for(const card of [overlap,disconnected,outside,ungrounded]){
   expect(constructionIssues(card.build!,stock,24).length).toBeGreaterThan(0);
   const [result]=invalidateRequestStock([card],stock);
   expect(result.phase).toBe('failed');expect(result.build).toBeUndefined();expect(result.preview).toBe(card.build);
  }
 });

 it('rechecks actual centered contacts rather than accepting matching counts alone',()=>{
  const card=ready('bucket');
  card.build={name:'Bad centered join',description:'Contact regression',engine:'connections-v2',steps:[
   {caption:'Root',parts:[{partId:'jumper-2x2-tan',x:0,y:0,z:0,rot:0}]},
   {caption:'Wrong socket',parts:[{partId:'brick-1x1-tan',x:0,y:0,z:1,rot:0}]},
  ]};
  const matching={'jumper-2x2-tan':1,'brick-1x1-tan':1};
  expect(invalidateRequestStock([card],matching)[0].phase).toBe('failed');
  card.build.steps[1].parts[0].x=.5;card.build.steps[1].parts[0].y=.5;
  expect(constructionIssues(card.build,matching,24)).toEqual([]);
  expect(invalidateRequestStock([card],matching)[0]).toBe(card);
 });

 it.each(['queued','designing','checking','fixing','looking','judging'] as const)('marks pending %s requests failed without exposing an old complete handle',phase=>{
  for(const mode of ['bucket','accurate','super'] as const){
   const card={...ready(mode),phase},[result]=invalidateRequestStock([card],stock);
   expect(result.phase).toBe('failed');expect(result.build).toBeUndefined();expect(result.preview).toBe(card.build);
   expect(result.log.at(-1)?.text).toContain('unfinished request was stopped');
  }
 });

 it('does not repeat stale notices or mutate frozen inputs',()=>{
  const card=ready('bucket');Object.freeze(card.log);Object.freeze(card);
  const cards=Object.freeze([card]),next=Object.freeze({'plate-1x2-tan':19});
  const [stale]=invalidateRequestStock(cards as unknown as Card[],next);
  expect(card.phase).toBe('ready');expect(card.log).toHaveLength(1);
  expect(invalidateRequestStock([stale],next)[0]).toBe(stale);expect(stale.log).toHaveLength(2);
 });

 it('clears a failed request checkpoint after its raw stock changes so continuation cannot reuse a stale ledger',()=>{
  const card=ready('bucket');card.phase='failed';
  let state=createBench(stock);const parts=card.build!.steps.flatMap(s=>s.parts);
  for(let i=0;i<parts.length;i+=8)state=editBench(state,{remove:[],add:parts.slice(i,i+8)}).state;
  card.checkpoint={version:1,idea:{name:'Fixture',pitch:'A test fixture',why:'Test only',length:2,width:1,height:4,palette:[],cells:20,worst:1,shortfall:0},stock:{...stock},state,decisions:3,revisions:0,reviews:0};
  expect(invalidateRequestStock([card],stock)[0]).toBe(card);
  const [changed]=invalidateRequestStock([card],{'plate-1x2-tan':19});
  expect(changed.checkpoint).toBeUndefined();expect(changed.phase).toBe('failed');expect(changed.log.at(-1)?.text).toContain('cannot be continued');expect(card.checkpoint).toBeDefined();
 });

 it('handles a missing or malformed completed build conservatively',()=>{
  const missing=ready('bucket');missing.preview=missing.build;missing.build=undefined;
  const broken=ready('bucket');broken.build={...build(),steps:null} as unknown as Build;
  for(const card of [missing,broken]){
   const [result]=invalidateRequestStock([card],stock);
   expect(result.phase).toBe('failed');expect(result.build).toBeUndefined();expect(result.log.at(-1)?.text).toContain('Inventory changed');
  }
  expect(invalidateRequestStock([broken],stock)[0].preview).toBeUndefined();
 });
});
