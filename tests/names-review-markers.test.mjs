import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markerMutant } from './helpers/names.mjs';
import { reviewRounds, recordOf, recordText } from '../practices/night/files/scripts/plates/lib.mjs';
import { crossReviewTally, CROSS_REVIEWER } from '../practices/night/files/scripts/plates/improve.mjs';
import { pushHistory } from '../scripts/plates/cross-review.mjs';
const lib = new URL('../practices/night/files/scripts/plates/lib.mjs', import.meta.url);
const review = body => ({author:{login:'acme-owner'},reviewThreads:{nodes:[]},comments:{nodes:[]},reviews:{nodes:[{id:'PRR_1',author:{login:'acme-reviewer'},body,state:'COMMENTED',commit:{oid:'a'.repeat(40)}}]}});

test('summary header and findings count each require both aliases independently', async () => {
  for (const role of ['header','count']) for (const namespace of ['plates','keel']) {
    const other = namespace === 'plates' ? 'keel' : 'plates';
    const header = role === 'header' ? namespace : other, count = role === 'count' ? namespace : other;
    const body = `<!-- ${header}:cross-review -->\nAcme review.\n<!-- ${count}:cross-review findings 1 -->\nAcme finding.\n`;
    assert.equal(reviewRounds(review(body)).count,1);
    const mutant = await markerMutant(lib,'marker:keel:cross-review',`${namespace}:cross-review`);
    assert.equal(mutant.reviewRounds(review(body)).count,0,`${role} ${namespace}`);
  }
});

test('push-review pending marker requires both aliases and counts a dual header once', async () => {
  const make = body => [{number:1,author:{login:'github-actions[bot]'},createdAt:'2026-10-09T16:00:00Z',body}];
  const options = {now:Date.parse('2026-10-09T18:00:00Z')};
  for (const namespace of ['plates','keel']) {
    const input = make(`<!-- ${namespace}:review-after-pending -->`);
    assert.equal(pushHistory(input,options).today,1);
    const mutant = await markerMutant(new URL('../scripts/plates/cross-review.mjs',import.meta.url),'marker:keel:review-after-pending',`${namespace}:review-after-pending`);
    assert.equal(mutant.pushHistory(input,options).today,0);
  }
  assert.equal(pushHistory(make('<!-- keel:review-after-pending -->\n<!-- plates:review-after-pending -->'),options).today,1);
});

test('inline finding reader requires both aliases and rejects quoted markers', async () => {
  const input = body => ({open:{nodes:[{number:1,headRefName:'codex/acme',reviewThreads:{nodes:[{comments:{nodes:[{author:{login:'github-actions[bot]'},body}]}}]}}]},merged:{nodes:[]}});
  const options = {prefixes:['codex/'],date:'2026-10-09',reviewer:CROSS_REVIEWER};
  for (const namespace of ['plates','keel']) {
    const body = `<!-- ${namespace}:cross-review finding -->\nAcme finding.`;
    assert.equal(crossReviewTally(input(body),options).comments,1);
    assert.equal(crossReviewTally(input('> '+body),options).comments,0);
    const mutant = await markerMutant(new URL('../practices/night/files/scripts/plates/improve.mjs',import.meta.url),'marker:keel:cross-review',`${namespace}:cross-review`);
    assert.equal(mutant.crossReviewTally(input(body),options).comments,0);
  }
});

test('review record aliases stay in the leading metadata region and both one-name mutations fail', async () => {
  const value = {from:null,to:'a'.repeat(40),findings:[]}, current = recordText(value);
  assert.ok(current.startsWith('<!-- plates:review-after '));
  const legacy = current.replace('plates:review-after','keel:review-after');
  for (const [namespace,body] of [['plates',current],['keel',legacy]]) {
    assert.deepEqual(recordOf(body),value);
    const mutant = await markerMutant(lib,'marker:keel:review-after',`${namespace}:review-after`);
    assert.equal(mutant.recordOf(body),null);
  }
  const changed = recordText({...value,to:'b'.repeat(40)});
  assert.equal(recordOf(legacy+'\n'+changed).to,'b'.repeat(40));
  assert.equal(recordOf(changed+'\n'+legacy).to,'b'.repeat(40));
  assert.equal(recordOf(legacy+'\nAcme agent prose.\n'+changed).to,value.to);
  assert.equal(recordOf('Acme prose.\n'+current),null);
  assert.equal(recordOf(current+'\n'+current),null);
});
