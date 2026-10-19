import {describe,it,expect} from 'vitest';
import {pieceGuessTags,initialPieceGuessState,editPieceGuessState,manualPieceTags,SCAN_FEATURE_TAG_SCHEMA} from './piece-guess-tags';
import {editPartTag} from './part-tag-edit';

describe('editable AI feature guesses',()=>{
 it('adapts existing close-up clues, including zero studs, without a proposed identity',()=>{
  const guesses=pieceGuessTags({size:'3 × 3',features:{outline:'round',heightPlates:1,topShape:'flat',studsOnTop:0,studLayout:'none',openStuds:false}});
  expect(guesses).toEqual({size:['3x3'],height:['1'],shape:['round'],profile:['flat'],top:['smooth'],studs:['0']});
  expect(pieceGuessTags({kind:{type:'brick',w:2,d:4},catalog:{num:'3001'},confirmed:true})).toEqual({});
 });
 it('uses dedicated shape/connection guesses beyond the older scan enums',()=>{
  const state=initialPieceGuessState('azure',{size:'1x2',features:{outline:'other',topShape:'curved-inverted'},tags:{family:['bracket'],shape:['l-shape'],connections:['clip','axle-hole'],details:['notch']}});
  expect(state.tags).toEqual({...state.guesses,color:['azure']});
  expect(state.guesses).toMatchObject({family:['bracket'],size:['1x2'],profile:['curved','inverted'],shape:['l-shape'],connections:['clip','axle-hole'],details:['notch']});
  expect(manualPieceTags(state)).toEqual({color:['azure']});
 });
 it('keeps observed color independent and rejects catalog-category/identity-derived guesses',()=>{
  const state=initialPieceGuessState('red',{description:'not a brick',tags:{color:['blue'],category:['bricks'],family:['plate']}});
  expect(state.tags).toEqual({family:['plate'],color:['red']});
  expect(initialPieceGuessState('unidentified').tags).toEqual({});
 });
 it('does not round height units from a three-axis size or invent solid studs from false alone',()=>{
  expect(pieceGuessTags({size:'1x2x2/3',features:{openStuds:false}})).toEqual({size:['1x2']});
  expect(pieceGuessTags({features:{heightPlates:0,studLayout:'other',outline:'other',handedness:'unknown'}})).toEqual({});
 });
 it('retains a rectangular footprint as square when its observed axes agree',()=>{
  expect(pieceGuessTags({size:'2x2',features:{outline:'rectangle'}}).shape).toEqual(['square']);
  expect(pieceGuessTags({size:'2x3',features:{outline:'rectangle'}}).shape).toEqual(['rectangle']);
 });
 it('drops contradictory top clues rather than picking an authoritative interpretation',()=>{
  for(const features of [{studsOnTop:0,studLayout:'grid'},{studsOnTop:2,studLayout:'none'}]){
   expect(pieceGuessTags({features:{...features,outline:'wedge'}})).toEqual({shape:['wedge']});
  }
 });
 it('promotes edited groups to manual constraints while keeping untouched guesses soft',()=>{
  const initial=initialPieceGuessState('white',{tags:{family:['brick'],size:['2x2'],profile:['curved']}}),saved=structuredClone(initial);
  const changed=editPieceGuessState(initial,editPartTag(initial.tags,'family',['plate']),'family');
  expect(changed.guesses).toEqual({size:['2x2'],profile:['curved']});
  expect(manualPieceTags(changed)).toEqual({family:['plate'],color:['white']});
  expect(initial).toEqual(saved);
  const recolored=editPieceGuessState(changed,editPartTag(changed.tags,'color',['blue']),'color');
  expect(recolored.guesses).toEqual(changed.guesses);expect(manualPieceTags(recolored).color).toEqual(['blue']);
 });
 it('never restores removed guesses or adds extra features during manual edits',()=>{
  const start=initialPieceGuessState('red',{tags:{profile:['curved'],size:['1x2']}});
  const removed=editPieceGuessState(start,editPartTag(start.tags,'profile',[]),'profile');
  expect(removed.guesses).toEqual({size:['1x2']});expect(removed.tags.profile).toBeUndefined();
  const later=editPieceGuessState(removed,editPartTag(removed.tags,'connections',['clip']),'connections');
  expect(later.tags).toEqual({size:['1x2'],color:['red'],connections:['clip']});
  const cleared=editPieceGuessState(later,{},null);expect(cleared).toEqual({tags:{},guesses:{}});expect(manualPieceTags(cleared)).toEqual({});
 });
 it('clears stale top/count guesses when the user explicitly corrects a contradiction',()=>{
  const before=initialPieceGuessState('white',{tags:{top:['studded','grid-studs'],studs:['4'],connections:['stud','anti-stud']}});
  const after=editPieceGuessState(before,editPartTag(before.tags,'top',['smooth']),'top');
  expect(after.guesses).toEqual({connections:['anti-stud']});expect(manualPieceTags(after)).toEqual({top:['smooth'],color:['white']});
 });
 it('requests all supported family features and unrestricted valid sizes/counts',()=>{
  const p=SCAN_FEATURE_TAG_SCHEMA.properties;
  expect(p.family.items.enum).toContain('technic');expect(p.profile.items.enum).toContain('inverted');
  for(const key of ['size','height','studs','details'])expect(p[key].items).not.toHaveProperty('enum');
  expect(p).not.toHaveProperty('color');expect(p).not.toHaveProperty('category');
 });
 it('preserves AI provenance in groups changed only by indirect contradiction cleanup',()=>{
  const before=initialPieceGuessState('white',{tags:{top:['studded'],studs:['4'],connections:['stud','clip'],profile:['curved','inverted'],details:['inverted','notch']}});
  const smooth=editPieceGuessState(before,editPartTag(before.tags,'top',['smooth']),'top');
  expect(smooth.guesses.connections).toEqual(['clip']);expect(manualPieceTags(smooth)).not.toHaveProperty('connections');
  const profile=editPieceGuessState(smooth,editPartTag(smooth.tags,'profile',['curved']),'profile');
  expect(profile.guesses.details).toEqual(['notch']);expect(manualPieceTags(profile)).not.toHaveProperty('details');
 });
});
