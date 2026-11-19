const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

function createFakeFirestore(initialDocs = {}) {
    const docs = new Map(Object.entries(initialDocs));
    const commits = [];

    function getUserPullsCollection(uid) {
        return {
            async get() {
                const prefix = `${uid}/`;
                const items = [];
                for (const [key, data] of docs.entries()) {
                    if (key.startsWith(prefix)) {
                        const id = key.slice(prefix.length);
                        items.push({
                            id,
                            data: () => structuredClone(data),
                            ref: { path: key }
                        });
                    }
                }
                return {
                    empty: items.length === 0,
                    size: items.length,
                    forEach(cb) {
                        items.forEach(cb);
                    }
                };
            },
            doc(docId) {
                const fullPath = `${uid}/${docId}`;
                return {
                    path: fullPath,
                    async set(data) {
                        docs.set(fullPath, structuredClone(data));
                    },
                    async delete() {
                        docs.delete(fullPath);
                    }
                };
            }
        };
    }

    const db = {
        collection(colName) {
            assert.equal(colName, 'users');
            return {
                doc(uid) {
                    return {
                        collection(subColName) {
                            assert.equal(subColName, 'pulls');
                            return getUserPullsCollection(uid);
                        }
                    };
                }
            };
        },
        batch() {
            const ops = [];
            return {
                set(ref, data) {
                    ops.push({ type: 'set', path: ref.path, data: structuredClone(data) });
                },
                delete(ref) {
                    ops.push({ type: 'delete', path: ref.path });
                },
                async commit() {
                    commits.push([...ops]);
                    for (const op of ops) {
                        if (op.type === 'set') {
                            docs.set(op.path, op.data);
                        } else if (op.type === 'delete') {
                            docs.delete(op.path);
                        }
                    }
                }
            };
        }
    };

    return { db, docs, commits };
}

function createFakeAuth(initialUser = { uid: 'test-user-1' }) {
    let currentUser = initialUser;
    const listeners = new Set();

    function notify() {
        for (const listener of listeners) {
            listener(currentUser);
        }
    }

    return {
        get currentUser() {
            return currentUser;
        },
        onAuthStateChanged(listener) {
            listeners.add(listener);
            queueMicrotask(() => listener(currentUser));
            return () => listeners.delete(listener);
        },
        async signInWithEmailAndPassword() {
            currentUser = { uid: 'test-user-1' };
            notify();
            return { user: currentUser };
        },
        _setUser(user) {
            currentUser = user;
            notify();
        }
    };
}

function createAppContext({ initialDocs = {}, initialUser = { uid: 'test-user-1' } } = {}) {
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

    const elements = {
        ...fields,
        '#loginSection': { style: { display: '' } },
        '#appShell': { style: { display: '' } },
        '#statPolychromes': { textContent: '' },
        '#statMonochromes': { textContent: '' },
        '#statTapes': { textContent: '' },
        '#statAverage': { textContent: '' },
        '.status-message': {
            textContent: '',
            classList: { toggle() {} }
        }
    };

    const firestoreState = createFakeFirestore(initialDocs);
    const authState = createFakeAuth(initialUser);

    const firebaseMock = {
        initializeApp() {},
        firestore() {
            return firestoreState.db;
        },
        auth() {
            return authState;
        }
    };

    const context = vm.createContext({
        document: {
            querySelector(selector) {
                return elements[selector] || null;
            },
            querySelectorAll() {
                return [];
            },
            addEventListener() {}
        },
        window: {
            addEventListener() {},
            confirm() {
                return true;
            }
        },
        firebase: firebaseMock,
        console,
        Date,
        Number,
        Set,
        Map,
        Array,
        Object,
        String,
        Promise,
        Error,
        queueMicrotask
    });

    vm.runInContext(appSource, context);
    return { context, firestoreState, authState, elements };
}

function runInContext(context, code) {
    return vm.runInContext(code, context);
}

function toPlainObject(value) {
    return JSON.parse(JSON.stringify(value));
}

test('calculateTotalPulls converts resources to pull counts', () => {
    const { context } = createAppContext();
    const totals = toPlainObject(runInContext(context, `calculateTotalPulls({
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

test('sortHistory sorts chronologically and getLatestEntry returns newest or null', () => {
    const { context } = createAppContext();
    const sorted = toPlainObject(runInContext(context, `sortHistory([
        { date: '2025-02-02', tapes: 2 },
        { date: '2025-01-01', tapes: 1 }
    ])`));

    assert.deepEqual(sorted, [
        { date: '2025-01-01', tapes: 1 },
        { date: '2025-02-02', tapes: 2 }
    ]);
    assert.equal(runInContext(context, `getLatestEntry(sortHistory([
        { date: '2025-02-02', tapes: 2 },
        { date: '2025-01-01', tapes: 1 }
    ])).date`), '2025-02-02');
    assert.equal(runInContext(context, 'getLatestEntry([])'), null);
});

test('readFormValues falls back to the latest entry for empty fields', () => {
    const { context } = createAppContext();
    const values = toPlainObject(runInContext(context, `readFormValues([{
        date: '2025-01-01', tapes: 5, residual: 20, polychrome: 160, monochrome: 0
    }])`));

    assert.deepEqual(values, { tapes: 5, residual: 20, polychrome: 160, monochrome: 0 });
});

test('validateInput rejects negative and fractional values', () => {
    const { context } = createAppContext();
    const messages = toPlainObject(runInContext(context, `(() => {
        const result = [];
        for (const value of ['-1', '1.5']) {
            fields.tapes.value = value;
            try {
                validateInput(readFormValues([], false));
            } catch (error) {
                result.push(error.message);
            }
        }
        return result;
    })()`));

    assert.deepEqual(messages, [
        'Tapes muss eine nicht-negative ganze Zahl sein.',
        'Tapes muss eine nicht-negative ganze Zahl sein.'
    ]);
});

test('validateImportedHistory sorts entries and recalculates derived pull totals', () => {
    const { context } = createAppContext();
    const imported = toPlainObject(runInContext(context, `validateImportedHistory([
        { date: '2025-02-02', tapes: 3, residual: 20, polychrome: 160, monochrome: 0, totalPulls: 999 },
        { date: '2025-01-01', tapes: 0, residual: 0, polychrome: 0, monochrome: 160 }
    ])`));

    assert.deepEqual(imported.map(entry => entry.date), ['2025-01-01', '2025-02-02']);
    assert.equal(imported[0].totalPulls, 1);
    assert.equal(imported[1].totalPulls, 5);
});

test('validateImportedHistory rejects non-array input', () => {
    const { context } = createAppContext();
    assert.throws(
        () => runInContext(context, 'validateImportedHistory({})'),
        /Die Datei muss ein JSON-Array mit Einträgen enthalten\./
    );
});

test('validateImportedHistory rejects invalid calendar dates', () => {
    const { context } = createAppContext();
    assert.throws(
        () => runInContext(context, `validateImportedHistory([
            { date: '2025-02-30', tapes: 0, residual: 0, polychrome: 0, monochrome: 0 }
        ])`),
        /Eintrag 1 hat kein gültiges Datum im Format YYYY-MM-DD\./
    );
});

test('validateImportedHistory rejects duplicate dates', () => {
    const { context } = createAppContext();
    assert.throws(
        () => runInContext(context, `validateImportedHistory([
            { date: '2025-02-01', tapes: 0, residual: 0, polychrome: 0, monochrome: 0 },
            { date: '2025-02-01', tapes: 1, residual: 0, polychrome: 0, monochrome: 0 }
        ])`),
        /Das Backup enthält mehrere Einträge für den 2025-02-01\./
    );
});

test('validateImportedHistory rejects negative or fractional values', () => {
    const { context } = createAppContext();
    assert.throws(
        () => runInContext(context, `validateImportedHistory([
            { date: '2025-02-01', tapes: -1, residual: 0, polychrome: 0, monochrome: 0 }
        ])`),
        /Eintrag 1 enthält einen ungültigen Wert für tapes\./
    );
    assert.throws(
        () => runInContext(context, `validateImportedHistory([
            { date: '2025-02-01', tapes: 0.5, residual: 0, polychrome: 0, monochrome: 0 }
        ])`),
        /Eintrag 1 enthält einen ungültigen Wert für tapes\./
    );
});

test('filterHistoryByRange filters entries according to selected range', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-19T12:00:00Z') });
    const { context } = createAppContext();

    const filtered = toPlainObject(runInContext(context, `filterHistoryByRange([
        { date: '2026-10-01', totalPulls: 10 },
        { date: '2026-11-15', totalPulls: 20 },
        { date: '2026-11-19', totalPulls: 30 }
    ], '1W')`));

    assert.deepEqual(filtered.map(entry => entry.date), ['2026-11-15', '2026-11-19']);
});

test('updateStats computes totals and average safely on empty and non-empty histories', () => {
    const { context, elements } = createAppContext();

    runInContext(context, 'updateStats([])');
    assert.equal(elements['#statPolychromes'].textContent, '0');
    assert.equal(elements['#statAverage'].textContent, '0');

    runInContext(context, `updateStats([
        { polychrome: 160, monochrome: 320, tapes: 2, totalPulls: 5 },
        { polychrome: 320, monochrome: 160, tapes: 4, totalPulls: 7 }
    ])`);
    assert.equal(elements['#statPolychromes'].textContent, '480');
    assert.equal(elements['#statMonochromes'].textContent, '480');
    assert.equal(elements['#statTapes'].textContent, '6');
    assert.equal(elements['#statAverage'].textContent, '6');
});

test('saveHistory and loadHistory persist entries per user in Firestore', async () => {
    const { context, firestoreState } = createAppContext({ initialUser: { uid: 'user-abc' } });

    await runInContext(context, `saveHistory([
        { date: '2026-11-18', tapes: 3, totalPulls: 3 },
        { date: '2026-11-17', tapes: 1, totalPulls: 1 }
    ])`);

    assert.equal(firestoreState.docs.has('user-abc/2026-11-17'), true);
    assert.equal(firestoreState.docs.has('user-abc/2026-11-18'), true);

    const loaded = toPlainObject(await runInContext(context, 'loadHistory()'));
    assert.deepEqual(loaded.map(entry => entry.date), ['2026-11-17', '2026-11-18']);
});

test('clearHistory removes existing Firestore pull documents for current user', async () => {
    const { context, firestoreState } = createAppContext({
        initialUser: { uid: 'user-abc' },
        initialDocs: {
            'user-abc/2026-11-17': { date: '2026-11-17', tapes: 1 },
            'user-abc/2026-11-18': { date: '2026-11-18', tapes: 2 },
            'other-user/2026-11-18': { date: '2026-11-18', tapes: 9 }
        }
    });

    await runInContext(context, 'clearHistory()');

    assert.equal(firestoreState.docs.has('user-abc/2026-11-17'), false);
    assert.equal(firestoreState.docs.has('user-abc/2026-11-18'), false);
    assert.equal(firestoreState.docs.has('other-user/2026-11-18'), true);
});

test('handleSaveEntry overwrites existing entry for today instead of duplicating it', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-19T12:00:00Z') });

    const { context, firestoreState, elements } = createAppContext({
        initialUser: { uid: 'user-abc' },
        initialDocs: {
            'user-abc/2026-11-19': {
                date: '2026-11-19',
                tapes: 1,
                residual: 0,
                polychrome: 0,
                monochrome: 0,
                tapePulls: 1,
                residualPulls: 0,
                polychromePulls: 0,
                monochromePulls: 0,
                totalPulls: 1
            }
        }
    });

    elements['.tapeInput'].value = '4';
    elements['.residualInput'].value = '0';
    elements['.polychromeInput'].value = '0';
    elements['.monochromeInput'].value = '0';

    await runInContext(context, 'handleSaveEntry({ preventDefault() {} })');

    const savedToday = firestoreState.docs.get('user-abc/2026-11-19');
    assert.equal(savedToday.tapes, 4);
    assert.equal(savedToday.totalPulls, 4);
    assert.equal(firestoreState.docs.size, 1);
});
