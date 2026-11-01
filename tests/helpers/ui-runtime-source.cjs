const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');

const root = path.resolve(__dirname, '../..');

// Execute the production component, including its real HTML and selectors.
// Authentication/network bootstrapping elsewhere in global.js is unrelated.
function loadGlobalModals() {
    const source = fs.readFileSync(path.join(root, 'js/global.js'), 'utf8');
    const start = source.indexOf('// --- GLOBAL CONFIRM MODAL');
    const end = source.indexOf('export const showConfirmModal', start);
    if (start < 0 || end < 0) throw new Error('Global modal component not found');
    new Function('document', 'window', source.slice(start, end))(document, window);
}

function extractFunctions(relativePath, names) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    return names.map(name => {
        const node = ast.body.map(item => item.declaration || item)
            .find(item => item.type === 'FunctionDeclaration' && item.id.name === name);
        if (!node) throw new Error(`Production function ${name} not found in ${relativePath}`);
        return source.slice(node.start, node.end);
    }).join('\n');
}

function loadWorkloadCalculations() {
    const source = fs.readFileSync(path.join(root, 'js/workload-calc.js'), 'utf8');
    const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    const executable = ast.body.map(node => {
        const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
        return declaration ? source.slice(declaration.start, declaration.end) : '';
    }).join('\n');
    return new Function(`${executable}\nreturn { validateWeeklyPlanCompleteness, checkHasPkActivity, detectTeacherStudyDay, isStudyDayCompliantActivity, validateTeacherStudyDayPlan, WORKLOAD_DAY_NAMES };`)();
}

module.exports = { loadGlobalModals, extractFunctions, loadWorkloadCalculations };
