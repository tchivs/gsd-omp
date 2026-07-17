'use strict';

const fs = require('node:fs');
const path = require('node:path');

const OMP_TOOLS = 'read, write, edit, bash, glob, grep, lsp, web_search, task';
const OMP_ORCHESTRATION = `
## OMP native orchestration

OMP's native task tool owns subagents, jobs, progress, cancellation, artifacts, and isolation. When a GSD workflow asks to spawn an Agent(...), dispatch a native task instead; never emulate a subagent with shell backgrounding or a hand-written worktree.

- Use native task's batch schema: shared top-level \`context\` plus \`tasks[]\`; each item needs a stable \`name\`, an \`agent\`, and a complete self-contained \`task\`. Executor work must set \`isolated: true\`.
- Use \`job poll\` only when blocked on a wave barrier. IRC is coordination, not task completion.
- Preserve GSD's commit, merge, verification, SUMMARY.md, and STATE.md gates. Native task execution does not bypass workflow safety.
`;

const OMP_EXECUTOR_PROTOCOL = `
## OMP executor result protocol

End the final report with exactly one lifecycle line, then follow OMP's terminal yield protocol:

\`\`\`text
[gsd-task-result] phase {PHASE} plan {PLAN} task {TASK_ID} completed
\`\`\`

Use \`failed\` or \`cancelled\` instead of \`completed\` when the plan did not complete.
`;

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function commandNames(coreRoot) {
  return fs.readdirSync(path.join(coreRoot, 'commands', 'gsd'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.slice(0, -3));
}

function transformCommands(content, names) {
  if (!names.length) return content;
  const alternatives = [...names].sort((a, b) => b.length - a.length).map(escapeRegex).join('|');
  const pattern = new RegExp(`(?<![a-zA-Z0-9_-])gsd:(${alternatives})(?=[^a-zA-Z0-9_-]|$)`, 'g');
  return content.replace(pattern, (_match, name) => `gsd-${name}`);
}

function rewriteRuntimePaths(content, { coreRoot, runtimeRoot, names }) {
  const coreGsd = toPosix(path.join(coreRoot, 'gsd-core'));
  const ompRoot = toPosix(runtimeRoot);
  return transformCommands(
    content
      .replace(/~\/\.claude\/gsd-core/g, coreGsd)
      .replace(/\$HOME\/\.claude\/gsd-core/g, coreGsd)
      .replace(/~\/\.claude\//g, `${ompRoot}/`)
      .replace(/\$HOME\/\.claude\//g, `${ompRoot}/`)
      .replace(/~\/\.claude\b/g, ompRoot)
      .replace(/\$HOME\/\.claude\b/g, ompRoot),
    names,
  );
}

function projectAgent(content, sourcePath, context) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`Missing YAML frontmatter: ${sourcePath}`);
  const [, frontmatter, rawBody] = match;
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (!name || !description) throw new Error(`Missing name or description: ${sourcePath}`);
  const body = rewriteRuntimePaths(rawBody, context);
  return [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    `tools: ${OMP_TOOLS}`,
    'spawns: "*"',
    '---',
    '',
    body,
    OMP_ORCHESTRATION,
    name === 'gsd-executor' ? OMP_EXECUTOR_PROTOCOL : '',
  ].filter((part) => part !== '').join('\n');
}

function runtimeCliBlock(coreRoot) {
  const cliPath = toPosix(path.join(coreRoot, 'gsd-core', 'bin', 'gsd-tools.cjs'));
  return `<omp_runtime_cli>\n**OMP runtime CLI:** \`${cliPath}\` is the authoritative GSD CLI for this plugin. Run it with \`GSD_RUNTIME=omp\`; do not dispatch a different runtime's bare \`gsd-tools\` executable. OMP owns model routing, approvals, native tasks, and isolation.\n</omp_runtime_cli>`;
}

function projectSkill(name, content, context) {
  const rewritten = rewriteRuntimePaths(content, context);
  const block = runtimeCliBlock(context.coreRoot);
  if (rewritten.includes(block)) return rewritten;
  const marker = ['<context>', '<process>', '<objective>'].find((candidate) => rewritten.includes(candidate));
  const frontmatterEnd = rewritten.indexOf('\n---\n', 3);
  const index = marker ? rewritten.indexOf(marker) : frontmatterEnd < 0 ? -1 : frontmatterEnd + 5;
  if (index < 0) throw new Error(`Missing insertion point in ${name}/SKILL.md`);
  return `${rewritten.slice(0, index)}${block}\n\n${rewritten.slice(index)}`;
}

function buildProjectedArtifacts({ coreRoot, runtimeRoot }) {
  const names = commandNames(coreRoot);
  const context = { coreRoot, runtimeRoot, names };
  const artifacts = [];
  const agentsRoot = path.join(coreRoot, 'agents');
  for (const entry of fs.readdirSync(agentsRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/^gsd-.*\.md$/.test(entry.name)) continue;
    const sourcePath = path.join(agentsRoot, entry.name);
    artifacts.push({
      relativePath: path.join('agents', entry.name),
      content: projectAgent(fs.readFileSync(sourcePath, 'utf8'), sourcePath, context),
    });
  }

  const skillsRoot = path.join(coreRoot, 'skills');
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('gsd-')) continue;
    const sourcePath = path.join(skillsRoot, entry.name, 'SKILL.md');
    if (!fs.existsSync(sourcePath)) continue;
    artifacts.push({
      relativePath: path.join('skills', entry.name, 'SKILL.md'),
      content: projectSkill(entry.name, fs.readFileSync(sourcePath, 'utf8'), context),
    });
  }
  return artifacts;
}

module.exports = {
  buildProjectedArtifacts,
  commandNames,
  projectAgent,
  projectSkill,
  rewriteRuntimePaths,
  transformCommands,
};
