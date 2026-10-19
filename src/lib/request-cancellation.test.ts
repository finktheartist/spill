import {describe,expect,it} from 'vitest';
import type {Card} from '../screens/Builds';
import {createBench,editBench,inspectBench} from './whole-model-workbench';
import {stopPendingRequests} from './request-cancellation';

const reason='Stopped to restore a saved run. This retained draft can be continued.';
function pending(phase:Card['phase']='designing'):Card {
 const stock={'plate-1x1-black':252},state=editBench(createBench(stock),{remove:[],add:[
  {partId:'plate-1x1-black',x:0,y:0,z:0,rot:0},
  {partId:'plate-1x1-black',x:0,y:0,z:1,rot:0},
 ]}).state;
 const preview=inspectBench(state).build!;
 return {key:'request',idea:{name:'Fixture',pitch:'Transition fixture only',estimatedParts:20,difficulty:1,keyParts:[],request:'Fixture',mode:'bucket'},phase,stage:'review',startedAt:100,rounds:2,
  preview,build:{...preview,name:'Earlier final handle'},partsUsed:2,improved:true,craftPass:true,
  verdict:{looksLike:'fixture',recognizable:4,complete:4,colors:4,impressive:4,fixes:[],review:'blind-v1',subjectMatched:true},
  checkpoint:{version:1,idea:{name:'Fixture',pitch:'A fixture',why:'Test only',length:1,width:1,height:1,palette:[],cells:2,worst:1,shortfall:0},stock:{...stock},state,decisions:1,revisions:0,reviews:0},
  log:[{text:'Previous safe state',tone:'work',t:7}]};
}
function freezeTree(value:unknown):void {
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){
  for(const child of Object.values(value))freezeTree(child);
  Object.freeze(value);
 }
}

describe('explicit typed-request cancellation',()=>{
 it.each(['queued','designing','checking','fixing','looking','judging'] as const)('marks pending %s failed and clears its final instructions handle',phase=>{
  const card=pending(phase),[stopped]=stopPendingRequests([card],reason);
  expect(stopped.phase).toBe('failed');expect(stopped.build).toBeUndefined();
  expect(stopped.preview).toBe(card.preview);expect(stopped.log).toEqual([...card.log,{text:reason,tone:'note',t:7}]);
 });

 it.each(['ready','failed'] as const)('leaves an already %s card completely unchanged',phase=>{
  const card=pending(phase),[retained]=stopPendingRequests([card],reason);
  expect(retained).toBe(card);expect(retained.build).toBe(card.build);expect(retained.log).toHaveLength(1);
 });

 it('preserves exact checkpoint ownership, raw stock, poses, stable IDs and prior grades',()=>{
  const card=pending(),snapshot=structuredClone(card),[stopped]=stopPendingRequests([card],reason);
  expect(stopped.checkpoint).toBe(card.checkpoint);expect(stopped.checkpoint).toEqual(snapshot.checkpoint);
  expect(stopped.verdict).toBe(card.verdict);expect(stopped.craftPass).toBe(true);
  expect(stopped.idea).toBe(card.idea);expect(stopped.partsUsed).toBe(2);expect(stopped.improved).toBe(true);
  expect(stopped.stage).toBe(card.stage);expect(stopped.startedAt).toBe(card.startedAt);expect(stopped.rounds).toBe(card.rounds);
  expect(card).toEqual(snapshot);
 });

 it('retains an existing preview in preference to an older build, or demotes the only build to a preview',()=>{
  const card=pending();expect(stopPendingRequests([card],reason)[0].preview).toBe(card.preview);
  const buildOnly={...card,preview:undefined};expect(stopPendingRequests([buildOnly],reason)[0].preview).toBe(buildOnly.build);
  const noGeometry={...card,build:undefined,preview:undefined,checkpoint:undefined};
  const [stopped]=stopPendingRequests([noGeometry],reason);expect(stopped.preview).toBeUndefined();expect(stopped.checkpoint).toBeUndefined();
 });

 it('does not regrade drafts, synthesize geometry or repeatedly append cancellation notes',()=>{
  const card={...pending(),craftPass:false,verdict:undefined,log:[]},[first]=stopPendingRequests([card],reason);
  expect(first.craftPass).toBe(false);expect(first.verdict).toBeUndefined();expect(first.preview).toBe(card.preview);
  expect(first.log).toEqual([{text:reason,tone:'note',t:0}]);
  const [second]=stopPendingRequests([first],reason);expect(second).toBe(first);expect(second.log).toHaveLength(1);
 });

 it('does not mutate deeply frozen cards, checkpoints, geometry, logs or the input array',()=>{
  const working=pending(),ready=pending('ready'),failed=pending('failed'),cards=[working,ready,failed],before=JSON.stringify(cards);
  freezeTree(cards);
  const stopped=stopPendingRequests(cards,reason);
  expect(stopped).not.toBe(cards);expect(stopped[0]).not.toBe(working);expect(stopped[0].log).not.toBe(working.log);
  expect(stopped[0].preview).toBe(working.preview);expect(stopped[0].checkpoint).toBe(working.checkpoint);
  expect(stopped[1]).toBe(ready);expect(stopped[2]).toBe(failed);expect(JSON.stringify(cards)).toBe(before);
  expect(stopPendingRequests([],reason)).toEqual([]);
 });
});
