import {describe,expect,it} from 'vitest';
import {pieceConfidence,PIECE_CONFIDENCE_LEGEND} from './piece-confidence';
import type {PieceConfidenceInput} from './piece-confidence';

describe('piece confidence evidence',()=>{
 it('uses the exact inclusive tier boundaries without rounding the score',()=>{
  for(const [score,tone] of [[0,'low'],[.599999,'low'],[.6,'medium'],[.849999,'medium'],[.85,'high'],[1,'high']] as const){
   expect(pieceConfidence({confidence:score})).toMatchObject({score,tone,confirmed:false});
  }
 });

 it('leaves absent or malformed legacy estimates unknown without clamping or inventing a score',()=>{
  expect(pieceConfidence({})).toMatchObject({score:null,tone:'unknown'});
  for(const confidence of [NaN,Infinity,-Infinity,-.000001,1.000001,'0.9',null]){
   expect(pieceConfidence({confidence} as PieceConfidenceInput)).toMatchObject({score:null,tone:'unknown'});
  }
 });

 it('prefers an explicitly preserved model estimate over the mutable legacy value',()=>{
  expect(pieceConfidence({confidence:1,modelConfidence:.4,confidenceSource:'model'})).toMatchObject({score:.4,tone:'low'});
  expect(pieceConfidence({confidence:.1,modelConfidence:.9})).toMatchObject({score:.9,tone:'high'});
  expect(pieceConfidence({confidence:1,modelConfidence:0})).toMatchObject({score:0,tone:'low'});
 });

 it('does not fall back when a preserved model estimate is explicitly null or malformed',()=>{
  for(const modelConfidence of [null,NaN,Infinity,-.1,1.1,'0.95']){
   expect(pieceConfidence({confidence:1,modelConfidence} as PieceConfidenceInput)).toMatchObject({score:null,tone:'unknown'});
  }
 });

 it('treats an unrecorded source as unknown even with numeric legacy or preserved fields',()=>{
  for(const confirmed of [false,true]){
   expect(pieceConfidence({confidence:.5,confidenceSource:'unrecorded',confirmed})).toMatchObject({score:null,tone:'unknown',confirmed});
   expect(pieceConfidence({confidence:1,modelConfidence:.95,confidenceSource:'unrecorded',confirmed})).toMatchObject({score:null,tone:'unknown',confirmed});
  }
 });

 it('does not turn human confirmation or a manual legacy 100 percent into model confidence',()=>{
  for(const confidence of [undefined,.5,1]){
   const result=pieceConfidence({confidence,confirmed:true,confidenceSource:'model'});
   expect(result).toMatchObject({score:null,tone:'unknown',confirmed:true});
   expect(result.detail).toContain('Human-confirmed.');
  }
 });

 it('keeps preserved scan evidence independent of human confirmation at every tier',()=>{
  for(const modelConfidence of [.2,.7,.95]){
   const unconfirmed=pieceConfidence({modelConfidence,confirmed:false});
   const confirmed=pieceConfidence({modelConfidence,confidence:1,confirmed:true});
   expect(confirmed.score).toBe(unconfirmed.score);expect(confirmed.tone).toBe(unconfirmed.tone);
   expect(confirmed.confirmed).toBe(true);expect(unconfirmed.confirmed).toBe(false);
   expect(confirmed.detail).toContain('preserved scan estimate');
  }
 });

 it('labels the estimate honestly and leaves a frozen input unchanged',()=>{
  const input=Object.freeze({confidence:1,modelConfidence:.849999,confidenceSource:'model' as const,confirmed:true});
  const before=JSON.stringify(input),result=pieceConfidence(input);
  expect(JSON.stringify(input)).toBe(before);expect(result.label).toBe('Medium scan estimate');
  expect(result.detail).toContain("model's self-reported estimate, not a calibrated probability");
  expect(result.detail).toContain('Human confirmation is separate.');
  expect(pieceConfidence({}).label).toBe('Scan estimate unknown');
  expect(PIECE_CONFIDENCE_LEGEND).toContain('not a calibrated probability');
 });
});
