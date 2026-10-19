import type {PopularMold} from './popular-mold-types';
import {POPULAR_CONNECTOR_MOLDS} from './popular-connector-molds';
import {POPULAR_PROFILE_MOLDS} from './popular-profile-molds';
import {POPULAR_DETAIL_MOLDS} from './popular-detail-molds';
import {BULK_MOLDS} from './bulk-molds';
import {COMMON_MOLDS} from './common-molds';
import {correctMoldConnections} from './mold-connection-corrections';

/** Exact manufactured keys, never aliases or a nearest-shape fallback. */
export const POPULAR_MOLDS:readonly PopularMold[]=Object.freeze([...POPULAR_CONNECTOR_MOLDS,...POPULAR_PROFILE_MOLDS,...POPULAR_DETAIL_MOLDS]);
/** Keep the original studied batch stable; all consumers and exact lookups use
 * this combined registry, so later batches share the same physics/render path. */
export const ALL_MOLDS:readonly PopularMold[]=Object.freeze([...POPULAR_MOLDS,...BULK_MOLDS,...COMMON_MOLDS].map(correctMoldConnections));
const byType=new Map(ALL_MOLDS.map(m=>[m.type,m]));
if(byType.size!==ALL_MOLDS.length||new Set(ALL_MOLDS.map(m=>m.num)).size!==ALL_MOLDS.length)throw Error('Duplicate exact mold registry');
export function popularMold(k:{type:string;w:number;d:number}):PopularMold|undefined {
 const m=byType.get(k.type as `mold${number}`);
 return m&&k.w===m.w&&k.d===m.d?m:undefined;
}
export const popularType=(type:string)=>byType.has(type as `mold${number}`);
