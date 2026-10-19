import {describe,it,expect} from 'vitest';
import stock from '../fixtures/large-pile-stock.json';
import {authoredWholeAnimalTestLayouts,testBlueprint} from '../../../test/whole-animal-fixtures';
import {composeWholeAnimal} from '../assembly-composer/animal-whole';
import {wholeAnimalAttachmentRequests,wholeAnimalAttachmentScore} from './whole-animal-search';
import type {WholeAnimalConnection} from './whole-animal-connections';
describe('explicit whole-animal attachment objectives',()=>{
 it('limits searches to earlier anatomical carriers and preserves requested stock/roles',()=>{
  const op=(role:WholeAnimalConnection['role'],parent=-1):WholeAnimalConnection=>({partId:'plate-2x4-reddish-brown',role,parent,parentPort:'stud:0:0',childPort:'grip:0:0',twist:0});
  const prefix={rootRotation:0 as const,operations:[op('head'),op('ear-left',0),op('eye-left',0),op('neck',0)]},requests=[op('muzzle',2),op('nose',4),op('chest',1),op('leg-front-left',6)];
  const before=JSON.stringify({prefix,requests}),out=wholeAnimalAttachmentRequests(prefix,requests);
  expect(out[0].parents).toEqual([0]);expect(out[1].parents).toEqual([4]);expect(out[2].parents).toEqual([3]);expect(out[3].parents).toEqual([6]);
  expect(out.map(({parents:_,...o})=>o)).toEqual(requests);expect(JSON.stringify({prefix,requests})).toBe(before);
  expect(wholeAnimalAttachmentRequests({rootRotation:0,operations:[]},[op('head')])[0].parents).toEqual([-1]);
 });
 it('ranks centered forward facial anatomy ahead of an off-center or backward snout',()=>{
  const layout=authoredWholeAnimalTestLayouts()[0],b=testBlueprint(composeWholeAnimal(stock.stock,layout)),score=wholeAnimalAttachmentScore(b,[],0),bad=structuredClone(layout);
  for(const p of bad.parts)if(p.role==='muzzle'||p.role==='nose'){p.x+=2;p.y+=3;}
  expect(Number.isFinite(score(layout,layout.parts.length))).toBe(true);expect(score(layout,layout.parts.length)).toBeLessThan(score(bad,bad.parts.length));
 });
 it('keeps the objective invariant under whole-origin translation as lower parts are added',()=>{
  const layout=authoredWholeAnimalTestLayouts()[0],b=testBlueprint(composeWholeAnimal(stock.stock,layout)),score=wholeAnimalAttachmentScore(b,[],0),moved=structuredClone(layout);
  for(const p of moved.parts){p.x+=7;p.y-=3;p.z+=2.4;}
  expect(score(moved,moved.parts.length)).toBeCloseTo(score(layout,layout.parts.length),6);
 });
 it('ranks a coherent spine and paired stance ahead of a sideways torso even in permissive envelopes',()=>{
  const layout=authoredWholeAnimalTestLayouts()[0],b=testBlueprint(composeWholeAnimal(stock.stock,layout));
  // Remove the envelope preference so this checks actual mass relationships.
  for(const r of b.regions){r.min[0]=-10;r.max[0]=20;r.tolerance=1;}
  const score=wholeAnimalAttachmentScore(b,[],0),bad=structuredClone(layout);
  for(const p of bad.parts)if(['torso','hips','leg-rear-left','leg-rear-right'].includes(p.role))p.x+=2;
  expect(score(layout,layout.parts.length)).toBeLessThan(score(bad,bad.parts.length));
  expect(layout.parts.map(p=>p.partId)).toEqual(bad.parts.map(p=>p.partId));
 });
});
