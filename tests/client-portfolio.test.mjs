import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const backend=readFileSync(new URL('../client-portfolio.mjs',import.meta.url),'utf8');

test('Client hub shows canonical totals, not counts sliced from first 500 state rows',()=>{
 assert.match(app,/counts\?fmt\(counts\.objects\)/);
 assert.match(app,/counts\?fmt\(counts\.orders\)/);
 assert.match(app,/counts\?fmt\(counts\.activeOrders\)/);
 assert.match(app,/clientPortfolioSection\(x,'objects'\)/);
 assert.match(app,/clientPortfolioSection\(x,'orders'\)/);
 assert.match(app,/api\('\/api\/clients\/portfolio\?'\+/);
 assert.match(app,/data-client-portfolio-filter/);
 assert.match(app,/data-client-portfolio-more/);
 assert.match(app,/data-client-portfolio-open/);
 assert.match(app,/clientReturn=\{tab,clientId:clientDetailId\}/);
 assert.match(app,/catalog=\{entity:kind,q:id/);
});
test('Client portfolio enforces owner session and exact SQL relation without migration',()=>{
 const guard=server.indexOf("if(!sessionValid(req))throw new AppError(401");
 const route=server.indexOf("pathname==='/api/clients/portfolio'");
 assert.ok(guard>=0&&route>guard,'portfolio route must inherit owner auth');
 assert.match(backend,/WHERE client_id=\$1/);
 assert.match(backend,/JOIN public\.mvp_objects o ON o\.id=w\.object_id/);
 assert.match(backend,/o\.client_id=\$1/);
 assert.match(backend,/\(t\.created_at,t\.id\)</);
 assert.match(backend,/parts\[0\]!==id\|\|parts\[1\]!==kind/);
 assert.doesNotMatch(backend,/INSERT INTO|UPDATE public|DELETE FROM/i);
});
