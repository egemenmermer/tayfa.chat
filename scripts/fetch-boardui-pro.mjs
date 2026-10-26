// Fetches the private BoardUI Pro submodule (apps/desktop/src/boardui-pro) for official CI builds.
//
// The read-only deploy key arrives in TAYFA_PRO_UI_DEPLOY_KEY (GitHub secret). Without it (fork pull
// requests, contributors) the script exits 0 and the build uses apps/desktop/src/boardui-pro-fallback.
// The key is written to a fresh temporary directory with mode 0600, used through GIT_SSH_COMMAND with
// GitHub's pinned host key, and removed again whatever happens.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SUBMODULE = 'apps/desktop/src/boardui-pro';
const SSH_URL = 'git@github.com:egemenmermer/tayfa-pro-ui.git';
// https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
const GITHUB_HOST_KEY =
  'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';

const key = process.env.TAYFA_PRO_UI_DEPLOY_KEY?.trim();
if (!key) {
  console.log(
    'BoardUI Pro: no deploy key in this job; building with apps/desktop/src/boardui-pro-fallback.',
  );
  process.exit(0);
}

const dir = mkdtempSync(path.join(tmpdir(), 'tayfa-pro-ui-'));
const forward = (file) => file.replaceAll('\\', '/');
try {
  const keyFile = path.join(dir, 'deploy_key');
  const knownHosts = path.join(dir, 'known_hosts');
  writeFileSync(keyFile, `${key}\n`, { mode: 0o600 });
  chmodSync(keyFile, 0o600);
  writeFileSync(knownHosts, `${GITHUB_HOST_KEY}\n`, { mode: 0o600 });
  const env = {
    ...process.env,
    TAYFA_PRO_UI_DEPLOY_KEY: '',
    GIT_SSH_COMMAND: [
      'ssh',
      `-i "${forward(keyFile)}"`,
      '-o IdentitiesOnly=yes',
      '-o StrictHostKeyChecking=yes',
      `-o UserKnownHostsFile="${forward(knownHosts)}"`,
    ].join(' '),
  };
  const git = (...args) => execFileSync('git', args, { stdio: 'inherit', env });
  try {
    git('submodule', 'init', '--', SUBMODULE);
    // .gitmodules carries the HTTPS URL; the deploy key needs SSH. This only changes .git/config.
    git('config', `submodule.${SUBMODULE}.url`, SSH_URL);
    git('submodule', 'update', '--depth', '1', '--', SUBMODULE);
    console.log('BoardUI Pro: submodule fetched.');
  } catch {
    // The fallback builds the same app; a fetch failure must not fail every job.
    console.log(
      '::warning::BoardUI Pro: fetching the submodule failed; building with apps/desktop/src/boardui-pro-fallback.',
    );
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
