import { Action, Mode, Snapshot, State } from './model';
import { applyAction, initialState, publicState, ValidationError } from './engine';
export interface Store { revision?(mode:Mode):Promise<number|null>; read(mode: Mode): Promise<Snapshot | null>; insert(mode: Mode, state: State): Promise<void>; update(mode: Mode, revision: number, state: State): Promise<boolean>; failures?(key:string):Promise<{count:number;until:number}|null>; fail?(key:string):Promise<void>; resetFailures?(key:string):Promise<void> }
const attempts = new Map<string,{count:number;until:number}>();
const reply = (data: unknown, status = 200) => Response.json(data, {status, headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function handleState(request: Request, store: Store) {
 try {
 const url=new URL(request.url);const mode=url.searchParams.get('mode');if(mode!=='demo'&&mode!=='live')return reply({error:'Espace inconnu.'},400);
 if(request.method==='GET'&&store.revision){const revision=await store.revision(mode);if(revision!==null&&request.headers.get('if-none-match')===`"${mode}-${revision}"`)return new Response(null,{status:304,headers:{'ETag':`"${mode}-${revision}"`,'Cache-Control':'no-store'}});}
 let current=await store.read(mode);if(!current){await store.insert(mode,await initialState(mode==='demo'));current=await store.read(mode);}if(!current)throw new Error('Initialisation impossible');
 if(request.method==='GET')return Response.json({state:publicState(current.state),revision:current.revision},{headers:{'Cache-Control':'no-store','ETag':`"${mode}-${current.revision}"`,'X-Content-Type-Options':'nosniff'}});
 if(request.method!=='POST')return reply({error:'Méthode interdite'},405);
 const origin=request.headers.get('origin');if(origin&&origin!==url.origin)return reply({error:'Origine refusée.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'Format JSON requis.'},415);
 const raw=await request.text();if(raw.length>40000)return reply({error:'Envoi trop volumineux.'},413);
 const body=JSON.parse(raw) as {action:Action;requestId:string;revision:number};
 if(!body.action||typeof body.requestId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId)||!Number.isSafeInteger(body.revision))return reply({error:'Requête invalide.'},400);
 if(current.state.requestIds.includes(body.requestId))return reply({state:publicState(current.state),revision:current.revision});
 if(body.revision!==current.revision)return reply({error:'Les données ont changé sur un autre appareil. Elles ont été actualisées ; vous pouvez réessayer.'},409);
 let key='';if(body.action.type==='clock'){key=mode+':'+body.action.employeeId;const limit=store.failures?await store.failures(key):attempts.get(key);if(limit&&limit.until>Date.now()&&limit.count>=5)return reply({error:'Trop de codes incorrects. Réessayez dans 15 minutes.'},429);}
 let next:State;try{next=await applyAction(current.state,body.action);}catch(e){if(key&&e instanceof Error&&e.message==='Code de pointage incorrect.'){if(store.fail)await store.fail(key);else{const a=attempts.get(key);attempts.set(key,{count:a&&a.until>Date.now()?a.count+1:1,until:a&&a.until>Date.now()?a.until:Date.now()+900000});}}throw e;}
 if(key){if(store.resetFailures)await store.resetFailures(key);else attempts.delete(key);}next.requestIds=[...current.state.requestIds.slice(-199),body.requestId];
 if(!await store.update(mode,current.revision,next))return reply({error:'Une modification simultanée a été détectée. Actualisez puis réessayez.'},409);
 return reply({state:publicState(next),revision:current.revision+1});
 }catch(e){if(e instanceof ValidationError)return reply({error:e.message},400);if(e instanceof SyntaxError)return reply({error:'Requête JSON invalide.'},400);console.error('State API:',e instanceof Error?e.message:'unknown');return reply({error:'Enregistrement indisponible. Réessayez dans un instant.'},500);}
}
