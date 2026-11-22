import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const writer=readFileSync(new URL('../domains/finance/native-finance-writer.mjs',import.meta.url),'utf8');
const migration=readFileSync(
 new URL('../migrations/0037_finance_postfence_attestation_CANDIDATE_TEST_ONLY.sql',import.meta.url),'utf8');

test('B21 hosted Finance requires the separate signed post-fence receipt, not historical Google stage approval',()=>{
 assert.match(writer,/FROM mvp_finance_native\.post_fence_attestations/);
 assert.match(writer,/WHERE google_manifest_sha256=\$1 AND original_snapshot_id=\$2/);
 assert.match(writer,/AND crm_bridge_sha256=\$3/);
 assert.match(writer,/original_manifest_sha256!==openingManifestSha/);
 assert.match(writer,/legacy_link_policy!=='ARCHIVE_ONLY_NO_UUID_BRIDGE'/);
 assert.match(writer,/signed\.owner_identity_approved!==true/);
 assert.match(writer,/signed\.google_prod_version<93/);
 assert.match(writer,/signed\.source_record_count!==80/);
 assert.match(writer,/B17_POST_FENCE_SNAPSHOT_NOT_OWNER_ACCEPTED/);
 assert.doesNotMatch(writer,/FROM mvp_finance_stage\.freeze_manifests/);
 assert.match(writer,/FINANCE_NATIVE_POSTING_ENABLE!=='OWNER_APPROVED_CLEAN_TEST'/);
 assert.match(writer,/g\.phase!=='ACTIVE'/);
 assert.match(writer,/g\.financial_write_authority!=='POSTGRES'/);
});

test('B21 migration is additive, fail-closed and cannot silently sign an owner receipt',()=>{
 assert.match(migration,/CREATE TABLE IF NOT EXISTS mvp_finance_native\.post_fence_attestations/);
 assert.match(migration,/REFERENCES mvp_finance_stage\.freeze_manifests/);
 assert.match(migration,/CHECK \(owner_identity_approved = true\)/);
 assert.match(migration,/legacy_link_policy='ARCHIVE_ONLY_NO_UUID_BRIDGE'/);
 assert.match(migration,/B21_RECEIPT_IMMUTABLE/);
 assert.match(migration,/B21_FROZEN_SOURCE_OR_BRIDGE_SHA_MISMATCH/);
 assert.match(migration,/post_fence_archive_only_bridge_sha256/);
 assert.doesNotMatch(migration,/ALTER TABLE mvp_finance_stage\.freeze_manifests/);
 assert.doesNotMatch(migration,/UPDATE mvp_finance_stage\.freeze_manifests/);
 assert.doesNotMatch(migration,/UPDATE mvp_finance_native\.cutover_control/);
 assert.doesNotMatch(migration,/INSERT INTO mvp_finance_native\.post_fence_attestations/);
});
