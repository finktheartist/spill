export interface PieceConfidenceInput {
 confidence?:number;
 modelConfidence?:number|null;
 confidenceSource?:'model'|'unrecorded';
 confirmed?:boolean;
}

export interface PieceConfidenceResult {
 tone:'high'|'medium'|'low'|'unknown';
 score:number|null;
 label:string;
 detail:string;
 confirmed:boolean;
}

export const PIECE_CONFIDENCE_LEGEND="Scan confidence is the model's self-reported estimate, not a calibrated probability. Human confirmation is separate.";

/** Human confirmation never substitutes for a missing model estimate. */
export function pieceConfidence(e:PieceConfidenceInput):PieceConfidenceResult {
 const confirmed=e.confirmed===true;
 const hasPreservedEstimate=e.modelConfidence!==undefined;
 const raw=e.confidenceSource==='unrecorded'||e.modelConfidence===null||(confirmed&&!hasPreservedEstimate)
  ?undefined
  :hasPreservedEstimate?e.modelConfidence:e.confidence;
 const score=typeof raw==='number'&&Number.isFinite(raw)&&raw>=0&&raw<=1?raw:null;
 const tone=score===null?'unknown':score>=.85?'high':score>=.6?'medium':'low';
 const label=tone==='unknown'?'Scan estimate unknown':`${tone[0].toUpperCase()}${tone.slice(1)} scan estimate`;
 const evidence=score===null
  ?'No usable model estimate is recorded.'
  :hasPreservedEstimate?'The preserved scan estimate is shown.':'The legacy scan estimate is shown.';
 return {tone,score,label,detail:`${confirmed?'Human-confirmed. ':''}${evidence} ${PIECE_CONFIDENCE_LEGEND}`,confirmed};
}
