// Escaped local HTML only. Local links are validated by inspectShape before render.
import { relative, dirname, join } from 'node:path';
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const p = s => `<p>${esc(s)}</p>`;
const ul = rows => rows.length ? `<ul>${rows.map(s=>`<li>${esc(s)}</li>`).join('')}</ul>` : '<p>None declared.</p>';
export function renderShape(plan, output) {
  const r=plan.record;
  const question=q=>{
    const a=r.answers.find(a=>a.question===q.id);
    const link=q.preview?`<p><a href="${esc(relative(dirname(join(output,'index.html')),q.preview).split('/').map(encodeURIComponent).join('/'))}">${esc(q.preview)}</a> — local image/PDF; opens separately.</p>`:'';
    return `<article><h3>${esc(q.id)}: ${esc(q.question)}</h3><h4>Why the owner is needed</h4>${p(q.whyOwner)}<h4>Recommendation — not an owner choice</h4>${p(q.recommendation.text)}<h4>Evidence supplied</h4>${ul(q.recommendation.evidence)}<h4>Alternatives</h4>${ul(q.recommendation.alternatives)}<h4>${a?'Owner answer — manual attribution':'Unanswered — owner input required'}</h4>${a?p(a.text)+p(`${a.actor} · ${a.time} · source: ${a.source}`):p('No answer recorded. The recommendation is not approval.')}${link}</article>`;
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(r.id)} — shaping review</title>
<style>body{font:17px/1.55 system-ui,sans-serif;max-width:900px;margin:3rem auto;padding:0 1.5rem;color:#20262e;background:#faf9f6}h1,h2,h3{line-height:1.2}h2{margin-top:2.5rem;border-top:1px solid #bbb;padding-top:1rem}article{padding:1rem 1.5rem;margin:1rem 0;background:white;border:1px solid #ddd;border-radius:8px}h4{margin-bottom:.25rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}code{overflow-wrap:anywhere}a{color:#164ca0}</style></head><body>
<h1>Shaping review: ${esc(r.id)}</h1>${p(`Revision ${r.revision} · ${r.date} · Goal ${r.goal}`)}
<h2>Outcome</h2>${ul(r.items.map(w=>`${w.id}: ${w.doneWhen}`))}
<h2>Approval and proof limits</h2>${p('Manual attribution is not authentication. Named proof is not verified. The conductor must judge proof sufficiency. No model or issue is started by this review.')}<p>Approve only this digest: <code>${plan.digest}</code></p>${p('Changed source content requires a new review. Phase drafts remain planned with unchecked acceptance and no evidence.')}
<h2>Questions, recommendations and owner answers</h2>${r.questions.length?r.questions.map(question).join(''):p('No owner questions declared.')}
<h2>Unanswered questions</h2>${ul(r.questions.filter(q=>!r.answers.some(a=>a.question===q.id)).map(q=>`${q.id}: ${q.question}`))}
<h2>Accepted source decisions</h2>${plan.context.decisions.length?plan.context.decisions.map(d=>`<article><h3>${esc(d.ref)}</h3>${p(`Scope: ${d.scope.join(', ')} · ${d.decided_by} · ${d.decided_at}`)}<pre>${esc(d.statement)}</pre></article>`).join(''):p(`No accepted choices resolved (${plan.context.state}).`)}
<h2>Proposed decisions — not accepted</h2>${r.proposedDecisions.map(d=>`<article><h3>${esc(d.id)}</h3>${p(d.statement)}${p(`Scope: ${d.scope.join(', ')}`)}<h4>Proposed supersession references</h4>${ul(d.supersedes)}</article>`).join('')||p('None declared.')}${plan.context.proposals.map(d=>`<article><h3>${esc(d.ref)}</h3><pre>${esc(d.statement)}</pre></article>`).join('')}
<h2>Work items</h2>${r.items.map(w=>`<article><h3>${esc(w.title)}</h3>${p(`${w.id} · ${w.kind} · ${plan.outputs.find(o=>o.item===w.id)?.path ?? 'preview only'}`)}<h4>Problem and scope</h4>${p(w.problem)}${p(w.scope)}<h4>Done when</h4>${p(w.doneWhen)}<h4>Named proof — not run</h4>${ul(w.proof)}<h4>Dependencies</h4>${ul(w.depends)}<h4>Decision references</h4>${ul(w.decisions)}<h4>Owner prerequisites</h4>${ul(w.ownerPrerequisites.map(q=>`${q}: ${r.answers.some(a=>a.question===q)?'answer recorded; see manual attribution above':'UNANSWERED — resolve before conducting'}`))}<h4>Real surfaces</h4>${ul(w.surfaces.map(s=>`${s.name}: ${s.proof}`))}</article>`).join('')}
<details><summary>Exact reviewed data and draft bytes</summary><pre>${esc(JSON.stringify(plan,null,2))}</pre></details></body></html>`;
}
