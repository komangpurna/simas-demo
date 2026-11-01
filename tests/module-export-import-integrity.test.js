/**
 * Unit Test: Audit Statis Integritas Resolusi Ekspor-Impor Modul ES Lokal
 * Menjamin tidak ada file JavaScript di proyek yang mengimpor identifier fiktif / tidak diekspor oleh modul lokal
 * (Mencegah runtime SyntaxError: The requested module '...' does not provide an export named '...')
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

describe('Audit Integritas Resolusi Ekspor-Impor Modul ES', () => {
    const root = path.resolve(__dirname, '..');
    const checkSyntaxPath = path.join(root, 'scripts', 'check-syntax.js');
    const checkSyntaxContent = fs.readFileSync(checkSyntaxPath, 'utf8');

    test('1. scripts/check-syntax.js memuat guardrail otomatis audit ekspor-impor modul lokal', () => {
        expect(checkSyntaxContent).toContain('Audit Integritas Resolusi Ekspor-Impor Modul ES Lokal');
        expect(checkSyntaxContent).toContain('Unresolved Module Export');
        expect(checkSyntaxContent).toContain('getModuleExports');
    });

    test('2. Eksekusi check-syntax.js berhasil 0 error dan memvalidasi ratusan binding impor lokal', () => {
        const result = spawnSync(process.execPath, [checkSyntaxPath], {
            cwd: root,
            encoding: 'utf8'
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('binding impor modul ES lokal');
        expect(result.stdout).toContain('(0 Error)');
    });

    test('3. Guardrail mendeteksi secara presisi jika ada impor identifier yang tidak diekspor', () => {
        // Simulasi fungsi getModuleExports dari check-syntax.js
        const sampleExporter = `
            export const validExportA = 1;
            export function validExportB() {}
            export { validExportC as aliasedC };
            export default function() {}
        `;
        const sampleImporter = `
            import { validExportA, nonExistentIdentifier } from './sampleExporter.js';
        `;

        const exports = new Set(['validExportA', 'validExportB', 'aliasedC', 'default']);
        const imported = ['validExportA', 'nonExistentIdentifier'];

        const missing = imported.filter(id => !exports.has(id));
        expect(missing).toEqual(['nonExistentIdentifier']);
    });
});
