const STORAGE_KEY = 'zzz_pull_history';

// Firebase-Konfiguration (aus der Firebase Console kopiert)
const firebaseConfig = {
    apiKey: "AIzaSyAkieB078lnnL5EeGpgcqzj1mD70vOyr8w",
    authDomain: "zzz-pull-tracker.firebaseapp.com",
    projectId: "zzz-pull-tracker",
    storageBucket: "zzz-pull-tracker.firebasestorage.app",
    messagingSenderId: "124470911475",
    appId: "1:124470911475:web:1d63f15731ca36de103286"
};

// Firebase initialisieren
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

const SOURCE_COLORS = ['#f3d54e', '#f28a55', '#69a8ff', '#f16c9a'];
const fields = {
    tapes: document.querySelector('.tapeInput'),
    residual: document.querySelector('.residualInput'),
    polychrome: document.querySelector('.polychromeInput'),
    monochrome: document.querySelector('.monochromeInput')
};

let pullChart = null;
let sourceChart = null;
let currentRange = 'MAX';
let currentUserUid = null;

// Automatisch beim Start einloggen (mit den Daten aus der Firebase Console)
// Alternativ kannst du hier deine E-Mail und dein Passwort eintragen:
function ensureAuth() {
    return new Promise((resolve, reject) => {
        auth.onAuthStateChanged(user => {
            if (user) {
                currentUserUid = user.uid;
                resolve(user);
            } else {
                // automatisch einloggen, wenn kein Benutzer angemeldet ist
                auth.signInWithEmailAndPassword("yumilasz14@gmail.com", "Fi01Mi14")
                    .then(userCredential => {
                        currentUserUid = userCredential.user.uid;
                        resolve(userCredential.user);
                    })
                    .catch(error => {
                        reject(new Error("Firebase Login fehlgeschlagen: " + error.message));
                    });
            }
        });
    });
}

// Daten aus Firestore laden
async function loadHistory() {
    await ensureAuth();
    const snapshot = await db.collection('users').doc(currentUserUid).collection('pulls').get();
    const history = [];
    snapshot.forEach(doc => {
        history.push(doc.data());
    });
    return sortHistory(history);
}

// Daten in Firestore speichern (jeder Tag ist ein Dokument mit der Datum als ID)
async function saveHistory(history) {
    await ensureAuth();
    const batch = db.batch();
    const userPullsRef = db.collection('users').doc(currentUserUid).collection('pulls');

    // Alle Einträge durchgehen und speichern
    for (const entry of history) {
        const docRef = userPullsRef.doc(entry.date);
        batch.set(docRef, entry);
    }

    await batch.commit();
}


function sortHistory(history) {
    return [...history].sort((a, b) => a.date.localeCompare(b.date));
}

/*
function loadHistory() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    let history;
    try {
        history = JSON.parse(stored);
    } catch (error) {
        throw new Error('Die gespeicherte Historie ist beschädigt und konnte nicht gelesen werden.');
    }

    if (!Array.isArray(history)) {
        throw new Error('Die gespeicherte Historie hat ein ungültiges Format.');
    }
    return sortHistory(history);
}

function saveHistory(history) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sortHistory(history)));
}
*/

function getLatestEntry(history) {
    return sortHistory(history).at(-1) || null;
}


function getDate() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatNumber(value, maximumFractionDigits = 2) {
    return Number(value).toLocaleString('de-DE', { maximumFractionDigits });
}

function parseDate(value) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function formatDate(value, options = { day: 'numeric', month: 'long', year: 'numeric' }) {
    return parseDate(value).toLocaleDateString('de-DE', options);
}

function calculateTotalPulls(inputs) {
    const tapePulls = inputs.tapes;
    const residualPulls = inputs.residual / 20;
    const polychromePulls = inputs.polychrome / 160;
    const monochromePulls = inputs.monochrome / 160;

    return {
        ...inputs,
        tapePulls,
        residualPulls,
        polychromePulls,
        monochromePulls,
        totalPulls: tapePulls + residualPulls + polychromePulls + monochromePulls
    };
}

function getEntryInputs(entry) {
    return {
        tapes: entry.tapes,
        residual: entry.residual,
        polychrome: entry.polychrome,
        monochrome: entry.monochrome
    };
}

function readFormValues(history, useFallback = true) {
    const latestValues = getLatestEntry(history);
    const values = {};

    for (const [key, field] of Object.entries(fields)) {
        if (field.value.trim() === '') {
            values[key] = useFallback && latestValues ? latestValues[key] : 0;
            continue;
        }
        values[key] = Number(field.value);
    }

    return values;
}

function validateInput(values) {
    for (const [key, field] of Object.entries(fields)) {
        if (field.value.trim() !== '' && !field.validity.valid) {
            field.focus();
            throw new Error(`${field.labels[0].textContent.trim()} muss eine nicht-negative ganze Zahl sein.`);
        }
        if (!Number.isInteger(values[key]) || values[key] < 0) {
            field.focus();
            throw new Error(`${field.labels[0].textContent.trim()} muss eine nicht-negative ganze Zahl sein.`);
        }
    }
}

function updatePreview(history) {
    const values = readFormValues(history);
    const totals = calculateTotalPulls(values);
    document.querySelector('#previewTapes').textContent = formatNumber(totals.tapePulls);
    document.querySelector('#previewResidual').textContent = formatNumber(totals.residualPulls);
    document.querySelector('#previewPoly').textContent = formatNumber(totals.polychromePulls);
    document.querySelector('#previewMono').textContent = formatNumber(totals.monochromePulls);
    document.querySelector('#previewTotal').textContent = formatNumber(totals.totalPulls);
}

function updateStats(history) {
    const totals = history.reduce((sum, entry) => ({
        polychrome: sum.polychrome + entry.polychrome,
        monochrome: sum.monochrome + entry.monochrome,
        tapes: sum.tapes + entry.tapes,
        pulls: sum.pulls + entry.totalPulls
    }), { polychrome: 0, monochrome: 0, tapes: 0, pulls: 0 });

    document.querySelector('#statPolychromes').textContent = formatNumber(totals.polychrome, 0);
    document.querySelector('#statMonochromes').textContent = formatNumber(totals.monochrome, 0);
    document.querySelector('#statTapes').textContent = formatNumber(totals.tapes, 0);
    document.querySelector('#statAverage').textContent = formatNumber(
        history.length ? totals.pulls / history.length : 0
    );
}

function getRangeStart(range) {
    if (range === 'MAX') return null;

    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    switch (range) {
        case '1T':
            cutoff.setDate(cutoff.getDate() - 1);
            break;
        case '1W':
            cutoff.setDate(cutoff.getDate() - 7);
            break;
        case '1M':
            cutoff.setMonth(cutoff.getMonth() - 1);
            break;
        case '3M':
            cutoff.setMonth(cutoff.getMonth() - 3);
            break;
        case '6M':
            cutoff.setMonth(cutoff.getMonth() - 6);
            break;
        case '1Y':
            cutoff.setFullYear(cutoff.getFullYear() - 1);
            break;
        case 'YTD':
            return `${cutoff.getFullYear()}-01-01`;
        default:
            return null;
    }
    return `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
}

function filterHistoryByRange(history, range) {
    const startDate = getRangeStart(range);
    if (!startDate) return history;
    return history.filter(entry => entry.date >= startDate);
}

function renderLineChart(history) {
    const canvas = document.querySelector('#pullChart');
    const emptyMessage = document.querySelector('.empty-chart');
    const filteredHistory = filterHistoryByRange(history, currentRange);

    if (pullChart) {
        pullChart.destroy();
        pullChart = null;
    }

    if (filteredHistory.length === 0) {
        canvas.hidden = true;
        emptyMessage.classList.add('visible');
        return;
    }

    canvas.hidden = false;
    emptyMessage.classList.remove('visible');
    pullChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: filteredHistory.map(entry => entry.date),
            datasets: [
                {
                    label: 'Pulls gesamt / Tag',
                    data: filteredHistory.map(entry => entry.totalPulls),
                    borderColor: '#45e4d0',
                    backgroundColor: 'rgba(69, 228, 208, 0.12)',
                    pointBackgroundColor: '#45e4d0',
                    pointBorderColor: '#121618',
                    pointBorderWidth: 2,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    borderWidth: 2,
                    tension: 0.28,
                    fill: true
                },
                {
                    label: 'Tapes + Polychromes / Tag',
                    data: filteredHistory.map(entry => entry.tapePulls + entry.polychromePulls),
                    borderColor: '#f3d54e',
                    backgroundColor: 'rgba(243, 213, 78, 0.08)',
                    pointBackgroundColor: '#f3d54e',
                    pointBorderColor: '#121618',
                    pointBorderWidth: 2,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    borderWidth: 2,
                    tension: 0.28,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#202629',
                    borderColor: '#3a4345',
                    borderWidth: 1,
                    titleColor: '#aeb8b8',
                    bodyColor: '#f0f3f2',
                    padding: 10,
                    callbacks: {
                        title: items => formatDate(items[0].label),
                        label: item => `${item.dataset.label}: ${formatNumber(item.parsed.y)}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: {
                        color: '#879294',
                        maxTicksLimit: 7,
                        maxRotation: 0,
                        callback(value) {
                            return formatDate(this.getLabelForValue(value), { month: 'short', day: 'numeric' });
                        }
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.07)' },
                    border: { display: false },
                    ticks: {
                        color: '#879294',
                        maxTicksLimit: 5,
                        callback: value => formatNumber(value)
                    }
                }
            }
        }
    });
}

function renderSourceChart(history) {
    const canvas = document.querySelector('#sourceChart');
    const emptyMessage = document.querySelector('.empty-source');
    const latest = getLatestEntry(history);

    if (sourceChart) {
        sourceChart.destroy();
        sourceChart = null;
    }

    if (!latest) {
        canvas.hidden = true;
        document.querySelector('.source-center').hidden = true;
        document.querySelector('#sourceTotal').textContent = '0';
        document.querySelector('#sourceCaption').textContent = 'Letzter gespeicherter Eintrag';
        emptyMessage.classList.add('visible');
        return;
    }

    const pulls = [
        latest.tapePulls,
        latest.residualPulls,
        latest.polychromePulls,
        latest.monochromePulls
    ];
    const total = pulls.reduce((sum, value) => sum + value, 0);
    canvas.hidden = false;
    document.querySelector('.source-center').hidden = false;
    document.querySelector('#sourceTotal').textContent = formatNumber(total);
    document.querySelector('#sourceCaption').textContent = `Letzter Eintrag · ${formatDate(latest.date)}`;
    emptyMessage.classList.remove('visible');

    sourceChart = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: ['Tapes', 'Residual Signals', 'Polychromes', 'Monochromes'],
            datasets: [{
                data: pulls,
                backgroundColor: SOURCE_COLORS,
                borderColor: '#191d20',
                borderWidth: 3,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '72%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#202629',
                    borderColor: '#3a4345',
                    borderWidth: 1,
                    padding: 9,
                    callbacks: {
                        label: item => {
                            const percentage = total ? (item.parsed / total) * 100 : 0;
                            return `${item.label}: ${formatNumber(item.parsed)} (${formatNumber(percentage, 1)}%)`;
                        }
                    }
                }
            }
        }
    });
}

function updateDashboard(history) {
    const sortedHistory = sortHistory(history);
    updateStats(sortedHistory);
    updatePreview(sortedHistory);
    renderLineChart(sortedHistory);
    renderSourceChart(sortedHistory);
}

function showStatus(message, isError = false) {
    const status = document.querySelector('.status-message');
    status.textContent = message;
    status.classList.toggle('error', isError);
}

async function handleSaveEntry(event) {
    event.preventDefault();
    try {
        const history = await loadHistory();
        const values = readFormValues(history);
        validateInput(values);

        const todayEntry = {
            date: getDate(),
            ...calculateTotalPulls(values)
        };
        const updatedHistory = history.filter(entry => entry.date !== todayEntry.date);
        updatedHistory.push(todayEntry);
        await saveHistory(updatedHistory);
        updateDashboard(sortHistory(updatedHistory));
        showStatus('Eintrag für heute wurde gespeichert.');
    } catch (error) {
        showStatus(error.message, true);
    }
}

function isValidDateString(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = parseDate(value);
    return date.getFullYear() === Number(value.slice(0, 4))
        && date.getMonth() + 1 === Number(value.slice(5, 7))
        && date.getDate() === Number(value.slice(8, 10));
}

function validateImportedHistory(data) {
    if (!Array.isArray(data)) {
        throw new Error('Die Datei muss ein JSON-Array mit Einträgen enthalten.');
    }

    const dates = new Set();
    return sortHistory(data.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || !isValidDateString(entry.date)) {
            throw new Error(`Eintrag ${index + 1} hat kein gültiges Datum im Format YYYY-MM-DD.`);
        }
        if (dates.has(entry.date)) {
            throw new Error(`Das Backup enthält mehrere Einträge für den ${entry.date}.`);
        }
        dates.add(entry.date);

        const rawInputs = {
            tapes: entry.tapes,
            residual: entry.residual,
            polychrome: entry.polychrome,
            monochrome: entry.monochrome
        };
        for (const [key, value] of Object.entries(rawInputs)) {
            if (!Number.isInteger(value) || value < 0) {
                throw new Error(`Eintrag ${index + 1} enthält einen ungültigen Wert für ${key}.`);
            }
        }
        return { date: entry.date, ...calculateTotalPulls(rawInputs) };
    }));
}

function exportHistoryToFile() {
    try {
        const history = loadHistory();
        if (history.length === 0) {
            showStatus('Es gibt noch keine Daten zum Exportieren.', true);
            return;
        }

        const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `zzz_pull_history_${getDate()}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        showStatus('Backup wurde heruntergeladen.');
    } catch (error) {
        showStatus(error.message, true);
    }
}

function importHistoryFromFile(event) {
    const input = event.currentTarget;
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        try {
            const importedHistory = validateImportedHistory(JSON.parse(reader.result));
            const currentHistory = loadHistory();
            if (currentHistory.length && !window.confirm('Das Backup ersetzt deine aktuelle Historie. Fortfahren?')) {
                showStatus('Import abgebrochen; deine aktuelle Historie bleibt unverändert.');
                return;
            }
            saveHistory(importedHistory);
            updateDashboard(importedHistory);
            syncTodayInputs(importedHistory);
            showStatus(`${importedHistory.length} Einträge erfolgreich importiert.`);
        } catch (error) {
            showStatus(error.message || 'Die Backup-Datei konnte nicht gelesen werden.', true);
        } finally {
            input.value = '';
        }
    };
    reader.onerror = () => {
        showStatus('Die Backup-Datei konnte nicht gelesen werden.', true);
        input.value = '';
    };
    reader.readAsText(file);
}

function syncTodayInputs(history) {
    const todayEntry = history.find(entry => entry.date === getDate());
    for (const [key, field] of Object.entries(fields)) {
        field.value = todayEntry ? todayEntry[key] : '';
    }
    updatePreview(history);
}

async function initApp() {
    document.querySelector('#todayLabel').textContent = formatDate(getDate());

    try {
        const history = await loadHistory();
        syncTodayInputs(history);
        updateDashboard(history);
    } catch (error) {
        showStatus(error.message, true);
        updateDashboard([]);
    }

    document.querySelector('.pullForm').addEventListener('submit', handleSaveEntry);
    Object.values(fields).forEach(field => {
        field.addEventListener('input', () => {
            try {
                // Da loadHistory asynchron ist, holen wir den lokalen Stand für die Live-Vorschau
                loadHistory().then(history => updatePreview(history)).catch(() => {});
            } catch (error) {
                showStatus(error.message, true);
            }
        });
    });

    document.querySelector('#exportBtn').addEventListener('click', exportHistoryToFile);
    document.querySelector('#importBtn').addEventListener('click', () => {
        document.querySelector('#importFile').click();
    });
    document.querySelector('#importFile').addEventListener('change', importHistoryFromFile);
    document.querySelectorAll('.time-btn').forEach(button => {
        button.addEventListener('click', async () => {
            document.querySelectorAll('.time-btn').forEach(item => item.classList.remove('active'));
            button.classList.add('active');
            currentRange = button.dataset.range;
            const history = await loadHistory();
            renderLineChart(history);
        });
    });
}

window.addEventListener('DOMContentLoaded', initApp);
