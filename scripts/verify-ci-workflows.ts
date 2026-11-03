import fs from 'node:fs';
import path from 'node:path';

const WORKFLOW_DIR = path.resolve(process.cwd(), '.github', 'workflows');
const SHA_REF = /^[0-9a-f]{40}$/;

const workflowFiles = fs
  .readdirSync(WORKFLOW_DIR)
  .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
  .sort();

const failures: string[] = [];

function fail(file: string, message: string) {
  failures.push(`${file}: ${message}`);
}

for (const file of workflowFiles) {
  const fullPath = path.join(WORKFLOW_DIR, file);
  const raw = fs.readFileSync(fullPath, 'utf8');

  if (!/^permissions:\s*$/m.test(raw)) {
    fail(file, 'üst düzey permissions bloğu eksik; repo varsayılan izinleri miras alınmamalı');
  }

  if (/^\s*pull_request_target\s*:/m.test(raw)) {
    fail(file, 'pull_request_target kullanımı güvenilmeyen PR koduna secret/yazma yetkisi taşıyabilir');
  }

  for (const match of raw.matchAll(/^\s*uses:\s*([^\s#]+)@([^\s#]+)/gm)) {
    const [, action, ref] = match;
    if (!SHA_REF.test(ref!)) {
      fail(file, `${action}@${ref} değişmez 40 karakterlik commit SHA ile sabitlenmemiş`);
    }
  }

  for (const match of raw.matchAll(/firebase\s+deploy[\s\S]{0,500}?--only\s+([^\n\\]+)/g)) {
    const targets = match[1]!.trim();
    if (/\b(functions|storage|run|scheduler)\b/.test(targets)) {
      fail(file, `Spark planıyla uyumsuz deploy hedefi bulundu: ${targets}`);
    }
  }
}

const testWorkflow = fs.readFileSync(path.join(WORKFLOW_DIR, 'test.yml'), 'utf8');
const deployJobStart = testWorkflow.indexOf('\n  build_and_deploy:');
if (deployJobStart === -1) {
  fail('test.yml', 'build_and_deploy job bulunamadı');
} else {
  const deployJob = testWorkflow.slice(deployJobStart);
  if (!/^\s{4}needs:\s*test\s*$/m.test(deployJob)) {
    fail('test.yml', 'production deploy yalnızca test job başarıyla bittikten sonra çalışmalı');
  }
  if (/^\s{4}needs:\s*\[[^\]]*gorsel_regresyon/m.test(deployJob)) {
    fail('test.yml', 'yalnızca piksel karşılaştırması olan görsel job production deploy kapısına bağlanmamalı');
  }
}

const baselineWorkflow = fs.readFileSync(path.join(WORKFLOW_DIR, 'gorsel-baseline-yenile.yml'), 'utf8');
const baselineTriggers = baselineWorkflow.match(/^on:\s*$([\s\S]*?)(?=^[A-Za-z_][\w-]*:\s*$)/m)?.[1] ?? '';
if (!/^\s{2}workflow_dispatch:\s*$/m.test(baselineTriggers)) {
  fail('gorsel-baseline-yenile.yml', 'baseline kabulü yalnızca manuel workflow_dispatch ile başlamalı');
}
if (/^\s{2}(push|pull_request|schedule):/m.test(baselineTriggers)) {
  fail('gorsel-baseline-yenile.yml', 'baseline kabulüne otomatik push/PR/schedule tetikleyicisi eklenemez');
}

const stagingWorkflow = fs.readFileSync(path.join(WORKFLOW_DIR, 'staging.yml'), 'utf8');
if (!/if:\s*vars\.STAGING_FIREBASE_PROJECT\s*!=\s*''[\s\S]*GCP_WORKLOAD_IDENTITY_PROVIDER/.test(stagingWorkflow)) {
  fail('staging.yml', 'staging deploy proje ve OIDC değişkenleri yokken fail-closed atlanmalı');
}

if (failures.length > 0) {
  console.error(`CI workflow doğrulaması başarısız (${failures.length} bulgu):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `${workflowFiles.length} workflow doğrulandı: SHA pinleri, permissions, güvenli tetikleyiciler, deploy bağımlılığı ve Spark kapsamı uygun.`
);
