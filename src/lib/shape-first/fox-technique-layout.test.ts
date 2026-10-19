import {describe,it,expect} from 'vitest';
import large from '../fixtures/large-pile-stock.json';
import fixture from '../fixtures/fox-improv-test-layouts.json';
import {createFoxImprovContext,composeFoxImprovisation} from '../assembly-composer/animal-improv';
import {foxLayoutProposal,type FoxHeadLayout} from './fox-head-layout';
import {foxTechniqueChoices} from './fox-techniques';
import {expandFoxTechniqueLayout,type FoxTechniqueLayout} from './fox-technique-layout';

describe('small technique expansion inside fresh head layouts',()=>{
 const context=createFoxImprovContext(large.stock)!;
 const choices=foxTechniqueChoices(context.available);
 it('preserves free layouts and does not count prose as technique use',()=>{
  const input=structuredClone(fixture.layouts[1]) as FoxHeadLayout;
  input.description='Claims to use a cheek lesson, but lists no compiled technique.';
  const result=expandFoxTechniqueLayout(input,choices);
  expect(result.layout).toEqual(input);expect(result.uses).toEqual([]);
  expect(()=>composeFoxImprovisation(context,foxLayoutProposal(context,result.layout))).not.toThrow();
 });
 it('expands every selected piece and records target roles and exact costs without mutation',()=>{
  expect(choices.length).toBeGreaterThan(0);
  const choice=choices[0],input:FoxTechniqueLayout={id:'tiny-test',description:'Partial layout, not a complete Fox',parts:[],
   techniques:[{choiceId:choice.id,x:1,y:2,z:4,rot:90,roles:choice.parts.map(()=> 'head')}]};
  const original=structuredClone(input),result=expandFoxTechniqueLayout(input,choices);
  expect(input).toEqual(original);expect(result.layout.parts).toHaveLength(choice.parts.length);
  expect(result.uses[0]).toMatchObject({choiceId:choice.id,studyId:choice.studyId,cost:choice.cost,targetParts:result.layout.parts,evidence:'expanded-compiled-technique'});
  expect(result.uses[0].layoutIndices).toEqual(choice.parts.map((_,i)=>i));
  expect(()=>composeFoxImprovisation(context,foxLayoutProposal(context,result.layout))).toThrow();
 });
 it('rejects unavailable choices, malformed bindings and excessive placement arrays',()=>{
  const choice=choices[0],placement={choiceId:choice.id,x:0,y:0,z:0,rot:0 as const,roles:choice.parts.map(()=> 'head' as const)};
  const input:FoxTechniqueLayout={id:'test',description:'Test',parts:[],techniques:[placement]};
  expect(()=>expandFoxTechniqueLayout(input,[])).toThrow('not offered');
  expect(()=>expandFoxTechniqueLayout({...input,techniques:[{...placement,roles:[]}]},choices)).toThrow();
  expect(()=>expandFoxTechniqueLayout({...input,techniques:[placement,placement,placement,placement]},choices)).toThrow('at most three');
 });
 it('counts all technique pieces together with free pieces toward the head bound',()=>{
  const choice=choices[0],part=(fixture.layouts[0] as FoxHeadLayout).parts[0];
  expect(()=>expandFoxTechniqueLayout({id:'over-budget',description:'Test',parts:Array.from({length:24},()=>({...part})),
   techniques:[{choiceId:choice.id,x:0,y:0,z:0,rot:0,roles:choice.parts.map(()=> 'head')}]},choices)).toThrow('head/neck limit is 24');
 });
});
