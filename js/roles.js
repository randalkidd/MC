// Roles: what each role may do, beyond the permissions the relay enforces.
// - PERMS: enforced by the relay on every request (a role grants these to every key assigned to it).
// - CAPS: finer page features, shown or hidden per role (each lists the controls it covers).
// - Boxes: any element marked data-box on a user page can be hidden per role.
// Hiding is a convenience for a cleaner page: anything that writes data is still checked by the relay against PERMS.

export const PERM_INFO = {
  review: 'Plan Review Hub, SubdivisionDB and land-division tools',
  write: 'Save to the public repo (SubdivisionDB, waitlist, parcel reports)',
  queue: 'Queued Review (private plan queue)',
  rapid: 'In-Depth Review (Anthropic API — costs money)',
  saved: 'Saved Items (private reports and reviews)',
  play: 'Play games in Behind the Curtains',
  admin: 'Administer keys, roles, user folders and the scoreboard',
};
export const PERM_ORDER = ['review', 'write', 'queue', 'rapid', 'saved', 'play', 'admin'];

// [id, page, label, CSS selectors it covers, permission it also needs]
export const CAPS = [
  ['lookup.copy', 'Parcel Lookup', 'Copy / download the report (.md)', '#rep-copy, #rep-dl'],
  ['lookup.pdf', 'Parcel Lookup', 'Save PDF / print the report', '#rep-pdf, #rep-print'],
  ['lookup.history', 'Parcel Lookup', 'Historical Aerials viewer', '#rep-hist'],
  ['lookup.save', 'Parcel Lookup', 'Save the report to Saved Items', '#rep-save', 'saved'],
  ['lookup.clear', 'Parcel Lookup', 'Clear button (clears Plan Review Hub)', '#hub-clear', 'review'],
  ['review.superficial', 'Plan Review Hub', 'Superficial Review', '#sp-free', 'review'],
  ['review.queued', 'Plan Review Hub', 'Queued Review', '#sp-queue-btn', 'queue'],
  ['review.indepth', 'Plan Review Hub', 'In-Depth Review', '#sp-run', 'rapid'],
  ['review.viewer', 'Plan Review Hub', 'Plan Viewer', '#sp-view', 'review'],
  ['review.queueload', 'Plan Review Hub', 'Load / delete plans in Plan Queue', '#sp-qlist [data-qload], #sp-qlist [data-qdel], #sp-qrefresh', 'queue'],
  ['review.verify', 'Plan Review Hub', 'Review Verification', '#vf-start, #vf-flagged', 'review'],
  ['review.letter', 'Plan Review Hub', 'Comment letter (PDF)', '#rv-letter', 'review'],
  ['review.export', 'Plan Review Hub', 'Copy / download the markup', '#rv-copy, #rv-dl', 'review'],
  ['review.save', 'Plan Review Hub', 'Save the review to Saved Items', '#rv-save', 'saved'],
  ['review.clear', 'Plan Review Hub', 'Clear plan / New review', '#sp-clear, #rv-reset', 'review'],
  ['subs.edit', 'SubdivisionDB', 'Add / edit / save SubdivisionDB plats', '#db-new, #db-save, #ed-save, #ed-delete, #ed-count', 'write'],
  ['subs.export', 'SubdivisionDB', 'Export JSON / CSV', '#db-export, #as-export', 'review'],
  ['subs.refresh', 'SubdivisionDB', 'Refresh All Subdivisions from county GIS', '#as-refresh', 'review'],
  ['subs.waitlist', 'SubdivisionDB', 'Add subdivisions to the waitlist', '[data-as-queue]', 'write'],
  ['subs.process', 'SubdivisionDB', 'Process the waitlist with Claude', '#queue-run, #queue-copy', 'write'],
  ['games.play', 'Behind the Curtains', 'Play MCTrained', '#mct-go', 'play'],
];
export const CAP_IDS = CAPS.map(c => c[0]);

// Pages whose boxes can be hidden per role (Settings, Profile and Sign In are never hidden).
export const ROLE_PAGES = [['p-lookup', 'Parcel Lookup'], ['p-review', 'Plan Review Hub'], ['p-subs', 'SubdivisionDB'], ['p-saved', 'Saved Items'], ['p-ref', 'Reference'], ['p-games', 'Behind the Curtains']];
export function boxRegistry(doc = document) {
  return ROLE_PAGES.map(([id, page]) => {
    const seen = new Set(); const boxes = [];
    for (const el of doc.querySelectorAll(`#${id} [data-box]`)) {
      const b = el.dataset.box; if (seen.has(b)) continue; seen.add(b);
      const h = el.dataset.boxLabel || (el.querySelector('h2') || {}).textContent || b;
      boxes.push({ id: b, label: String(h).replace(/[▾▸]/g, '').replace(/\s+/g, ' ').trim() });
    }
    return { id, page, boxes };
  });
}

// Starting roles an administrator can add with one click (edit freely afterwards).
export const DEFAULT_ROLES = [
  { name: 'Viewer', description: 'Looks up parcels and reads the reference; runs Superficial Reviews; cannot save anything.', perms: ['review', 'play'], caps: CAP_IDS.filter(c => !['lookup.save', 'review.save', 'review.queued', 'review.indepth', 'review.queueload', 'subs.edit', 'subs.waitlist', 'subs.process'].includes(c)), hidden: [] },
  { name: 'Reviewer', description: 'Plan reviewer: saves to GitHub and Saved Items, uses Queued Review.', perms: ['review', 'write', 'queue', 'saved', 'play'], caps: CAP_IDS.filter(c => c !== 'review.indepth'), hidden: [] },
  { name: 'Senior Reviewer', description: 'Reviewer plus In-Depth Review (uses the Anthropic API key).', perms: ['review', 'write', 'queue', 'rapid', 'saved', 'play'], caps: CAP_IDS.slice(), hidden: [] },
  { name: 'Administrator', description: 'Everything, including keys, roles, user folders and the scoreboard.', perms: PERM_ORDER.slice(), caps: CAP_IDS.slice(), hidden: [] },
];

// Apply a role to this page: hide the capabilities it lacks and the boxes it hides. No role = everything shown.
export function applyRole(role, doc = document) {
  let st = doc.getElementById('role-style');
  if (!st) { st = doc.createElement('style'); st.id = 'role-style'; doc.head.appendChild(st); }
  if (!role) { st.textContent = ''; doc.documentElement.removeAttribute('data-role'); return; }
  const caps = new Set(role.caps || []);
  const sel = CAPS.filter(c => !caps.has(c[0])).map(c => c[3]).concat((role.hidden || []).map(b => `[data-box="${String(b).replace(/["\\]/g, '')}"]`));
  st.textContent = sel.length ? `${sel.join(',\n')} { display: none !important; }` : '';
  doc.documentElement.dataset.role = role.id || 'preview';
}
export const roleAllows = (role, cap) => !role || (role.caps || []).includes(cap);
