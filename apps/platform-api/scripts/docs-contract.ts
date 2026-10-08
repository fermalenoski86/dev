import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deliveryText } from '../src/delivery';
import { openApiText } from '../src/openapi';

/** E1 · BL-11/§43: regenera docs/platform/openapi.json y DELIVERY.md. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
writeFileSync(path.join(root, 'docs/platform/openapi.json'), openApiText());
writeFileSync(path.join(root, 'docs/platform/DELIVERY.md'), deliveryText(root));
console.log('docs/platform/openapi.json y docs/platform/DELIVERY.md regenerados');
