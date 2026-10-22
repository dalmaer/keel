// The night in a box's world (plates phase 86), loaded with --import into every
// node a box's workflow step starts (NODE_OPTIONS): a frozen clock and no
// network. tests/night-box.test.mjs runs the shipped workflows' own shell, in
// which node reads the clock (the morning decides by it, improve and climb
// date their pages and picks by it), so the clock is frozen where it is read
// rather than passed in: PLATES_BOX_NOW, an ISO time, is what `new Date()` and
// `Date.now()` say. Any socket to a host, a DNS lookup or a fetch throws: a
// box that reaches the network fails, naming it, instead of passing on a
// machine that happens to be online.
import net from 'node:net';
import dns from 'node:dns';

const at = Date.parse(process.env.PLATES_BOX_NOW ?? '');
if (!Number.isFinite(at)) throw new Error(`night box: PLATES_BOX_NOW is not a time (${JSON.stringify(process.env.PLATES_BOX_NOW)})`);

const Real = Date;
class Frozen extends Real {
  constructor(...args) { if (args.length) super(...args); else super(at); }
  static now() { return at; }
}
globalThis.Date = Frozen;

export const NO_NETWORK = 'night box: no network';
const refuse = what => { throw new Error(`${NO_NETWORK} (${what})`); };
const connect = net.Socket.prototype.connect;
// A local socket path (a pipe) is not the network; a port or a host is.
net.Socket.prototype.connect = function (...args) {
  const o = Array.isArray(args[0]) ? args[0][0] : args[0];
  const path = typeof o === 'string' ? !/^\d+$/.test(o) : o && typeof o === 'object' && typeof o.path === 'string';
  if (!path) refuse(`connect ${typeof o === 'object' ? `${o?.host ?? 'localhost'}:${o?.port}` : `port ${o}`}`);
  return connect.apply(this, args);
};
dns.lookup = () => refuse('dns lookup');
dns.promises.lookup = async () => refuse('dns lookup');
globalThis.fetch = async url => refuse(`fetch ${url}`);
