import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaHarness,png,jpeg,pngChunk,token } from './helpers/web-media.mjs';
import { validateRaster } from '../lib/web/media-raster.mjs';
import { createMedia,mediaUploadInput } from '../lib/web/media.mjs';
import { encryptMedia,decryptMedia } from '../lib/web/media-object.mjs';
import { createMediaStore } from '../lib/web/media-store.mjs';
import { webConfig } from '../lib/web/config.mjs';
const bad=code=>error=>error.code===code;
const upload=async(h,input=undefined)=>h.media.upload(h.access,token,h.project,'acme-search','desktop-after',input??await h.input());

test('PNG/JPEG structure and dimensions verified; executables, malformed, trailing and pixel/byte bombs refused',()=>{
 assert.deepEqual(validateRaster(png()),{mime:'image/png',width:2,height:2});assert.deepEqual(validateRaster(jpeg()),{mime:'image/jpeg',width:1,height:1});
 for(const bytes of [Buffer.from('<svg onload="evil()"/>'),Buffer.from('<html>Acme</html>'),Buffer.concat([png(),Buffer.from('script')]),png().subarray(0,-2),Buffer.from([255,216,255,217]),Buffer.concat([jpeg(),Buffer.from('script')])])assert.throws(()=>validateRaster(bytes));
 const corrupt=png();corrupt[corrupt.length-1]^=1;assert.throws(()=>validateRaster(corrupt),bad('invalid_raster'));
 const header=Buffer.alloc(13);header.writeUInt32BE(8193);header.writeUInt32BE(1,4);header[8]=8;header[9]=2;assert.throws(()=>validateRaster(Buffer.concat([png().subarray(0,8),pngChunk('IHDR',header)])),bad('image_dimensions_exceeded'));header.writeUInt32BE(4000);header.writeUInt32BE(4000,4);assert.throws(()=>validateRaster(Buffer.concat([png().subarray(0,8),pngChunk('IHDR',header)])),bad('image_dimensions_exceeded'));assert.throws(()=>validateRaster(Buffer.alloc(2097153)),bad('image_bytes_exceeded'));
});
test('media encryption binds instance/project/artifact and detects changed ciphertext',()=>{
 const key=Buffer.alloc(32,7),bytes=png(),cipher=encryptMedia(bytes,key,'acme:project:artifact');assert.deepEqual(decryptMedia(cipher,key,'acme:project:artifact'),bytes);assert.throws(()=>decryptMedia(cipher,key,'acme:other:artifact'),bad('media_tampered'));cipher[cipher.length-1]^=1;assert.throws(()=>decryptMedia(cipher,key,'acme:project:artifact'),bad('media_tampered'));
});
test('configured private upload reserves then sends ciphertext once, verifies bytes and attaches with truthful provenance',async()=>{
 const h=mediaHarness(),r=await upload(h);assert.equal(r.state,'verified');assert.equal(r.attached,true);assert.equal(r.attachmentRevision,1);assert.equal(r.provenance.environment,'Acme private preview');assert.equal(h.mediaState.posts,1);assert.equal(h.receipts.size,1);assert.equal(h.source.writes.length,0);
 const object=[...h.objects.values()][0];assert.notDeepEqual(object,png());assert.equal(object.subarray(0,6).toString(),'KEELM1');assert.doesNotMatch(JSON.stringify(r),/nonce|cipher|storageKey|private-key|acme-private-captures/);
 const bytes=await h.media.deliver(h.access,h.project,r.id);assert.deepEqual(bytes.bytes,png());assert.equal(bytes.mime,'image/png');const detail=await h.media.detail(h.access,h.project,r.id);assert.equal(detail.objectCheck,'verified');assert.ok(detail.checkedAt);
});
test('unconfigured/public bucket rejects upload and delivery; bucket config strict and no resource provision',async()=>{
 const h=mediaHarness(),none=createMedia({...h.config,media:undefined},{fetcher:h.fetcher});assert.equal((await none.list(h.access,h.project)).availability,'not-configured');await assert.rejects(none.upload(h.access,token,h.project,'acme-search','desktop-after',await h.input()),bad('media_not_configured'));
 h.mediaState.public=true;await assert.rejects(upload(h),bad('media_bucket_not_private'));assert.equal(h.mediaState.posts,0);h.mediaState.public=false;const r=await upload(h);h.mediaState.public=true;await assert.rejects(h.media.deliver(h.access,h.project,r.id),bad('media_bucket_not_private'));
 const {clientSecret,storageUrl,storageKey,encryptionKey,...base}=h.config,secrets={clientSecret,storageUrl,storageKey,encryptionKey:encryptionKey.toString('base64')};for(const media of [{...base.media,retentionDays:0},{...base.media,retentionDays:366},{...base.media,capacityBytes:268435457},{...base.media,bucket:'../public'},{...base.media,extra:true}])assert.throws(()=>webConfig({...base,media},secrets),bad('invalid_service_configuration'));
});
test('owner confirmations and exact source provenance are required, unknown fields and remote imports rejected',async()=>{
 const h=mediaHarness(),i=await h.input();for(const mutate of [i=>i.url='https://evil.test/image.png',i=>i.confirmed=false,i=>i.bytes='https://evil.test/image.png',i=>i.provenance.extra='x',i=>i.provenance.viewportWidth=0,i=>i.provenance.capturedAt='2099-01-01T00:00:00.000Z']){const v=structuredClone(i);mutate(v);await assert.rejects(upload(h,v));}
 for(const mutate of [i=>i.provenance.revision='c'.repeat(40),i=>i.provenance.viewport='mobile',i=>i.provenance.scenario='Other Acme view']){const v=structuredClone(i);mutate(v);await assert.rejects(upload(h,v),bad('media_provenance_mismatch'));}
 await assert.rejects(upload(h,{...i,sourceDigest:'0'.repeat(64)}),bad('media_source_changed'));assert.equal(h.mediaState.posts,0);
});
test('shared project owners can inspect captures; actor-specific request identity and other-project denial remain enforced',async()=>{
 const h=mediaHarness(),r=await upload(h),other={...h.access,userId:2};assert.equal((await h.media.detail(other,h.project,r.id)).uploaderId,1);await assert.rejects(h.media.byRequest(other,h.project,'a'.repeat(64)),bad('media_not_found'));
 for(const fn of [()=>h.media.detail({...h.access,projects:[]},h.project,r.id),()=>h.media.deliver({...h.access,projects:[]},h.project,r.id),()=>h.media.list({...h.access,userId:999},h.project),()=>h.media.enrich({...h.access,projects:[]},h.project,[]),()=>h.media.detail(h.access,{...h.project,repoId:999},r.id)])await assert.rejects(fn,bad('access_denied'));
 await assert.rejects(h.media.detail(h.access,h.project,'../private'),bad('media_not_found'));const store=createMediaStore({...h.config,media:{...h.config.media,bucket:'other-private'}},h.fetcher);assert.equal(await store.read(h.access,h.project,r.id),null);
});
test('lost upload response recovers original receipt and never repeats object POST',async()=>{
 for(const mode of ['lost','never']){const h=mediaHarness();h.mediaState.mode=mode;const input=await h.input(),r=await upload(h,input);assert.equal(r.state,mode==='lost'?'verified':'uncertain');assert.equal(h.mediaState.posts,1);assert.equal((await h.media.byRequest(h.access,h.project,input.requestId)).id,r.id);await h.media.recover(h.access,token,h.project,r.id);await upload(h,input);assert.equal(h.mediaState.posts,1);assert.equal(h.receipts.size,1);}
});
test('concurrent duplicate requests dispatch one Storage POST and changed request payload refuses',async()=>{
 const h=mediaHarness(),input=await h.input(),results=await Promise.all([upload(h,input),upload(h,input)]);assert.equal(h.mediaState.posts,1);assert.equal(results[0].id,results[1].id);await assert.rejects(upload(h,{...input,provenance:{...input.provenance,caption:'Changed Acme caption'}}),bad('media_conflict'));
});
test('slot CAS protects newer owner choice; changed source preserves verified unattached artifact',async()=>{
 const h=mediaHarness(),r=await upload(h),second=await upload(h,await h.input('b'.repeat(64)));assert.equal(second.state,'verified');assert.equal(second.attached,false);assert.equal(second.attachmentError,'media_conflict');assert.equal(second.attachmentRevision,1);
 const attached=await h.media.attach(h.access,token,h.project,second.id,{slotDigest:second.slotDigest,expectedRevision:1});assert.equal(attached.attached,true);assert.equal(attached.attachmentRevision,2);await assert.rejects(h.media.attach(h.access,token,h.project,r.id,{slotDigest:r.slotDigest,expectedRevision:1}),bad('media_conflict'));
 const h2=mediaHarness();h2.mediaState.onPost=()=>{const d=JSON.parse(h2.source.files['docs/changes/acme-search.json']);d.captures[0].scenario='Changed Acme scenario';h2.source.files['docs/changes/acme-search.json']=JSON.stringify(d);};const changed=await upload(h2);assert.equal(changed.state,'verified');assert.equal(changed.attached,false);assert.equal(changed.attachmentError,'media_source_changed');assert.equal((await h2.media.deliver(h2.access,h2.project,changed.id)).mime,'image/png');
});
test('display-only source changes preserve attachment while changed slot requirements show historical stale capture',async()=>{
 const h=mediaHarness(),r=await upload(h),path='docs/changes/acme-search.json';let d=JSON.parse(h.source.files[path]);d.title='A new Acme title';d.captures.reverse();h.source.files[path]=JSON.stringify(d);
 let enriched=await h.media.enrich(h.access,h.project,await h.changes.detail(h.access,token,h.project,'acme-search')),slot=enriched.change.captures.find(s=>s.id==='desktop-after');assert.equal(slot.attachmentState,'current');assert.equal(slot.capture.id,r.id);assert.equal(slot.capture.objectCheck,'not-checked');
 d.captures.find(s=>s.id==='desktop-after').scenario='Other Acme scenario';h.source.files[path]=JSON.stringify(d);enriched=await h.media.enrich(h.access,h.project,await h.changes.detail(h.access,token,h.project,'acme-search'));slot=enriched.change.captures.find(s=>s.id==='desktop-after');assert.equal(slot.attachmentState,'stale');assert.equal(slot.capture.provenance.scenario,'Acme search results');
});
test('missing, expired, tampered and unavailable bytes remain distinct; metadata is not a fresh object proof',async()=>{
 const h=mediaHarness(),r=await upload(h),key=[...h.objects.keys()][0],bytes=h.objects.get(key);h.objects.delete(key);assert.equal((await h.media.detail(h.access,h.project,r.id)).availability,'missing');await assert.rejects(h.media.deliver(h.access,h.project,r.id),bad('media_missing'));h.objects.set(key,Buffer.from(bytes));h.objects.get(key)[40]^=1;assert.equal((await h.media.detail(h.access,h.project,r.id)).availability,'tampered');h.objects.set(key,bytes);h.mediaState.failRead=true;assert.equal((await h.media.detail(h.access,h.project,r.id)).availability,'unavailable');h.mediaState.failRead=false;
 assert.equal((await h.media.list(h.access,h.project)).items[0].objectCheck,'not-checked');h.state.now+=31*86400000;assert.equal((await h.media.detail(h.access,h.project,r.id)).availability,'expired');await assert.rejects(h.media.deliver(h.access,h.project,r.id),bad('media_expired'));
});
test('expired artifact can be explicitly deleted; exact receipt required and only absence releases capacity',async()=>{
 const h=mediaHarness(),r=await upload(h);await assert.rejects(h.media.remove(h.access,h.project,r.id,{expectedRevision:r.revision,confirmDigest:'f'.repeat(64)}),bad('media_conflict'));h.state.now+=31*86400000;const d=await h.media.detail(h.access,h.project,r.id),removed=await h.media.remove(h.access,h.project,r.id,{expectedRevision:d.revision,confirmDigest:d.deleteDigest});assert.equal(removed.state,'deleted');assert.equal(h.objects.size,0);assert.equal(h.receipts.size,1);assert.equal(h.mediaState.deletes,1);
});
test('uncertain deletion denies delivery and recovery only checks original absence, without another DELETE',async()=>{
 const h=mediaHarness(),r=await upload(h);h.mediaState.removeMode='never';let d=await h.media.remove(h.access,h.project,r.id,{expectedRevision:r.revision,confirmDigest:r.deleteDigest});assert.equal(d.state,'delete-uncertain');await assert.rejects(h.media.deliver(h.access,h.project,r.id),bad('media_not_available'));d=await h.media.recover(h.access,token,h.project,r.id);assert.equal(d.state,'delete-uncertain');assert.equal(h.mediaState.deletes,1);h.objects.clear();d=await h.media.recover(h.access,token,h.project,r.id);assert.equal(d.state,'deleted');assert.equal(h.mediaState.deletes,1);
});
test('an in-flight upload cannot race deletion, and deletion reservation prevents bytes delivery',{timeout:3000},async()=>{
 const h=mediaHarness();let release;h.mediaState.holdUpload=new Promise(r=>release=r);const job=upload(h);while(h.mediaState.posts===0)await new Promise(r=>setImmediate(r));const row=await h.media.byRequest(h.access,h.project,'a'.repeat(64));assert.equal(row.state,'uploading');await assert.rejects(h.media.remove(h.access,h.project,row.id,{expectedRevision:row.revision,confirmDigest:row.deleteDigest}),bad('media_busy'));release();const r=await job;let releaseDelete;h.mediaState.holdDelete=new Promise(r=>releaseDelete=r);const deletion=h.media.remove(h.access,h.project,r.id,{expectedRevision:r.revision,confirmDigest:r.deleteDigest});while(h.mediaState.deletes===0)await new Promise(r=>setImmediate(r));await assert.rejects(h.media.deliver(h.access,h.project,r.id),bad('media_not_available'));releaseDelete();assert.equal((await deletion).state,'deleted');
});
test('capacity charges uncertain objects, preserves receipts, and list pagination is bounded',async()=>{
 const h=mediaHarness();h.config.media.capacityBytes=png().length+34;h.mediaState.mode='never';await upload(h);await assert.rejects(upload(h,await h.input('b'.repeat(64))),bad('media_capacity'));assert.equal(h.mediaState.posts,1);assert.equal(h.receipts.size,1);
 const h2=mediaHarness();await upload(h2);await upload(h2,await h2.input('b'.repeat(64)));const first=await h2.media.list(h2.access,h2.project,{limit:1});assert.equal(first.items.length,1);assert.ok(first.nextCursor);const second=await h2.media.list(h2.access,h2.project,{limit:1,after:first.nextCursor});assert.equal(second.items.length,1);assert.notEqual(second.items[0].id,first.items[0].id);assert.equal(second.nextCursor,null);await assert.rejects(h2.media.list(h2.access,h2.project,{limit:31}),bad('invalid_media_page'));
});

test('malformed PNG metadata, oversized inflater output and invalid JPEG table structure are refused',()=>{
 const valid=png(),head=valid.subarray(0,33),tail=valid.subarray(33);
 for(const chunk of [pngChunk('gAMA',Buffer.from([1])),pngChunk('tEXt',Buffer.from('bad\0text\0extra')),pngChunk('iCCP',Buffer.from('Acme\0\0not compressed'))])assert.throws(()=>validateRaster(Buffer.concat([head,chunk,tail])),bad('invalid_raster'));
 const malformed=jpeg();malformed[malformed.indexOf(Buffer.from([255,196]))+5]=255;assert.throws(()=>validateRaster(malformed),bad('invalid_raster'));
});
test('maximum-size base64 is handled under the byte bound without regexp stack exhaustion',async()=>{
 const h=mediaHarness(),input=await h.input();input.bytes=Buffer.alloc(2097152).toString('base64');assert.throws(()=>mediaUploadInput(input,()=>h.state.now),bad('invalid_raster'));input.bytes=Buffer.alloc(2097153).toString('base64');assert.throws(()=>mediaUploadInput(input,()=>h.state.now),e=>['invalid_media_upload','image_bytes_exceeded'].includes(e.code));
});
test('generic provider 404 is unavailable, never a deletion absence proof',async()=>{
 const h=mediaHarness(),r=await upload(h),fetcher=(url,options)=>new URL(url).pathname.includes('/storage/v1/object/')&&options.method==='GET'?Promise.resolve(Response.json({error:'gateway_unavailable'},{status:404})):h.fetcher(url,options),media=createMedia(h.config,{fetcher,now:()=>h.state.now,inspectTarget:h.changes.captureTarget});
 assert.equal((await media.detail(h.access,h.project,r.id)).availability,'unavailable');const removed=await media.remove(h.access,h.project,r.id,{expectedRevision:r.revision,confirmDigest:r.deleteDigest});assert.equal(removed.state,'delete-uncertain');assert.equal([...h.receipts.values()][0].state,'delete-uncertain');
});
test('enrichment is two bounded metadata reads, exposes expiry and never mixes another project item',async()=>{
 const h=mediaHarness(),r=await upload(h),source=await h.changes.detail(h.access,token,h.project,'acme-search');h.mediaState.requests.length=0;h.state.now+=31*86400000;const enriched=await h.media.enrich(h.access,h.project,source);assert.equal(enriched.change.captures[0].capture.availability,'expired');assert.equal(enriched.change.captures[0].capture.objectCheck,'not-checked');assert.deepEqual(h.mediaState.requests.map(r=>r.p_operation),['slots','batch']);assert.equal(enriched.change.captures[0].capture.id,r.id);
 source.change.projectId='other-project';await assert.rejects(h.media.enrich(h.access,h.project,source),bad('access_denied'));await assert.rejects(h.media.list({...h.access,workspace:{id:'other'}},h.project),bad('access_denied'));
});
test('receipt persistence failure before dispatch sends no object bytes',async()=>{
 const h=mediaHarness();h.mediaState.failDB=true;await assert.rejects(upload(h));assert.equal(h.mediaState.posts,0);assert.equal(h.objects.size,0);
});

test('missing dispatch CAS receipt cannot send an unreserved object',async()=>{
 const h=mediaHarness(),fetcher=(url,options)=>new URL(url).pathname.endsWith('/rpc/keel_media_rpc')&&JSON.parse(options.body).p_operation==='uploading'?Promise.resolve(Response.json(null)):h.fetcher(url,options),media=createMedia(h.config,{fetcher,now:()=>h.state.now,inspectTarget:h.changes.captureTarget});await assert.rejects(media.upload(h.access,token,h.project,'acme-search','desktop-after',await h.input()),bad('invalid_media_storage'));assert.equal(h.mediaState.posts,0);assert.equal(h.objects.size,0);
});
