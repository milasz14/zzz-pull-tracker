const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app.js'), 'utf8');

function createAppContext() {
    const values = new Map();
    const labels = {
        tapes: 'Tapes',
        residual: 'Residual Signals',
        polychrome: 'Polychromes',
        monochrome: 'Monochromes'
    };
    const fields = Object.fromEntries(
        ['tapes', 'residual', 'polychrome', 'monochrome'].map(key => [
            `.${key === 'tapes' ? 'tape' : key}Input`,
            {
                value: '',
                validity: { valid: true },
                labels: [{ textContent: labels[key] }],
                focus() {}
            }
        ])
    );
    const document = {
        querySelector(selector) {
            return fields[selector] || null;
        }
    };
    const context = vm.createContext({
        document,
        window: { addEventListener() {} },
        localStorage: {
            getItem(key) {
                return values.get(key) ?? null;
            },
            setItem(key, value) {
                values.set(key, value);
            }
        }
    });

    vm.runInContext(appSource, context);
    return context;
}

function evaluate(context, expression) {
    return vm.runInContext(expression, context);
}

function toPlainObject(value) {
    return JSON.parse(JSON.stringify(value));
}

test('calculateTotalPulls converts resources to pull counts', () => {
    const context = createAppContext();
    const totals = toPlainObject(evaluate(context, `calculateTotalPulls({
        tapes: 5, residual: 40, polychrome: 320, monochrome: 160
    })`));

    assert.deepEqual(totals, {
        tapes: 5,
        residual: 40,
        polychrome: 320,
        monochrome: 160,
        tapePulls: 5,
        residualPulls: 2,
        polychromePulls: 2,
        monochromePulls: 1,
        totalPulls: 10
    });
});

test('history is sorted before saving and loading, and latest entry is chronological', () => {
    const context = createAppContext();
    evaluate(context, `saveHistory([
        { date: '2025-02-02', tapes: 2 },
        { date: '2025-01-01', tapes: 1 }
    ])`);

    assert.deepEqual(toPlainObject(evaluate(context, 'loadHistory()')), [
        { date: '2025-01-01', tapes: 1 },
        { date: '2025-02-02', tapes: 2 }
    ]);
    assert.equal(evaluate(context, 'getLatestEntry(loadHistory()).date'), '2025-02-02');
    assert.equal(evaluate(context, 'getLatestEntry([])'), null);
});

test('readFormValues falls back to the latest entry for empty fields', () => {
    const context = createAppContext();
    const values = toPlainObject(evaluate(context, `readFormValues([{
        date: '2025-01-01', tapes: 5, residual: 20, polychrome: 160, monochrome: 0
    }])`));

    assert.deepEqual(values, { tapes: 5, residual: 20, polychrome: 160, monochrome: 0 });
});

test('validateInput rejects negative and fractional values', () => {
    const context = createAppContext();
    const errors = evaluate(context, `(() => {
        const messages = [];
        for (const value of ['-1', '1.5']) {
            fields.tapes.value = value;
            try {
                validateInput(readFormValues([], false));
            } catch (error) {
                messages.push(error.message);
            }
        }
        return messages;
    })()`);

    assert.deepEqual(toPlainObject(errors), [
        'Tapes muss eine nicht-negative ganze Zahl sein.',
        'Tapes muss eine nicht-negative ganze Zahl sein.'
    ]);
});

test('loadHistory reports malformed JSON and a non-array value', () => {
    const context = createAppContext();
    const errors = evaluate(context, `(() => {
        const messages = [];
        for (const value of ['{', '{}']) {
            localStorage.setItem('zzz_pull_history', value);
            try {
                loadHistory();
            } catch (error) {
                messages.push(error.message);
            }
        }
        return messages;
    })()`);

    assert.deepEqual(toPlainObject(errors), [
        'Die gespeicherte Historie ist beschädigt und konnte nicht gelesen werden.',
        'Die gespeicherte Historie hat ein ungültiges Format.'
    ]);
});

test('validateImportedHistory sorts entries and recalculates derived pull totals', () => {
    const context = createAppContext();
    const imported = toPlainObject(evaluate(context, `validateImportedHistory([
        { date: '2025-02-02', tapes: 3, residual: 20, polychrome: 160, monochrome: 0, totalPulls: 999 },
        { date: '2025-01-01', tapes: 0, residual: 0, polychrome: 0, monochrome: 160 }
    ])`));

    assert.deepEqual(imported.map(entry => entry.date), ['2025-01-01', '2025-02-02']);
    assert.equal(imported[0].totalPulls, 1);
    assert.equal(imported[1].totalPulls, 5);
});

test('validateImportedHistory rejects invalid backup shapes, dates, duplicates, and values', () => {
    const context = createAppContext();
    const cases = [
        { input: '{}', message: 'Die Datei muss ein JSON-Array mit Einträgen enthalten.' },
        {
            input: `[{ date: '2025-02-30', tapes: 0, residual: 0, polychrome: 0, monochrome: 0 }]`,
            message: 'Eintrag 1 hat kein gültiges Datum im Format YYYY-MM-DD.'
        },
        {
            input: `[
                { date: '2025-02-01', tapes: 0, residual: 0, polychrome: 0, monochrome: 0 },
                { date: '2025-02-01', tapes: 0, residual: 0, polychrome: 0, monochrome: 0 }
            ]`,
            message: 'Das Backup enthält mehrere Einträge für den 2025-02-01.'
        },
        {
            input: `[{ date: '2025-02-01', tapes: -1, residual: 0, polychrome: 0, monochrome: 0 }]`,
            message: 'Eintrag 1 enthält einen ungültigen Wert für tapes.'
        },
        {
            input: `[{ date: '2025-02-01', tapes: 0.5, residual: 0, polychrome: 0, monochrome: 0 }]`,
            message: 'Eintrag 1 enthält einen ungültigen Wert für tapes.'
        }
    ];

    for (const { input, message } of cases) {
        const actualMessage = evaluate(context, `(() => {
            try {
                validateImportedHistory(${input});
            } catch (error) {
                return error.message;
            }
            return null;
        })()`);
        assert.equal(actualMessage, message);
    }
});
