import { solveObjectTarget, type ObjectTarget } from './object-layout';
export interface ObjectLayoutRequest {stock:Record<string,number>;target:ObjectTarget}
self.onmessage=({data}:{data:ObjectLayoutRequest})=>{
 try{const diagnostics:string[]=[];const candidates=solveObjectTarget(data.stock,data.target,diagnostics,1);self.postMessage({candidates,diagnostics});}
 catch(e){self.postMessage({error:(e as Error).message});}
};
