import {COLORS,type PartKind} from './bricks';
import {nativeKindForCatalog,partInfo,shapeName} from './catalog';
import {isViablePiece} from './piece-gallery';
import type {CatalogMatch,Resolution} from './inventory';
import type {PartTags} from './part-tags';
import rebrickable from '../data/rebrickable.json';

export type PiecePickerChoice={kind:PartKind}|{catalog:CatalogMatch};
const exactColor=(color:string)=>Object.hasOwn(COLORS,color);

export function pieceChoiceCatalog(choice:PiecePickerChoice):CatalogMatch|null {
 if('catalog'in choice)return choice.catalog;
 const k=choice.kind,shape=`${k.type}-${k.w}x${k.d}`;
 const num=(rebrickable.shapes as Record<string,{rebrickable:string}>)[shape]?.rebrickable;
 return num?{num,name:partInfo(k.partId)?.name??shapeName(k),color:k.color}:null;
}

/** Keep the observed color, but never infer physical feature filters. */
export function initialPieceFilters(color:string):PartTags {
 return exactColor(color)?{color:[color]}:{};
}

/** An explicit color edit preserves the mold. Unqualified combinations remain
 * catalog observations; no substitute mold or nearest manufactured color. */
export function recolorPieceChoice(choice:PiecePickerChoice|null,color:string):PiecePickerChoice|null {
 if(!choice||!exactColor(color))return choice;
 if('catalog'in choice)return {catalog:{...choice.catalog,color}};
 const k=choice.kind,identity=pieceChoiceCatalog(choice);
 if(!identity)return null;
 const next=nativeKindForCatalog(identity.num,color);
 if(next&&next.type===k.type&&next.w===k.w&&next.d===k.d&&isViablePiece(next))return {kind:next};
 return {catalog:{...identity,color}};
}

/** Restored color conflicts fail closed until an explicit edit or selection. */
export function pieceChoiceResolution(choice:PiecePickerChoice|null,color:string):Resolution|null {
 if(!choice||!exactColor(color))return null;
 if('kind'in choice)return choice.kind.color===color&&isViablePiece(choice.kind)?{kind:choice.kind}:null;
 if(choice.catalog.color!==color)return null;
 const k=nativeKindForCatalog(choice.catalog.num,color);
 return k&&isViablePiece(k)?{kind:k}:{name:`${choice.catalog.name} · ${choice.catalog.num}`,catalog:choice.catalog};
}
