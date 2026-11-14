import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('B20 existing owner session and strict same-origin guard protect native money route',()=>{
 assert.match(server,/if\(!sessionValid\(req\)\)throw new AppError\(401/);
 assert.match(server,/\['\/api\/finance\/native-action-preview','\/api\/finance\/draft-validate','\/api\/finance\/post'\]\.includes\(pathname\)/);
 assert.match(server,/verifyFinanceCsrfForValidatedSession\([\s\S]*?FINANCE_B17_CSRF_REJECTED/);
 assert.match(server,/FINANCE_NATIVE_POSTING_ENABLE!=='OWNER_APPROVED_CLEAN_TEST'/);
 assert.match(server,/postHostedFinanceCapital\(pool/);
 assert.match(server,/readNativeFinanceWorkspace\(pool/);
});
test('B20 mobile adapter remains native-only and archive is not editable',()=>{
 assert.match(server,/\/finance-native-workspace-view\.mjs/);
 assert.match(ui,/id="financeNativeMount"/);
 assert.match(ui,/mountFinanceNativeWorkspace\(root/);
 assert.match(ui,/financeNativePostAction\(payload\)/);
 assert.match(ui,/financeNativePanel\.unmount\(\)/);
 assert.doesNotMatch(ui,/financeNativePostAction\(.*financeHistory/);
});
