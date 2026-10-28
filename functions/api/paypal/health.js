import { json, VERSION } from './_shared.js';
// Safe public deployment marker: exposes no account identifiers, keys, subscription data or env vars.
export function onRequestGet() { return json({ service: 'AI Study Buddy PayPal Sandbox', sandbox: true, deployed: VERSION }); }
