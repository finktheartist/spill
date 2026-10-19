import type { Build } from '../bricks';
import type { ConnectionProgram } from '../connections';

/** An independently compiled, immutable subassembly. All parts count against one shared stock. */
export interface AssemblyOption { id:string; role:string; program:ConnectionProgram }
export interface AssemblyAttachment { parent:string; parentPart:number; parentPort:string; childPort:string; twist:number }
export interface AssemblyNode { id:string; option:AssemblyOption; attachment?:AssemblyAttachment }
export interface AssemblyPlan { id:string; name:string; description:string; nodes:AssemblyNode[] }
export interface AssemblyReceipt { id:string; role:string; optionId:string; cost:Record<string,number>; indices:number[] }
/** size is the complete world x/y/z extent in STUDS, including height. Placed.z remains in plates. */
export interface AssemblyComposition { plan:AssemblyPlan; build:Build; receipts:AssemblyReceipt[]; remaining:Record<string,number>; size:number[] }
export interface AssemblySearchOptions {
  minParts?:number; maxParts?:number; limit?:number; maxAttempts?:number; maxMillis?:number;
  validate?:(candidate:AssemblyComposition)=>string[];
}
export interface AssemblySearchResult { candidates:AssemblyComposition[]; attempts:number; rejected:number; exhausted:boolean }
