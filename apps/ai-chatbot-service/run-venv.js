const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const isWin = os.platform() === 'win32';
const venvBinDir = path.join(__dirname, '.venv', isWin ? 'Scripts' : 'bin');

const cmdName = process.argv[2];
const remainingArgs = process.argv.slice(3);

if (!cmdName) {
  console.error('No command specified');
  process.exit(1);
}

const ext = isWin && !cmdName.endsWith('.exe') ? '.exe' : '';
const venvCmdPath = path.join(venvBinDir, cmdName + ext);
const finalCmd = fs.existsSync(venvCmdPath) ? venvCmdPath : cmdName;

const result = spawnSync(finalCmd, remainingArgs, { stdio: 'inherit', shell: true });
process.exit(result.status ?? 0);
