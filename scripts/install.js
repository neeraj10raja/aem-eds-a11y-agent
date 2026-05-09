#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {
    target: null,
    agentDir: 'a11y-agent',
    paths: ['/'],
    siteUrl: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--target') {
      i += 1;
      args.target = argv[i];
    } else if (arg === '--agent-dir') {
      i += 1;
      args.agentDir = argv[i];
    } else if (arg === '--site-url') {
      i += 1;
      args.siteUrl = argv[i];
    } else if (arg === '--paths') {
      i += 1;
      args.paths = argv[i].split(',').map((p) => p.trim()).filter(Boolean);
    } else if (!args.target) args.target = arg;
  }

  return args;
}

function ensureInsideGitRepo(target) {
  if (!existsSync(join(target, '.git'))) {
    throw new Error(`Target does not look like a git repository: ${target}`);
  }
}

function rewriteWorkflow(workflow, agentDir) {
  return workflow
    .replaceAll('a11y-agent/*.js', `${agentDir}/*.js`)
    .replaceAll('node a11y-agent/index.js', `node ${agentDir}/index.js`)
    .replaceAll('working-directory: a11y-agent', `working-directory: ${agentDir}`);
}

function buildConfig(paths, siteUrl) {
  const config = JSON.parse(readFileSync(join(repoRoot, 'a11y-agent.config.example.json'), 'utf8'));
  config.paths = paths;
  if (siteUrl) config.site_url = siteUrl;
  else delete config.site_url;
  return `${JSON.stringify(config, null, 2)}\n`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function patchEsLintConfig(target, agentDir) {
  const candidates = ['.eslintrc.js', '.eslintrc.cjs'];
  const found = candidates.find((file) => existsSync(join(target, file)));
  if (!found) return 'missing';

  const eslintPath = join(target, found);
  const content = readFileSync(eslintPath, 'utf8');
  const agentPattern = `${agentDir}/**/*.js`;
  const agentPatternRegex = new RegExp(`['"\`]${escapeRegExp(agentPattern)}['"\`]`);
  if (agentPatternRegex.test(content)) return 'already-configured';

  const patched = content.replace(
    /files:\s*\[([^\]]*['"`]tools\/\*\*\/\*\.js['"`][^\]]*)\]/s,
    (match, files) => `files: [${files.trim()}, '${agentPattern}']`,
  );
  if (patched === content) return 'unsupported';

  writeFileSync(eslintPath, patched);
  return 'patched';
}

function install(args) {
  if (!args.target) {
    throw new Error('Usage: node scripts/install.js --target /path/to/eds-repo [--site-url https://example.com] [--paths /,/blog]');
  }

  const target = resolve(args.target);
  ensureInsideGitRepo(target);

  const agentTarget = join(target, args.agentDir);
  mkdirSync(agentTarget, { recursive: true });
  cpSync(join(repoRoot, 'a11y-agent'), agentTarget, { recursive: true });

  const workflowDir = join(target, '.github/workflows');
  mkdirSync(workflowDir, { recursive: true });
  const workflow = readFileSync(join(repoRoot, 'scripts/templates/a11y-regression.yml'), 'utf8');
  writeFileSync(join(workflowDir, 'a11y-regression.yml'), rewriteWorkflow(workflow, args.agentDir));

  const baselineDir = join(target, '.github/baselines');
  mkdirSync(baselineDir, { recursive: true });
  const baselinePath = join(baselineDir, 'a11y.json');
  if (!existsSync(baselinePath)) writeFileSync(baselinePath, '{}\n');

  const configPath = join(target, 'a11y-agent.config.json');
  const configCreated = !existsSync(configPath);
  if (configCreated) writeFileSync(configPath, buildConfig(args.paths, args.siteUrl));

  const eslintStatus = patchEsLintConfig(target, args.agentDir);

  console.log(`Installed a11y agent into ${target}`);
  if (eslintStatus === 'patched') console.log('Patched .eslintrc to add a11y-agent Node.js overrides.');
  else if (eslintStatus === 'already-configured') {
    console.log('.eslintrc already includes a11y-agent Node.js overrides.');
  } else if (eslintStatus === 'unsupported') {
    console.log('Could not auto-patch .eslintrc; add a Node.js override for a11y-agent/**/*.js.');
  }
  if (!configCreated) console.log('Kept existing a11y-agent.config.json.');
  console.log('');
  console.log('Next steps in GitHub:');
  console.log('1. Enable Actions read/write workflow permissions.');
  console.log('2. Run "Accessibility Regression Detection" with update_baseline=true.');
  console.log('');
  console.log('Safe default: this agent opens issues only. It does not create AI code changes.');
}

try {
  install(parseArgs(process.argv.slice(2)));
} catch (err) {
  console.error(`[install] ${err.message}`);
  process.exit(1);
}
