export const SHA = 'a'.repeat(40);
export const NOW = '2026-10-23T12:00:00.000Z';
export const source = {sha:SHA,dirty:false};
export const observation = () => ({repo:'acme/plate',observedAt:NOW,source:{...source},remote:{branch:'trunk',sha:SHA},claims:[],gaps:[],localCoverage:'unavailable'});
export const results = () => [
  {id:'gate',state:'ok',facts:{source:'local-command',status:0}},
  {id:'record_contradictions',state:'ok',facts:{findings:[],unknown:[]}},
];
export function readFixture(overrides = {}, calls = []) {
  const data = {
    'repos/acme/plate':{full_name:'acme/plate',default_branch:'trunk'},
    'repos/acme/plate/commits/trunk':{sha:SHA},
    'repos/acme/plate/git/matching-refs/heads/claims/phase-?per_page=100':[],
    'repos/acme/plate/pulls?state=open&per_page=100':[],
    ...overrides,
  };
  return async endpoint => {calls.push(endpoint); if (!(endpoint in data) || data[endpoint] instanceof Error) throw new Error('fixture unavailable'); return data[endpoint];};
}
