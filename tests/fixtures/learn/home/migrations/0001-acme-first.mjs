// A synthetic migration, so a stub numbers after it.
export const id = '0001-acme-first';
export const to = '0.3.0';
export const summary = 'Acme: the first migration';
export function applies() { return false; }
export function up() { return []; }
