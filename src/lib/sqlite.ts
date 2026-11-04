import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Store } from './api';
import { Mode, State } from './model';
import { changes, metadata, pack, unpack, RecordRow } from './records';
let database:DatabaseSync;
function db(){
 if(!database){
 mkdirSync(path.join(process.cwd(),'.data'),{recursive:true});database=new DatabaseSync(path.join(process.cwd(),'.data','burger-house.sqlite'));
 database.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS app_state (mode TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, token TEXT NOT NULL DEFAULT \'\'); CREATE TABLE IF NOT EXISTS app_records (mode TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(mode,kind,id)); CREATE TABLE IF NOT EXISTS clock_attempts (id TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL);');
 const cols=database.prepare('PRAGMA table_info(app_state)').all() as {name:string}[];
 if(!cols.some(c=>c.name==='token'))database.exec("ALTER TABLE app_state ADD COLUMN token TEXT NOT NULL DEFAULT ''");
 // Preserve data entered in the first local preview when upgrading to individual records.
 const rows=database.prepare('SELECT mode, data FROM app_state').all() as {mode:string;data:string}[];
 for(const row of rows){const s=JSON.parse(row.data);if(Array.isArray(s.entries)){database.exec('BEGIN IMMEDIATE');try{const insert=database.prepare('INSERT OR REPLACE INTO app_records(mode,kind,id,data) VALUES (?,?,?,?)');for(const r of pack(s))insert.run(row.mode,r.kind,r.id,r.data);database.prepare('UPDATE app_state SET data = ? WHERE mode = ?').run(metadata(s),row.mode);database.exec('COMMIT');}catch(e){database.exec('ROLLBACK');throw e;}}}
 }return database;
}
export const sqliteStore:Store={
 async failures(key){return db().prepare('SELECT count, until FROM clock_attempts WHERE id = ?').get(key) as {count:number;until:number}|null;},
 async fail(key){const now=Date.now();db().prepare('INSERT INTO clock_attempts (id,count,until) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count = CASE WHEN until > ? THEN count+1 ELSE 1 END, until = CASE WHEN until > ? THEN until ELSE excluded.until END').run(key,now+900000,now,now);},
 async resetFailures(key){db().prepare('DELETE FROM clock_attempts WHERE id = ?').run(key);},
 async revision(mode){const r=db().prepare('SELECT revision FROM app_state WHERE mode = ?').get(mode) as {revision:number}|undefined;return r?.revision??null;},
 async read(mode:Mode){const r=db().prepare('SELECT data, revision FROM app_state WHERE mode = ?').get(mode) as {data:string;revision:number}|undefined;if(!r)return null;const rows=db().prepare('SELECT kind,id,data FROM app_records WHERE mode = ? ORDER BY rowid').all(mode) as RecordRow[];return {state:unpack(r.data,rows),revision:r.revision};},
 async insert(mode:Mode,state:State){const d=db();d.exec('BEGIN IMMEDIATE');try{const result=d.prepare('INSERT OR IGNORE INTO app_state(mode,revision,data,token) VALUES (?,0,?,?)').run(mode,metadata(state),crypto.randomUUID());if(Number(result.changes)){const insert=d.prepare('INSERT INTO app_records(mode,kind,id,data) VALUES (?,?,?,?)');for(const r of pack(state))insert.run(mode,r.kind,r.id,r.data);}d.exec('COMMIT');}catch(e){d.exec('ROLLBACK');throw e;}},
 async update(mode:Mode,revision:number,state:State){const previous=await sqliteStore.read(mode);if(!previous||previous.revision!==revision)return false;const diff=changes(previous.state,state);const d=db();d.exec('BEGIN IMMEDIATE');try{const result=d.prepare('UPDATE app_state SET data = ?, revision = revision + 1, token = ? WHERE mode = ? AND revision = ?').run(metadata(state),crypto.randomUUID(),mode,revision);if(!Number(result.changes)){d.exec('ROLLBACK');return false;}const upsert=d.prepare('INSERT INTO app_records(mode,kind,id,data) VALUES (?,?,?,?) ON CONFLICT(mode,kind,id) DO UPDATE SET data = excluded.data');const remove=d.prepare('DELETE FROM app_records WHERE mode = ? AND kind = ? AND id = ?');for(const r of diff.put)upsert.run(mode,r.kind,r.id,r.data);for(const r of diff.remove)remove.run(mode,r.kind,r.id);d.exec('COMMIT');return true;}catch(e){d.exec('ROLLBACK');throw e;}}
};
