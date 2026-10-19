import {counts,type Inventory} from '../inventory';
import {inventoryKey} from './discovery';

/** Scanner scores are retained as evidence, never interpreted as calibrated
 * probabilities or as proof that a user confirmed a particular piece. */
export interface StockEvidence {
 source:'photo'|'sample'|'unknown';
 confidenceById:Record<string,number>;
}

/** Copy only count-associated confidence. Photos, boxes and private URLs are
 * unnecessary for subject matching and never enter recommendation prompts. */
export function stockEvidence(inv:Inventory):StockEvidence {
 const stock=counts(inv),confidenceById:Record<string,number>={};
 for(const id of Object.keys(stock).sort()){
  const confidence=inv.parts[id]?.confidence;
  if(Number.isFinite(confidence)&&confidence>=0&&confidence<=1)confidenceById[id]=confidence;
 }
 return {source:inv.source==='photo'||inv.source==='sample'?inv.source:'unknown',confidenceById};
}

/** Recommendation freshness includes identification evidence, even when an
 * inventory correction leaves every count unchanged. Construction/history keys
 * retain their existing count-only meaning. */
export function recommendationStockKey(stock:Record<string,number>,evidence?:StockEvidence):string {
 const ids=new Set(Object.keys(stock).filter(id=>Number.isSafeInteger(stock[id])&&stock[id]>0));
 return inventoryKey('recommendation',stock)+':'+JSON.stringify({source:evidence?.source??'unknown',
  confidence:Object.entries(evidence?.confidenceById??{}).filter(([id,n])=>ids.has(id)&&Number.isFinite(n)&&n>=0&&n<=1).sort(([a],[b])=>a.localeCompare(b))});
}
