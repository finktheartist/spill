import { solveAnimalTarget, type AnimalTarget } from './animal-anatomy';
self.onmessage=({data}:{data:{stock:Record<string,number>;target:AnimalTarget}})=>{
 try{const diagnostics:string[]=[];const candidates=solveAnimalTarget(data.stock,data.target,diagnostics);self.postMessage({candidates,diagnostics});}
 catch(e){self.postMessage({error:(e as Error).message});}
};
