import { renderUploadReview, renderMediaReceipt, renderDeleteReview } from './media-views.mjs';
import { esc } from './change-views.mjs';
import './change-client.mjs';
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
export async function mediaRequest(fetch, url, body) { const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 58000); try {
    const response = await fetch(url, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
}
catch {
    return { status: 503, data: { error: 'request_unavailable' }, uncertain: true };
}
finally {
    clearTimeout(timer);
} }
export function mediaMessage(code) { return ({ media_not_configured: 'Private media is not configured. Ask the owner to approve the private bucket and retention setting.', media_capacity: 'Private media capacity is full. Existing artifacts were preserved; review explicit deletions with the owner.', media_source_changed: 'Source requirements changed. Keep the original receipt and review the current slot.', media_slot_conflict: 'A newer attachment already occupies this slot. The verified upload remains in the library; it did not replace that choice.', request_unavailable: 'The outcome is uncertain. Keep this original request and check its receipt; do not upload again.', media_not_found: 'The original receipt is not visible yet. A request may still reserve it. Check the same request; do not upload again.' })[code] || 'The operation was refused or unavailable. Its original receipt and existing artifacts are preserved.'; }
export function validReceipt(value, project) { return value?.schema === 1 && hash(value.id) && value.projectId === project && typeof value.state === 'string'; }
export function comparableCaptureInputs(a, b) { return !!(a && b && a.environment === b.environment && a.scenario === b.scenario && a.viewport === b.viewport && Number.isSafeInteger(a.viewportWidth) && a.viewportWidth === b.viewportWidth && Number.isSafeInteger(a.viewportHeight) && a.viewportHeight === b.viewportHeight); }
export function startMediaClient({ document, window, fetch }) {
    const root = document.querySelector('[data-media-root]');
    if (!root)
        return null;
    let model;
    try {
        model = JSON.parse(root.querySelector('[data-media-model]').value);
    }
    catch {
        return null;
    }
    const project = root.dataset.project, csrf = root.querySelector('[data-media-csrf]')?.value;
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(project) || !csrf)
        return null;
    const base = `/api/projects/${project}/media`, form = root.querySelector('[data-media-form]'), status = root.querySelector('[data-media-status]'), receiptZone = root.querySelector('[data-media-receipt]'), reviewZone = root.querySelector('[data-upload-review]'), deleteZone = root.querySelector('[data-delete-review]');
    let review = null, receipt = model.receipt ?? null, requestId = model.requestId ?? null, busy = false, locked = !!requestId, deleteReady = false, objectUrl = null;
    const field = name => form?.querySelector(`[name="${name}"]`), say = text => { status.textContent = text; };
    function reject(result) { if ([401, 403, 404].includes(result.status) && ['access_denied', 'session_expired', 'unauthorized'].includes(result.data?.error) || result.status === 401) {
        root.innerHTML = '<h1>Please sign in again.</h1><p>The private media view has been cleared.</p>';
        locked = true;
        return true;
    } return false; }
    function controls() { for (const item of form?.querySelectorAll('input,textarea,select,button') ?? [])
        item.disabled = busy || locked; const upload = root.querySelector('[data-upload]'); if (upload)
        upload.disabled = busy || locked || !review || !root.querySelector('[data-upload-confirm]')?.checked; const del = root.querySelector('[data-delete]'); if (del)
        del.disabled = busy || !deleteReady || !root.querySelector('[data-delete-confirm]')?.checked; const recover = root.querySelector('[data-recover-media]'); if (recover)
        recover.disabled = busy; }
    function requirements() { const slot = model.change?.captures.find(s => s.id === field('slotId')?.value), zone = root.querySelector('[data-slot-requirements]'); if (zone)
        zone.innerHTML = slot ? `<p class="meta">Required ${esc(slot.viewport)} · ${esc(slot.scenario)}<br>Revision <code>${esc(slot.revision)}</code><br>Current attachment revision ${esc(slot.attachmentRevision)}</p>` : ''; }
    function invalidate() { if (locked || busy)
        return; review = null; deleteReady = false; if (reviewZone)
        reviewZone.innerHTML = ''; if (objectUrl) {
        window.URL.revokeObjectURL(objectUrl);
        objectUrl = null;
    } requirements(); controls(); }
    async function reviewUpload() {
        if (busy || locked || !form?.reportValidity())
            return;
        const file = field('file')?.files?.[0], slot = model.change?.captures.find(s => s.id === field('slotId')?.value);
        if (!file || !slot)
            return;
        if (file.size > 2 * 1024 * 1024 || !['image/png', 'image/jpeg'].includes(file.type)) {
            say('Choose a PNG or JPEG of at most 2 MiB. The server also verifies its structure and dimensions.');
            return;
        }
        busy = true;
        controls();
        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const digest = [...new Uint8Array(await window.crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
            let binary = '';
            for (const byte of bytes)
                binary += String.fromCharCode(byte);
            const provenance = { revision: slot.revision, environment: field('environment').value.trim(), viewport: slot.viewport, viewportWidth: Number(field('viewportWidth').value), viewportHeight: Number(field('viewportHeight').value), scenario: slot.scenario, capturedAt: field('capturedAt').value.trim(), caption: field('caption').value, alt: field('alt').value };
            if (!Number.isFinite(Date.parse(provenance.capturedAt)) || !provenance.capturedAt.endsWith('Z')) {
                say('Enter the actual capture time as a UTC timestamp ending in Z.');
                return;
            }
            provenance.capturedAt = new Date(provenance.capturedAt).toISOString();
            objectUrl = window.URL.createObjectURL(file);
            review = { name: file.name, size: file.size, hash: digest, objectUrl, changeId: model.change.changeId, slotId: slot.id, sourceDigest: slot.sourceDigest, slotDigest: slot.slotDigest, expectedRevision: slot.attachmentRevision, bytes: window.btoa(binary), provenance };
            reviewZone.innerHTML = renderUploadReview(review);
            say('Review the selected private image and exact provenance. Nothing has been uploaded.');
        }
        catch {
            say('The selected file could not be read. Choose it again.');
        }
        finally {
            busy = false;
            controls();
        }
    }
    function showReceipt(value) { receipt = value; receiptZone.innerHTML = renderMediaReceipt(value); if (!root.querySelector('[data-recover-media]')) {
        const controls = document.createElement('div');
        controls.className = 'journal-actions';
        controls.innerHTML = '<button type="button" data-recover-media>Check original receipt</button>';
        receiptZone.after(controls);
    } if (value?.state === 'verified' && value.deleteDigest && !root.querySelector('[data-review-delete]')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'quiet';
        button.dataset.reviewDelete = '';
        button.textContent = 'Review artifact deletion';
        root.querySelector('[data-recover-media]').after(button);
    } }
    async function upload() {
        if (busy || locked || !review || !root.querySelector('[data-upload-confirm]')?.checked)
            return;
        requestId = [...window.crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
        locked = true;
        busy = true;
        controls();
        window.history.replaceState(null, '', `/projects/${project}/media?request=${requestId}`);
        showReceipt(null);
        say('Uploading this original private request…');
        const { name, size, hash: checksum, objectUrl: local, ...input } = review;
        const result = await mediaRequest(fetch, `${base}/upload`, { csrf, requestId, confirmed: true, ...input });
        busy = false;
        if (reject(result))
            return;
        if (validReceipt(result.data, project)) {
            showReceipt(result.data);
            say(result.data.state === 'verified' ? 'Stored bytes verified. Inspect whether the current slot attachment succeeded.' : 'Original operation retained. Check its receipt before any further action.');
        }
        else
            say(mediaMessage(result.data?.error));
        controls();
    }
    async function recover() {
        if (busy || !receipt && !hash(requestId))
            return;
        busy = true;
        controls();
        say('Checking the original artifact; no upload is sent again.');
        let result;
        if (!receipt) {
            result = await mediaRequest(fetch, `${base}/receipts/${requestId}`);
            if (reject(result)) {
                busy = false;
                return;
            }
            if (validReceipt(result.data, project))
                showReceipt(result.data);
            else {
                busy = false;
                say(result.status === 404 ? mediaMessage('media_not_found') : mediaMessage(result.data?.error));
                controls();
                return;
            }
        }
        result = await mediaRequest(fetch, `${base}/${receipt.id}/recover`, { csrf });
        busy = false;
        if (reject(result))
            return;
        if (validReceipt(result.data, project)) {
            showReceipt(result.data);
            say('Original receipt checked. Review its current storage and attachment state.');
        }
        else
            say(mediaMessage(result.data?.error));
        controls();
    }
    function reviewDelete() { if (busy || !receipt?.deleteDigest || receipt.state !== 'verified')
        return; deleteReady = true; deleteZone.innerHTML = renderDeleteReview(receipt); controls(); }
    async function remove() { if (busy || !deleteReady || !receipt || !root.querySelector('[data-delete-confirm]')?.checked)
        return; busy = true; controls(); const result = await mediaRequest(fetch, `${base}/${receipt.id}/remove`, { csrf, expectedRevision: receipt.revision, confirmDigest: receipt.deleteDigest }); busy = false; deleteReady = false; deleteZone.innerHTML = ''; if (reject(result))
        return; if (validReceipt(result.data, project)) {
        showReceipt(result.data);
        say(result.data.state === 'deleted' ? 'Stored object absence verified. The receipt remains.' : 'Deletion is not yet confirmed. Check the original receipt; do not assume capacity was released.');
    }
    else
        say(mediaMessage(result.data?.error)); controls(); }
    const click = event => { const target = event.target.closest?.('button'); if (!target)
        return; if (target.matches('[data-review-upload]'))
        reviewUpload(); if (target.matches('[data-upload]'))
        upload(); if (target.matches('[data-recover-media]'))
        recover(); if (target.matches('[data-review-delete]'))
        reviewDelete(); if (target.matches('[data-delete]'))
        remove(); };
    const edit = event => { if (event.target.closest?.('[data-media-form]'))
        invalidate();
    else
        controls(); };
    root.addEventListener('click', click);
    root.addEventListener('input', edit);
    root.addEventListener('change', edit);
    requirements();
    controls();
    return { reviewUpload, upload, recover, reviewDelete, remove, getState: () => ({ requestId, receipt, locked, review }), stop() { root.removeEventListener('click', click); root.removeEventListener('input', edit); root.removeEventListener('change', edit); if (objectUrl)
            window.URL.revokeObjectURL(objectUrl); } };
}
if (typeof document !== 'undefined' && typeof window !== 'undefined')
    startMediaClient({ document, window, fetch: window.fetch.bind(window) });
