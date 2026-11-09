// Regression: Support Admin markup must stay inside its own view.
// This catches malformed opening tags that cause browsers to eject the
// support inbox / billing forms from the hidden <section class="view">.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
const start=html.indexOf('<section class="view" id="view-support">');
const after=html.indexOf('</div><footer>',start);
assert.ok(start>0&&after>start,'Support tab and layout footer must exist');
const section=html.slice(start,after).trimEnd();
assert.ok(section.endsWith('</section>'),'Support view must close before the main layout footer');
assert.ok(section.includes('<div class="page-heading"><div>'),'Support header must have two valid nested div opening tags');
assert.ok(!/<[^>]*<[a-z!/]/i.test(section),'Malformed nested tag found in Support view');
for(const id of ['support-owner-inbox','owner-ticket-list','support-lookup-form','support-grant-controls']){
  assert.ok(section.includes('id="'+id+'"'),id+' must remain in Support view');
}
for(const tag of ['div','section','form','label']){
  const opens=(section.match(new RegExp('<'+tag+'(?=[\\s>])','g'))||[]).length;
  const closes=(section.match(new RegExp('</'+tag+'>','g'))||[]).length;
  assert.equal(opens,closes,tag+' opening/closing tags must balance inside Support view');
}
assert.match(css,/\.view\s*\{\s*display\s*:\s*none\s*\}/,'Inactive views must be hidden');
assert.match(css,/\.view\.active\s*\{\s*display\s*:\s*block\s*\}/,'Only active views must display');
console.log('PASS: Support Admin panels remain inside their hidden-by-default view.');
