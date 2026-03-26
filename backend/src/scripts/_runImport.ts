/**
 * _runImport.ts — run with ts-node from the backend/ directory
 *
 * Usage:
 *   npx ts-node src/scripts/_runImport.ts                         # buses + transmetro
 *   npx ts-node src/scripts/_runImport.ts buses                   # buses only
 *   npx ts-node src/scripts/_runImport.ts transmetro              # Transmetro only
 *   npx ts-node src/scripts/_runImport.ts qruta                   # qruta interactivo
 *   npx ts-node src/scripts/_runImport.ts qruta --dry-run         # solo reporte
 *   npx ts-node src/scripts/_runImport.ts qruta --apply           # aplica sin confirmar
 *   npx ts-node src/scripts/_runImport.ts qruta --apply --force   # aplica incluso conflictos
 */

import { importBuses } from './importBuses';
import { importTransmetro } from './importTransmetro';
import { importQruta } from './importQruta';

const arg   = process.argv[2]?.toLowerCase();
const flags = process.argv.slice(3);

async function main() {
  if (!arg || arg === 'buses') {
    console.log('=== Buses (AMBQ KMZ) ===');
    const r = await importBuses();
    console.log('BUSES DONE:', JSON.stringify(r));
  }

  if (!arg || arg === 'transmetro') {
    console.log('\n=== Transmetro ===');
    const r = await importTransmetro();
    console.log('TRANSMETRO DONE:', JSON.stringify(r));
  }

  if (arg === 'qruta') {
    console.log('\n=== Qruta GPS ===');
    const r = await importQruta({
      dryRun: flags.includes('--dry-run'),
      apply:  flags.includes('--apply'),
      force:  flags.includes('--force'),
    });
    console.log('QRUTA DONE:', JSON.stringify(r));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e: Error) => { console.error('ERR:', e.message); process.exit(1); });
