// Only a timestamp preference is persisted; never source records, private media or credentials.
export const FIRST_VISIT_DAYS = 7;
export function journalWindow(raw, now = Date.now()) {
    const value = Number(raw), valid = typeof raw === 'string' && /^\d{13}$/.test(raw) && Number.isSafeInteger(value) && value <= now && value >= now - 365 * 86400000;
    // Publication records have day precision, so the entire previous visit day is included.
    const day = 86400000;
    const since = Math.floor((valid ? value : now - (FIRST_VISIT_DAYS - 1) * day) / day) * day;
    const date = new Date(since).toISOString().slice(0, 10);
    return { since, first: !valid, label: valid
        ? `From your previous visit's date: ${date} UTC. The whole day is included because additions have dates, not times; some may already be familiar`
        : `First visit: the last ${FIRST_VISIT_DAYS} days, from ${date} UTC (whole publication days)` };

}
export function journalMatches(date, range, mode) { if (mode !== 'since')
    return true; const stamp = Date.parse(date); return Number.isFinite(stamp) && stamp >= range.since; }
export function readJournalVisits(raw, now = Date.now()) { try {
    if (typeof raw !== 'string' || raw.length > 16384)
        return [];
    const v = JSON.parse(raw);
    if (v.version !== 1 || !Array.isArray(v.visits) || v.visits.length > 50)
        return [];
    return v.visits.filter(item => item && typeof item.view === 'string' && /^[A-Za-z0-9%_-]{1,192}$/.test(item.view) && !journalWindow(item.at, now).first);
}
catch {
    return [];
} }
export function startJournalPreference({ document, window, onChange = () => { } }) {
    const holder = document.querySelector('[data-journal-scope]'), filter = document.querySelector('[data-journal-filter]'), note = document.querySelector('[data-journal-date]');
    if (!holder || !filter)
        return null;
    const scope = holder.dataset.journalScope;
    if (typeof scope !== 'string' || scope.length > 240 || !/^keel\.journal\.v1:[A-Za-z0-9%_-]+:\d+:[A-Za-z0-9%_-]+$/.test(scope))
        return null;
    const now = Date.now(), at = scope.lastIndexOf(':'), key = scope.slice(0, at), view = scope.slice(at + 1);
    let previous = null;
    try {
        const raw = window.localStorage.getItem(key);
        const values = readJournalVisits(raw, now);
        previous = values.find(item => item.view === view)?.at ?? null;
        const next = [{ view, at: String(now) }, ...values.filter(item => item.view !== view)].slice(0, 50);
        window.localStorage.setItem(key, JSON.stringify({ version: 1, visits: next }));
    }
    catch { }
    const range = journalWindow(previous, now);
    if (note)
        note.textContent = `${range.label}. This personal filter never hides required decisions or walks.`;
    const apply = () => { let shown = 0, total = 0; for (const card of holder.querySelectorAll('[data-change-time]')) {
        card.hidden = !journalMatches(card.dataset.changeTime, range, filter.value);
        total++;
        if (!card.hidden)
            shown++;
    } const empty = document.querySelector('[data-journal-empty]'); if (empty)
        empty.hidden = !total || shown > 0; onChange(); };
    filter.addEventListener('change', apply);
    apply();
    return { range, matches: date => journalMatches(date, range, filter.value), apply, stop() { filter.removeEventListener('change', apply); } };
}
export function startGallery({ document }) {
    let dialog = null, opener = null;
    const close = () => { dialog?.close(); };
    const click = event => {
        const link = event.target.closest?.('[data-enlarge]');
        if (!link)
            return;
        const src = link.dataset.image;
        if (!/^\/api\/projects\/[a-z][a-z0-9-]{0,63}\/media\/[a-f0-9]{64}\/bytes$/.test(src))
            return;
        event.preventDefault();
        opener = link;
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.className = 'journal-dialog';
            dialog.setAttribute('aria-label', 'Enlarged private capture');
            const bar = document.createElement('div');
            bar.className = 'journal-actions';
            const title = document.createElement('strong');
            title.textContent = 'Private capture';
            const button = document.createElement('button');
            button.textContent = 'Close';
            button.addEventListener('click', close);
            bar.append(title, button);
            dialog.append(bar, document.createElement('img'), document.createElement('p'));
            dialog.addEventListener('close', () => opener?.focus());
            document.body.append(dialog);
        }
        const img = dialog.querySelector('img');
        img.src = src;
        img.alt = link.dataset.alt || 'Private capture';
        dialog.querySelector('p').textContent = link.dataset.caption || 'Capture provenance stays with the original receipt.';
        dialog.showModal();
        dialog.querySelector('button').focus();
    };
    const imageError = event => { if (!event.target.matches?.('[data-private-image]'))
        return; const figure = event.target.closest('figure'); event.target.closest('a')?.setAttribute('hidden', ''); const text = figure?.querySelector('[data-image-error]'); if (text)
        text.hidden = false; };
    document.addEventListener('click', click);
    document.addEventListener('error', imageError, true);
    return { stop() { document.removeEventListener('click', click); document.removeEventListener('error', imageError, true); dialog?.remove(); } };
}
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    startGallery({ document });
    if (!document.querySelector('[data-home-root]'))
        startJournalPreference({ document, window });
}
