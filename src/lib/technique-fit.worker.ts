import { fitConnectionProgram } from './connection-fit';
import type { ConnectionProgram } from './connections';
export interface TechniqueFitRequest {program:ConnectionProgram;stock:Record<string,number>;locked:number[]}
self.onmessage=({data}:{data:TechniqueFitRequest})=>{
  try{self.postMessage({result:fitConnectionProgram(data.program,data.stock,{lockedOperations:new Set(data.locked),maxChecks:2500,maxMillis:25000})});}
  catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
