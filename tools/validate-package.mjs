import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'CLAUDE.md', 'Requirements.md', 'IMPLEMENTATION_DECISIONS.md',
  'PROJECT_STATUS.md', 'DECISIONS.md', 'IMPLEMENTATION_STATUS.md',
  'REQUIREMENTS_TRACEABILITY.md', '.claude/settings.json',
  'prompts/prompt-manifest.json', 'prompts/requirements-traceability.json',
  'tools/Copy-DragonPrompt.ps1', 'tools/Setup-Project.ps1',
  'tools/Initialize-LocalEnv.ps1',
  '01-INSTALL-TOOLS.cmd', '02-SETUP-PROJECT.cmd', '03-CHECK-PACKAGE.cmd',
  '04-COPY-NEXT-PROMPT.cmd', '05-START-CLAUDE.cmd', '06-CREATE-LOCAL-ENV.cmd'
];
for (const relative of required) {
  assert.ok(fs.existsSync(path.join(root, relative)), `Missing required file: ${relative}`);
}

const prompts = fs.readdirSync(path.join(root, 'prompts'))
  .filter((name) => /^\d{2}-.*\.md$/.test(name))
  .sort();
assert.equal(prompts.length, 28, 'Expected 28 main DRAGON prompts.');
for (let i = 0; i < 28; i += 1) {
  assert.ok(prompts[i].startsWith(String(i).padStart(2, '0') + '-'), `Prompt order mismatch at ${i}`);
  const text = fs.readFileSync(path.join(root, 'prompts', prompts[i]), 'utf8');
  assert.match(text, /```text\s*\r?\n[\s\S]+?\r?\n```/, `Main prompt is not copyable: ${prompts[i]}`);
}

const sliceDir = path.join(root, 'prompts', 'slices');
const slices = fs.readdirSync(sliceDir).filter((name) => /^(09|11|16|17|27)[a-c]-.*\.md$/.test(name)).sort();
assert.equal(slices.length, 15, 'Expected 15 prompt slices.');
for (const name of slices) {
  const text = fs.readFileSync(path.join(sliceDir, name), 'utf8').trim();
  assert.ok(text.length > 200, `Slice is empty or incomplete: ${name}`);
  assert.match(text, /^# DRAGON-/m, `Slice lacks a DRAGON heading: ${name}`);
}

const inspected = [
  path.join(root, 'CLAUDE.md'), path.join(root, 'IMPLEMENTATION_DECISIONS.md'),
  ...prompts.map((name) => path.join(root, 'prompts', name)),
  ...slices.map((name) => path.join(sliceDir, name))
].map((name) => fs.readFileSync(name, 'utf8')).join('\n');
assert.doesNotMatch(inspected, /\/build-loop|\[verify:AC-|createHmac|loop-state\.mjs|verify-loop\.mjs/i);

const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
assert.equal('sandbox' in settings, false, 'Native Windows package should not enable unsupported sandboxing.');
assert.equal(settings.hooks.PreToolUse[0].matcher, 'Bash|PowerShell');

const copyTool = fs.readFileSync(path.join(root, 'tools', 'Copy-DragonPrompt.ps1'), 'utf8');
assert.match(copyTool, /Get-Content \$statusPath -Raw -Encoding UTF8/);
assert.match(copyTool, /Get-Content \$files\[0\]\.FullName -Raw -Encoding UTF8/);
assert.match(copyTool, /\(\?:\[a-c\]\)\?/);
assert.match(copyTool, /elseif \(\$isSlice\)/);

const setupTool = fs.readFileSync(path.join(root, 'tools', 'Setup-Project.ps1'), 'utf8');
assert.match(setupTool, /\$gitBashCandidates = @\(@\(/, 'Git Bash candidates must remain an array for a single match.');
assert.match(setupTool, /baseline Dragon ecosystem starter/);
assert.match(setupTool, /git', 'bundle'|@\('bundle'/);

const status = fs.readFileSync(path.join(root, 'PROJECT_STATUS.md'), 'utf8');
for (const parent of ['09', '11', '16', '17', '27']) {
  assert.doesNotMatch(status, new RegExp(`^- \\[ \\] DRAGON-${parent}$`, 'm'), `Sliced parent DRAGON-${parent} must not auto-run.`);
  for (const suffix of ['a', 'b', 'c']) {
    assert.match(status, new RegExp(`^- \\[ \\] DRAGON-${parent}${suffix}$`, 'm'));
  }
}

const attrs = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8');
for (const rule of ['*.yml text eol=lf', '*.yaml text eol=lf', 'Dockerfile text eol=lf', '*entrypoint* text eol=lf']) {
  assert.ok(attrs.includes(rule), `Missing .gitattributes rule: ${rule}`);
}

const prompt00 = fs.readFileSync(path.join(root, 'prompts', prompts[0]), 'utf8');
assert.match(prompt00, /git rev-list --all --count/);
assert.match(prompt00, /MUST NOT publish host port 27017/);
assert.match(prompt00, /do not wholesale recreate files/i);
assert.match(prompt00, /06-CREATE-LOCAL-ENV\.cmd/);

console.log('Package validation passed: recovery baseline, UTF-8 prompt copy, 28 prompts, 15 slices, Windows wrappers, protected sources, and safe Mongo networking.');
