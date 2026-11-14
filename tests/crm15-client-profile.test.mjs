import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const r=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const sql=r('../migrations/0023_crm15a_client_profile_TEST_ONLY.sql'),app=r('../public/app.js'),api=r('../server.mjs'),clientActions=r('../crm-client-duplicates.mjs');
test('legacy client fields, enum policy and owner-only revisioned editing',()=>{
 for(const column of ['email','address','status','client_tier','referral_status','client_label_note'])assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS '+column+' '));
 for(const field of ['clientTier','referralStatus','clientLabelNote','email','address'])assert.ok(app.includes(field));
 assert.match(api,/guardedClientAction/);
 assert.match(clientActions,/client_tier=COALESCE\(\$9,client_tier\)/);
 assert.match(clientActions,/WHERE id=\$1 AND revision=\$2 RETURNING/);
 assert.match(r('../crm-lead-intake.mjs'),/selected\.status==='archived'/);
 assert.match(r('../crm-lead-conversion.mjs'),/selected\.status==='archived'/);
 assert.match(app,/Связанные обращения/);
 assert.doesNotMatch(sql,/\bUPDATE\s+public\./i);
});
