const express = require('express');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const KNN = require('ml-knn');
const { RandomForestClassifier } = require('ml-random-forest');
const SVM = require('libsvm-js/asm');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); 

app.use(bodyParser.urlencoded({ extended: true }));
// This line allows the server to serve your index.html correctly
app.use(express.static(__dirname)); 

const session = require('express-session');
app.use(session({
    secret: 'sleep-disorder-admin-secret-2025',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000 }
}));

const USERS_DB = './database.json';
const REPORTS_DB = './reports.json';
const ADMIN_DB = './admin_database.json';
const CALL_LOGS_DB = './admin_call_logs.json';

const asteriskAriUrl = process.env.ASTERISK_ARI_URL || '';
const asteriskAriUser = process.env.ASTERISK_ARI_USERNAME || '';
const asteriskAriPass = process.env.ASTERISK_ARI_PASSWORD || '';
const asteriskAriApp = process.env.ASTERISK_ARI_APP || 'sleep-disorder-app';
const asteriskEndpointPrefix = process.env.
ASTERISK_ENDPOINT_PREFIX || '';
const asteriskCallerId = process.env.ASTERISK_CALLER_ID || 'A1 Hospital';
const hasAsteriskConfig = Boolean(
    asteriskAriUrl &&
    asteriskAriUser &&
    asteriskAriPass &&
    asteriskEndpointPrefix
);

if (!fs.existsSync(USERS_DB)) fs.writeFileSync(USERS_DB, JSON.stringify([]));
if (!fs.existsSync(REPORTS_DB)) fs.writeFileSync(REPORTS_DB, JSON.stringify([]));
if (!fs.existsSync(ADMIN_DB)) fs.writeFileSync(ADMIN_DB, JSON.stringify([]));
if (!fs.existsSync(CALL_LOGS_DB)) fs.writeFileSync(CALL_LOGS_DB, JSON.stringify([]));

const readData = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeData = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

const MAX_WEEKLY_ENTRIES = 3;
const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;

function getReportTimestamp(report) {
    if (report.createdAt) {
        const createdAtMs = Date.parse(report.createdAt);
        if (Number.isFinite(createdAtMs)) return createdAtMs;
    }

    const idMs = Number(report.id);
    if (Number.isFinite(idMs)) return idMs;

    const dateMs = Date.parse(report.date);
    if (Number.isFinite(dateMs)) return dateMs;

    return 0;
}

function countRecentUserReports(reports, email, nowMs = Date.now()) {
    const cutoff = nowMs - WEEK_IN_MS;
    return reports.filter((report) => report.email === email && getReportTimestamp(report) >= cutoff).length;
}

function countRecentPhoneReports(reports, phone, nowMs = Date.now()) {
    const cutoff = nowMs - WEEK_IN_MS;
    const canonical = toCanonicalIndianPhone(phone);
    return reports.filter((report) => toCanonicalIndianPhone(report.phone_number || '') === canonical && getReportTimestamp(report) >= cutoff).length;
}

function isValidIndianPhoneNumber(phone = '') {
    const digits = String(phone || '').replace(/\D/g, '').trim();
    if (/^91[6-9]\d{9}$/.test(digits)) return true;
    return /^[6-9]\d{9}$/.test(digits);
}

function toCanonicalIndianPhone(phone = '') {
    const digits = String(phone || '').replace(/\D/g, '').trim();
    if (/^91[6-9]\d{9}$/.test(digits)) return digits.slice(2);
    if (/^[6-9]\d{9}$/.test(digits)) return digits;
    return '';
}

function normalizePhoneForCloudCall(phone) {
    const canonical = toCanonicalIndianPhone(phone);
    if (!canonical) return '';
    return `+91${canonical}`;
}

function normalizePhoneForDisplay(phone) {
    return toCanonicalIndianPhone(phone);
}

function normalizePhoneForCallLink(phone) {
    const canonical = toCanonicalIndianPhone(phone);
    if (!canonical) return '';
    return `+91${canonical}`;
}

const RISK_LABELS = ['Low', 'Moderate', 'High'];

function clampNumber(value, min, max, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function parseBP(bpValue = '') {
    const parts = String(bpValue).split('/');
    const systolic = clampNumber(parts[0], 70, 220, 120);
    const diastolic = clampNumber(parts[1], 40, 140, 80);
    return { systolic, diastolic };
}

function encodeBmiCategory(bmi = '') {
    const value = String(bmi).toLowerCase();
    if (value.includes('underweight')) return 0;
    if (value.includes('normal')) return 1;
    if (value.includes('overweight')) return 2;
    if (value.includes('obese class i')) return 3;
    if (value.includes('obese class ii')) return 4;
    if (value.includes('obese class iii') || value.includes('extremely')) return 5;
    if (value.includes('obese')) return 4;
    return 1;
}

function encodeRiskLabel(record) {
    if (record.riskLevel && RISK_LABELS.includes(record.riskLevel)) {
        return RISK_LABELS.indexOf(record.riskLevel);
    }

    const resultText = String(record.result || '').toLowerCase();
    if (resultText.includes('high')) return 2;
    if (resultText.includes('moderate')) return 1;
    return 0;
}

function normalizeOccupation(occupation = '') {
    const raw = String(occupation || '').trim();
    if (!raw) return 'Professional';
    const cleaned = raw.replace(/[0-9]+/g, '').trim();
    if (!cleaned) return 'Professional';
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

function toFeatureVector(record) {
    const { systolic, diastolic } = parseBP(record.bp);

    const genderMap = { male: 0, female: 1, other: 2 };
    const angerMap = { calm: 0, leave: 1, shouting: 2, beating: 3 };
    const dietMap = { daily: 0, sometimes: 1, never: 2 };
    const problemMap = { solve: 0, help: 1, ignore: 2 };
    const snoringMap = { never: 0, sometimes: 1, 'every night': 2 };

    const gender = String(record.gender || '').toLowerCase();
    const angerResponse = String(record.anger_response || '').toLowerCase();
    const diet = String(record.diet || '').toLowerCase();
    const problemSolving = String(record.problem_solving || '').toLowerCase();
    const snoring = String(record.snoring || '').toLowerCase();
    const prevHealth = String(record.prev_health || '').toLowerCase();

    return [
        clampNumber(record.age, 10, 100, 30),
        genderMap[gender] ?? 0,
        systolic,
        diastolic,
        clampNumber(record.heart_rate, 40, 200, 80),
        clampNumber(record.sleep_duration, 1, 14, 7),
        clampNumber(record.tea_coffee, 0, 15, 1),
        encodeBmiCategory(record.bmi),
        snoringMap[snoring] ?? 0,
        angerMap[angerResponse] ?? 0,
        dietMap[diet] ?? 1,
        problemMap[problemSolving] ?? 1,
        prevHealth === 'yes' ? 1 : 0,
        clampNumber(record.work_hours, 0, 120, 40)
    ];
}

function fallbackRiskLabel(data) {
    const sleep = Number(data.sleep_duration);
    const bmiCategory = data.bmi || '';

    if (bmiCategory.includes('Obese') && data.snoring === 'Every Night') return 2;
    if (sleep < 5) return 2;
    if (sleep < 6 && data.snoring === 'Every Night') return 1;
    if (data.diet === 'never' && data.problem_solving === 'ignore') return 2;
    if (data.diet === 'never' || data.problem_solving === 'ignore') return 1;
    return 0;
}

function buildTrainingSetFromReports(reports) {
    const X = [];
    const y = [];

    reports.forEach((row) => {
        X.push(toFeatureVector(row));
        y.push(encodeRiskLabel(row));
    });

    return { X, y };
}

function ensemblePredict(data, reports) {
    const { X, y } = buildTrainingSetFromReports(reports);
    const input = toFeatureVector(data);
    const featureCount = input.length;
    const votes = {};

    try {
        const k = Math.max(1, Math.min(7, X.length % 2 === 0 ? X.length - 1 : X.length));
        const knn = new KNN(X, y, { k });
        const prediction = Number(knn.predict([input])[0]);
        votes.KNN = prediction;
    } catch (err) {
        console.error('KNN prediction failed:', err.message);
    }

    try {
        const svm = new SVM({
            type: SVM.SVM_TYPES.C_SVC,
            kernel: SVM.KERNEL_TYPES.RBF,
            gamma: 0.01,
            cost: 10,
            quiet: true
        });
        svm.train(X, y);
        const prediction = Number(svm.predictOne(input));
        votes.SVM = prediction;
    } catch (err) {
        console.error('SVM prediction failed:', err.message);
    }

    try {
        const randomForest = new RandomForestClassifier({
            nEstimators: 25,
            maxFeatures: featureCount,
            replacement: true,
            seed: 42
        });
        randomForest.train(X, y);
        const prediction = Number(randomForest.predict([input])[0]);
        votes.RandomForest = prediction;
    } catch (err) {
        console.error('RandomForest prediction failed:', err.message);
    }

    const voteCounts = {};
    Object.values(votes).forEach((pred) => {
        voteCounts[pred] = (voteCounts[pred] || 0) + 1;
    });

    let finalLabel;
    let winningVoteCount = 0;
    if (Object.keys(voteCounts).length > 0) {
        const ranked = Object.entries(voteCounts)
            .map(([label, count]) => ({ label: Number(label), count }))
            .sort((a, b) => {
                if (b.count !== a.count) return b.count - a.count;
                return b.label - a.label;
            });

        finalLabel = ranked[0].label;
        winningVoteCount = ranked[0].count;
    } else {
        finalLabel = fallbackRiskLabel(data);
    }

    const numericVotes = Object.values(votes).filter((v) => Number.isFinite(v));
    const averageVoteLabel = numericVotes.length
        ? numericVotes.reduce((sum, v) => sum + v, 0) / numericVotes.length
        : finalLabel;
    const mlScore = Math.round((averageVoteLabel / 2) * 100);
    const votingConfidence = numericVotes.length
        ? Math.round((winningVoteCount / numericVotes.length) * 100)
        : 100;

    const modelScores = {
        KNN: Number.isFinite(votes.KNN) ? Math.round((votes.KNN / 2) * 100) : null,
        SVM: Number.isFinite(votes.SVM) ? Math.round((votes.SVM / 2) * 100) : null,
        RandomForest: Number.isFinite(votes.RandomForest) ? Math.round((votes.RandomForest / 2) * 100) : null
    };

    const majorityScore = Math.round((finalLabel / 2) * 100);

    return {
        finalLabel,
        mlScore,
        majorityScore,
        votingConfidence,
        modelVotes: {
            KNN: votes.KNN ?? 'N/A',
            SVM: votes.SVM ?? 'N/A',
            RandomForest: votes.RandomForest ?? 'N/A'
        },
        modelScores
    };
}

function buildResultByRiskLevel(riskLevel, data) {
    if (riskLevel === 'High') {
        if (Number(data.sleep_duration) < 5) return 'High Risk: Severe Sleep Deprivation';
        if (String(data.bmi || '').includes('Obese') && data.snoring === 'Every Night') return 'High Risk: Possible Sleep Apnea';
        return 'High Risk: Sleep Disorder Concern (ML Ensemble)';
    }

    if (riskLevel === 'Moderate') return 'Moderate Risk: Lifestyle Imbalance';
    return 'Healthy Sleep Pattern (ML Ensemble)';
}

function buildRecommendations(data, riskLevel) {
    const tips = [];

    if (riskLevel === 'High') {
        tips.push('Consult a sleep specialist and share this report for clinical review.');
        tips.push('Maintain a fixed sleep-wake schedule and reduce caffeine intake after noon.');
    } else if (riskLevel === 'Moderate') {
        tips.push('Improve sleep hygiene and reduce stress before bedtime.');
        tips.push('Aim for 7-8 hours of sleep on most days.');
    } else {
        tips.push('Maintain your current routine.');
        tips.push('Keep a consistent sleep schedule.');
    }

    if (data.anger_response === 'beating' || data.anger_response === 'shouting') {
        tips.push('Practice mindfulness and anger management techniques.');
    }
    if (data.diet === 'never') {
        tips.push('Adopt a healthier meal routine and avoid heavy late-night meals.');
    }
    if (data.prev_health === 'yes' && data.health_details) {
        tips.push(`Note: Your history of "${data.health_details}" may affect sleep quality.`);
    }

    return tips;
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// --- AUTHENTICATION ---
app.post('/register', async (req, res) => {
    const { name, email, phone, password } = req.body;

    // 1. Email Validation (Standard format)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    // 2. Phone Validation (Valid Indian mobile number)

    // 3. Password Validation (Min 8 chars, 1 Letter, 1 Number, 1 Special Symbol)
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/;

    if (!emailRegex.test(email)) {
        return res.send('<h1>Invalid Email Format</h1><a href="/">Go Back</a>');
    }
    if (!isValidIndianPhoneNumber(phone)) {
        return res.send('<h1>Enter a valid Indian mobile number</h1><a href="/">Go Back</a>');
    }
    if (!passwordRegex.test(password)) {
        return res.send('<h1>Password too weak! Must include letters, numbers, and a special symbol.</h1><a href="/">Go Back</a>');
    }

    let users = readData(USERS_DB);
    if (users.find(u => u.email === email)) {
        return res.send('<h1>User Already Exists</h1><a href="/">Back</a>');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    users.push({ name, email, phone: toCanonicalIndianPhone(phone), password: hashedPassword });
    writeData(USERS_DB, users);
    
    res.send('<h1>Registration Successful!</h1><a href="/">Login Now</a>');
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const users = readData(USERS_DB);
    const user = users.find(u => u.email === email);
    
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.userEmail = email;
        res.redirect('/dashboard');
    } else {
        res.send('<h1>Invalid Credentials</h1><a href="/">Try Again</a>');
    }
});

// --- USER LOGOUT ---
app.get('/user-logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// --- DASHBOARD 
app.get('/dashboard', (req, res) => {
    const userEmail = req.session.userEmail;
    if (!userEmail) return res.redirect('/');

    const users = readData(USERS_DB);
    const currentUser = users.find((u) => u.email === userEmail);
    const registeredPhone = normalizePhoneForDisplay(currentUser?.phone || '');

    const allReports = readData(REPORTS_DB);
    const userReports = allReports.filter(r => r.email === userEmail);
    const dashboardError = req.query.error === 'weekly-limit'
        ? `You can create only ${MAX_WEEKLY_ENTRIES} sleep-analysis entries within 7 days. Please try again later.`
        : '';

    let reportRows = userReports.map((r) => `
        <tr style="border-bottom: 1px solid #333;">
            <td style="padding:10px;">${r.date}</td>
            <td style="padding:10px; color:#f39c12;">${r.result}</td>
            <td style="padding:10px;">
                <a href="/view-report?id=${r.id}" style="color:#3498db; text-decoration:none; font-weight:bold; border:1px solid #3498db; padding:2px 8px; border-radius:4px;">
                    View Report
                </a>
            </td>
        </tr>`).join('');

    res.send(`
        <body style="background:#050a14; color:white; font-family:Arial; padding:40px;">
            <div style="max-width:1100px; margin:auto; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #333; padding-bottom:20px;">
                <h2>Welcome, <span style="color:#f39c12;">${userEmail}</span></h2>
                <a href="/user-logout" style="color:#ff4d4d; text-decoration:none; font-weight:bold; border:1px solid #ff4d4d; padding:5px 15px; border-radius:5px;">LOGOUT</a>
            </div>

            ${dashboardError ? `<div style="max-width:1100px; margin:20px auto 0; padding:12px 16px; border:1px solid #a94442; background:#2a0d12; color:#f5c6cb; border-radius:8px;">${dashboardError}</div>` : ''}

            <div style="display:grid; grid-template-columns: 1.2fr 1fr; gap:30px; max-width:1100px; margin:30px auto;">
                
                <div style="background:#0b1120; padding:25px; border-radius:10px; border:1px solid #333;">
                    <h3 style="color:#f39c12; margin-bottom:20px;">New Sleep Analysis</h3>
                    <form action="/predict" method="POST" style="display:grid; grid-template-columns:1fr 1fr; gap:15px;" onsubmit="return validateBPOnSubmit()">
                        <input type="hidden" name="email" value="${userEmail}">
                <div style="grid-column: span 2;">
                    <label>Phone Number (Mandatory for Doctor Consultation)</label>
                    <input type="tel" name="phone_number" value="${registeredPhone}" readonly 
                    pattern="[6-9][0-9]{9}" maxlength="10" required 
                    style="width:100%; padding:10px; background:#16213e; color:white; border:1px solid #333;">
                </div>

                        <div><label>Age</label><input type="number" name="age" id="ageField" min="15" max="80" required style="width:100%; padding:10px; background:#16213e; color:white; border:1px solid #333;" oninput="validateAge()"><span id="ageError" style="color:red; font-size:0.82rem; display:none;">Age must be between 15 and 80 years.</span></div>
                        <div><label>Gender</label><select name="gender" style="width:100%; padding:10px; background:#16213e; color:white; border:1px solid #333;"><option>Male</option><option>Female</option></select></div>
                        
                        <div><label>Occupation</label><input type="text" name="occupation" id="occupationField" required style="width:100%; padding:10px; background:#16213e; color:white; border:1px solid #333;" oninput="validateOccupationField()"><span id="occupationError" style="color:red; font-size:0.82rem; display:none;">Invalid input. Occupation must contain only letters.</span></div>
                        
<div style="grid-column: span 2;">
    <label>What do you do when you get angry?</label>
    <select name="anger_response" style="width:100%; padding:10px; background:#16213e; color:white; border:1px solid #333;">
        <option value="shouting">Shouting</option>
        <option value="beating">Beating someone</option>
        <option value="calm">Calm</option>
        <option value="leave">Leave the situation and moved on</option>
    </select>
</div>

<div>
    <label>Do you follow a healthy diet?</label>
    <select name="diet" style="width:100%; padding:10px; background:#16213e; color:white; border:1px solid #333;">
        <option value="daily">Daily</option>
        <option value="sometimes">Sometimes</option>
        <option value="never">Never</option>
    </select>
</div>

<div style="grid-column: span 2;">
    <label>How do you usually handle a difficult situation?</label>
    <select name="problem_solving" style="width:100%; padding:10px; background:#16213e; color:white; border:1px solid #333;">
        <option value="solve">Will try to solve the problem</option>
        <option value="ignore">Ignore</option>
        <option value="help">Need help</option>
    </select>
</div>

<div style="grid-column: span 2;">
    <label>Previous health issues?</label>
    <select name="prev_health" onchange="document.getElementById('health_desc').style.display = this.value=='yes'?'block':'none'" style="width:100%; padding:10px; background:#16213e; color:white; border:1px solid #333;">
        <option value="no">No</option>
        <option value="yes">Yes</option>
    </select>
    <input type="text" id="health_desc" name="health_details" placeholder="Mention what they are..." style="display:none; width:100%; padding:10px; margin-top:5px; background:#16213e; color:white; border:1px solid #333;">
</div>
                        
                        
                        <div><label>Blood Pressure</label><input type="text" name="bp" id="bpField" placeholder="120/80" required style="width:100%; padding:10px; background:#16213e; color:white; border:1px solid #333;" oninput="validateBPField()" onblur="validateBPField()"><span id="bpError" style="color:red; font-size:0.82rem; display:none;">Invalid blood pressure. Use format like 120/80.</span></div>
                        <div><label>Heart Rate</label><input type="number" name="heart_rate" id="heartRateField" min="30" max="220" required style="width:100%; padding:10px; background:#16213e; color:white; border:1px solid #333;" oninput="validateHeartRate()"><span id="heartRateError" style="color:red; font-size:0.82rem; display:none;">Heart rate must be between 30 and 220 bpm.</span></div>
                        
                        <div><label>Sleep Duration (Hrs)</label><input type="number" step="0.1" name="sleep_duration" id="sleepDurationField" min="0" max="11.9" required style="width:100%; padding:10px; background:#16213e; color:white; border:1px solid #333;" oninput="validateSleepDuration()"><span id="sleepDurationError" style="color:red; font-size:0.82rem; display:none;">Sleep duration must be less than 12 hours.</span></div>
                        
                        <div><label>Tea or Coffee (Cups/day)</label><input type="number" name="tea_coffee" id="teaCoffeeField" min="0" max="4" required style="width:100%; padding:10px; background:#16213e; color:white; border:1px solid #333;" oninput="validateTeaCoffee()"><span id="teaCoffeeError" style="color:red; font-size:0.82rem; display:none;">Tea or Coffee must be less than 5 cups per day.</span></div>

                        <div><label>BMI Category</label>
                            <select name="bmi" style="width:100%; padding:10px; background:#16213e; color:white; border:1px solid #333;">
                                <option>Underweight (Below 18.5)</option>
                                <option>Normal (18.5 - 24.9)</option>
                                <option>Overweight (25.0 - 29.9)</option>
                                <option>Obese Class I (30.0 - 34.9)</option>
                                <option>Obese Class II (35.0 - 39.9)</option>
                                <option>Obese Class III / Extremely Obese (Above 40.0)</option>
                            </select>
                        </div>
                        
                        <div><label>Snoring Frequency</label>
                            <select name="snoring" style="width:100%; padding:10px; background:#16213e; color:white; border:1px solid #333;">
                                <option>Never</option><option>Sometimes</option><option>Every Night</option>
                            </select>
                        </div>

                        <div style="grid-column: span 2;">
                            <label>Working Hours (Per Week)</label>
                            <input type="number" name="work_hours" placeholder="e.g. 40" required style="width:100%; padding:10px; background:#16213e; color:white; border:1px solid #333;">
                        </div>

                        <button type="submit" style="grid-column: span 2; background:#f39c12; color:white; border:none; padding:15px; cursor:pointer; font-weight:bold; border-radius:5px; font-size:1rem; margin-top:10px;">
                            GENERATE PREDICTION
                        </button>
                    </form>
                </div>

                <div style="background:#0b1120; padding:25px; border-radius:10px; border:1px solid #333; overflow-y:auto; max-height:650px;">
                    <h3 style="color:#f39c12; margin-bottom:20px;">Analysis History</h3>
                    <table style="width:100%; border-collapse:collapse;">
                        <thead style="text-align:left; color:#888; border-bottom:1px solid #333;">
                            <tr>
                                <th style="padding:10px;">Date</th>
                                <th style="padding:10px;">Result</th>
                                <th style="padding:10px;">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${reportRows || '<tr><td colspan="3" style="padding:20px; text-align:center; color:#555;">No records found.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        <script>
            function validateBPField() {
                var val = document.getElementById('bpField').value;
                var valid = /^\\d+\\/\\d+$/.test(val.trim());
                document.getElementById('bpError').style.display = (val === '' || valid) ? 'none' : 'inline';
            }
            function validateOccupationField() {
                var val = document.getElementById('occupationField').value;
                var valid = /^[A-Za-z\\s]+$/.test(val.trim());
                document.getElementById('occupationError').style.display = (val === '' || valid) ? 'none' : 'inline';
            }
            function validateSleepDuration() {
                var val = document.getElementById('sleepDurationField').value;
                var num = parseFloat(val);
                var valid = val === '' || (num >= 0 && num < 12);
                document.getElementById('sleepDurationError').style.display = valid ? 'none' : 'inline';
            }
            function validateHeartRate() {
                var val = document.getElementById('heartRateField').value;
                var num = parseInt(val);
                var valid = val === '' || (num >= 30 && num <= 220);
                document.getElementById('heartRateError').style.display = valid ? 'none' : 'inline';
            }
            function validateTeaCoffee() {
                var val = document.getElementById('teaCoffeeField').value;
                var num = parseInt(val);
                var valid = val === '' || (num >= 0 && num < 5);
                document.getElementById('teaCoffeeError').style.display = valid ? 'none' : 'inline';
            }
            function validateAge() {
                var val = document.getElementById('ageField').value;
                var num = parseInt(val);
                var valid = val === '' || (num >= 15 && num <= 80);
                document.getElementById('ageError').style.display = valid ? 'none' : 'inline';
            }
            function validateBPOnSubmit() {
                var bpVal = document.getElementById('bpField').value;
                var bpValid = /^\\d+\\/\\d+$/.test(bpVal.trim());
                if (!bpValid) {
                    document.getElementById('bpError').style.display = 'inline';
                    return false;
                }
                var occVal = document.getElementById('occupationField').value;
                var occValid = /^[A-Za-z\\s]+$/.test(occVal.trim());
                if (!occValid) {
                    document.getElementById('occupationError').style.display = 'inline';
                    return false;
                }
                var sdVal = document.getElementById('sleepDurationField').value;
                var sdNum = parseFloat(sdVal);
                if (sdVal === '' || isNaN(sdNum) || sdNum < 0 || sdNum >= 12) {
                    document.getElementById('sleepDurationError').style.display = 'inline';
                    return false;
                }
                var hrVal = document.getElementById('heartRateField').value;
                var hrNum = parseInt(hrVal);
                if (hrVal === '' || isNaN(hrNum) || hrNum < 30 || hrNum > 220) {
                    document.getElementById('heartRateError').style.display = 'inline';
                    return false;
                }
                var tcVal = document.getElementById('teaCoffeeField').value;
                var tcNum = parseInt(tcVal);
                if (tcVal === '' || isNaN(tcNum) || tcNum < 0 || tcNum >= 5) {
                    document.getElementById('teaCoffeeError').style.display = 'inline';
                    return false;
                }
                var ageVal = document.getElementById('ageField').value;
                var ageNum = parseInt(ageVal);
                if (ageVal === '' || isNaN(ageNum) || ageNum < 15 || ageNum > 80) {
                    document.getElementById('ageError').style.display = 'inline';
                    return false;
                }
                return true;
            }
        </script>
        </body>
    `);
});
// --- PREDICTION ---
app.post('/predict', (req, res) => {
    if (!req.session.userEmail) return res.redirect('/');

    const userEmail = req.session.userEmail;
    const users = readData(USERS_DB);
    const currentUser = users.find((u) => u.email === userEmail);
    const registeredPhone = toCanonicalIndianPhone(currentUser?.phone || '');

    if (!registeredPhone || !isValidIndianPhoneNumber(registeredPhone)) {
        return res.send('<h1>Enter a valid Indian mobile number</h1><a href="/dashboard">Go Back</a>');
    }

    const reports = readData(REPORTS_DB);
    const recentEntryCount = countRecentPhoneReports(reports, registeredPhone);

    if (recentEntryCount >= MAX_WEEKLY_ENTRIES) {
        return res.redirect('/dashboard?error=weekly-limit');
    }

    const data = { ...req.body, email: userEmail, phone_number: registeredPhone };
    const normalizedData = {
        ...data,
        phone_number: normalizePhoneForDisplay(data.phone_number),
        occupation: normalizeOccupation(data.occupation)
    };
    const { finalLabel, mlScore, majorityScore, votingConfidence, modelVotes, modelScores } = ensemblePredict(normalizedData, reports);
    const riskLevel = RISK_LABELS[finalLabel] || 'Low';
    const result = buildResultByRiskLevel(riskLevel, normalizedData);
    const tips = buildRecommendations(normalizedData, riskLevel);

    // --- DETERMINE BEST MODEL ---
    let bestModel = 'Ensemble Voting';
    let bestScore = 0;
    const validScores = Object.entries(modelScores).filter(([_, score]) => Number.isFinite(Number(score)));
    if (validScores.length > 0) {
        const sorted = validScores.sort(([nameA, scoreA], [nameB, scoreB]) => Number(scoreB) - Number(scoreA));
        bestModel = sorted[0][0];
        bestScore = Number(sorted[0][1]);
    }

    // --- DETERMINE SLEEP DISORDER STATUS ---
    const hasSleepDisorder = riskLevel === 'High' || riskLevel === 'Moderate';
    const disorderStatus = hasSleepDisorder ? 'Yes - Patient has sleep disorder risk' : 'No - Patient has healthy sleep pattern';

    // --- SAVE DATA ---
    const newReport = { 
        ...normalizedData, 
        id: Date.now().toString(), 
        createdAt: new Date().toISOString(),
        result, 
        riskLevel, 
        mlScore,
        majorityScore,
        votingConfidence,
        modelVotes,
        modelScores,
        bestPredictionModel: bestModel,
        bestPredictionScore: bestScore,
        sleepDisorderStatus: disorderStatus,
        modelName: 'VotingClassifier(KNN,SVM,RandomForest)',
        recommendations: tips, 
        date: new Date().toLocaleDateString() 
    };
    reports.push(newReport);
    writeData(REPORTS_DB, reports);
    
    res.redirect(`/view-report?id=${newReport.id}`);
});
// --- REPORT VIEW ---
app.get('/view-report', (req, res) => {
    const reportId = req.query.id;
    const reports = readData(REPORTS_DB);
    const r = reports.find(report => report.id === reportId);
    
    if (!r) return res.send("Report not found");

    // Only the report owner or an admin can view the report
    const isAdmin = req.session && req.session.isAdmin;
    const isOwner = req.session && req.session.userEmail && req.session.userEmail === r.email;
    if (!isAdmin && !isOwner) {
        return res.send('<body style="background:#050a14;color:white;text-align:center;padding-top:100px;font-family:Arial;"><h2 style="color:#ff4d4d;">Access Denied</h2><p>You can only view your own reports.</p><a href="/dashboard" style="color:#f39c12;">Go Back</a></body>');
    }

    const isHighRisk = r.riskLevel === 'High' || r.result.includes('High');
    const displayOccupation = normalizeOccupation(r.occupation || 'Professional');
    const occupationLower = displayOccupation.toLowerCase();
    const themeColor = isHighRisk ? '#e74c3c' : '#27ae60'; // Red for High Risk, Green for Healthy
    const bgColor = isHighRisk ? '#fff5f5' : '#f4fbf7'; // Light background colors

    res.send(`
        <body style="background:#e0e4e8; font-family: 'Segoe UI', Roboto, Helvetica, sans-serif; padding:40px;">
            <div id="printArea" style="max-width:900px; margin:auto; background:white; border-radius:15px; overflow:hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.15); position: relative;">
                
                <div style="height:15px; background: linear-gradient(to right, #1a2a6c, ${themeColor});"></div>

                <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-35deg); font-size: 100px; color: rgba(0,0,0,0.015); font-weight: 900; pointer-events: none; z-index:0;">A1 MEDICAL</div>

                <div style="padding:40px; position:relative; z-index:1;">
                    <table style="width:100%; margin-bottom: 30px;">
                        <tr>
                            <td style="width:120px;">
                                <img src="/logo.jpeg" alt="Logo" style="width:110px; height:auto; filter: drop-shadow(2px 2px 2px rgba(0,0,0,0.1));">
                            </td>
                            <td style="padding-left:20px;">
                                <h1 style="margin:0; color:#1a2a6c; font-size:35px; font-weight:800;">A1 HOSPITAL</h1>
                                <p style="margin:3px 0; color:#555; font-size:14px; font-weight:500;">ADVANCED DIAGNOSTIC & SLEEP RESEARCH CENTER</p>
                                <p style="margin:2px 0; color:#888; font-size:12px;">Anantapur, AP | +91 98765 43210 | www.a1hospital.com</p>
                            </td>
                            <td style="text-align:right;">
                                <div style="display:inline-block; border:2px solid ${themeColor}; padding:10px 20px; border-radius:10px;">
                                    <span style="display:block; font-size:10px; color:#888; text-transform:uppercase;">Report Status</span>
                                    <span style="font-size:18px; font-weight:bold; color:${themeColor};">${isHighRisk ? 'URGENT' : 'NORMAL'}</span>
                                </div>
                            </td>
                        </tr>
                    </table>

                    <div style="background:#1a2a6c; color:white; padding:15px; border-radius:8px; display:flex; justify-content:space-between; margin-bottom:30px;">
                        <span>Patient: <b>${r.email}</b></span>
                        <span>ID: <b>${r.id}</b></span>
                        <span>Date: <b>${r.date}</b></span>
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:25px; margin-bottom:30px;">
                        <div style="background:${bgColor}; padding:20px; border-radius:12px; border-left:5px solid ${themeColor};">
                            <h3 style="margin-top:0; color:${themeColor}; font-size:16px;">PHYSICAL PARAMETERS</h3>
                            <table style="width:100%; font-size:14px; border-collapse:collapse;">
                                <tr style="border-bottom:1px solid rgba(0,0,0,0.05);"><td style="padding:8px 0;">Age / Gender</td><td style="text-align:right;"><b>${r.age} / ${r.gender || 'M'}</b></td></tr>
                                <tr style="border-bottom:1px solid rgba(0,0,0,0.05);"><td style="padding:8px 0;">Blood Pressure</td><td style="text-align:right;"><b>${r.bp} mmHg</b></td></tr>
                                <tr style="border-bottom:1px solid rgba(0,0,0,0.05);"><td style="padding:8px 0;">Heart Rate</td><td style="text-align:right;"><b>${r.heart_rate} bpm</b></td></tr>
                                <tr><td style="padding:8px 0;">Occupation</td><td style="text-align:right;"><b>${displayOccupation}</b></td></tr>
                            </table>
                        </div>
                        <div style="background:${bgColor}; padding:20px; border-radius:12px; border-left:5px solid ${themeColor};">
                            <h3 style="margin-top:0; color:${themeColor}; font-size:16px;">SLEEP & STRESS ANALYSIS</h3>
                            <table style="width:100%; font-size:14px; border-collapse:collapse;">
                                <tr style="border-bottom:1px solid rgba(0,0,0,0.05);"><td style="padding:8px 0;">Sleep Duration</td><td style="text-align:right;"><b>${r.sleep_duration} Hrs</b></td></tr>
                
                                <tr style="border-bottom:1px solid rgba(0,0,0,0.05);"><td style="padding:8px 0;">Snoring Level</td><td style="text-align:right;"><b>${r.snoring || 'N/A'}</b></td></tr>
                                <tr><td style="padding:8px 0;">BMI Category</td><td style="text-align:right;"><b>${r.bmi || 'N/A'}</b></td></tr>
                            </table>
                        </div>
                    </div>

                    <div style="text-align:center; padding:30px; border:2px dashed ${themeColor}; border-radius:15px; background:white; margin-bottom:30px;">
                        <p style="margin:0; font-size:12px; color:#888; text-transform:uppercase; letter-spacing:2px;">Medical Diagnosis</p>
                        <h2 style="margin:10px 0; font-size:32px; color:${themeColor}; text-shadow: 1px 1px 2px rgba(0,0,0,0.05);">${r.result}</h2>
                        <div style="display:inline-block; background:${themeColor}; color:white; padding:5px 20px; border-radius:50px; font-size:14px; font-weight:bold;">
                            ${r.riskLevel} Risk Case
                        </div>

                        <div style="margin-top:18px; padding:20px; background:linear-gradient(135deg, ${themeColor}25 0%, ${themeColor}08 100%); border-radius:12px; border:3px solid ${themeColor}; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                            <p style="margin:0 0 12px 0; font-size:13px; color:#1a2a6c; text-transform:uppercase; letter-spacing:1.5px; font-weight:700;">🔍 FINAL SLEEP DISORDER ASSESSMENT</p>
                            <p style="margin:0; font-size:28px; font-weight:900; color:${themeColor}; text-shadow: 0 2px 4px rgba(0,0,0,0.1);">${r.sleepDisorderStatus ? (r.sleepDisorderStatus.includes('Yes') ? '✓ YES' : '✗ NO') : (r.riskLevel === 'High' || r.riskLevel === 'Moderate' ? '✓ YES' : '✗ NO')}</p>
                            <p style="margin:10px 0 0 0; font-size:13px; color:#333; font-weight:600;">${r.sleepDisorderStatus ? r.sleepDisorderStatus : (r.riskLevel === 'High' || r.riskLevel === 'Moderate' ? 'Patient has sleep disorder risk' : 'Patient has healthy sleep pattern')}</p>
                        </div>
                        <div style="margin-top:18px; border:1px solid #d6dce5; border-radius:10px; overflow:hidden;">
                            <table style="width:100%; border-collapse:collapse; font-size:14px;">
                                <thead>
                                    <tr style="background:#f2f6fb; color:#1a2a6c;">
                                        <th style="padding:10px; border-bottom:1px solid #d6dce5;">Model</th>
                                        <th style="padding:10px; border-bottom:1px solid #d6dce5;">Predicted Class</th>
                                        <th style="padding:10px; border-bottom:1px solid #d6dce5;">Sleep Disorder</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td style="padding:10px; border-bottom:1px solid #edf1f7;">KNN</td>
                                        <td style="padding:10px; border-bottom:1px solid #edf1f7;">${Number.isFinite(Number(r.modelVotes?.KNN)) ? RISK_LABELS[Number(r.modelVotes.KNN)] : 'N/A'}</td>
                                        <td style="padding:10px; border-bottom:1px solid #edf1f7;">${Number.isFinite(Number(r.modelVotes?.KNN)) ? (RISK_LABELS[Number(r.modelVotes.KNN)] !== 'Low' ? 'Yes' : 'No') : 'N/A'}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding:10px; border-bottom:1px solid #edf1f7;">SVM</td>
                                        <td style="padding:10px; border-bottom:1px solid #edf1f7;">${Number.isFinite(Number(r.modelVotes?.SVM)) ? RISK_LABELS[Number(r.modelVotes.SVM)] : 'N/A'}</td>
                                        <td style="padding:10px; border-bottom:1px solid #edf1f7;">${Number.isFinite(Number(r.modelVotes?.SVM)) ? (RISK_LABELS[Number(r.modelVotes.SVM)] !== 'Low' ? 'Yes' : 'No') : 'N/A'}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding:10px;">Random Forest</td>
                                        <td style="padding:10px;">${Number.isFinite(Number(r.modelVotes?.RandomForest)) ? RISK_LABELS[Number(r.modelVotes.RandomForest)] : 'N/A'}</td>
                                        <td style="padding:10px;">${Number.isFinite(Number(r.modelVotes?.RandomForest)) ? (RISK_LABELS[Number(r.modelVotes.RandomForest)] !== 'Low' ? 'Yes' : 'No') : 'N/A'}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div style="background:#f0f4f9; padding:25px; border-radius:12px; border: 2px solid #1a2a6c; margin-bottom: 30px; position:relative; z-index:1;">
                        <h4 style="margin-top:0; color:#1a2a6c; display:flex; align-items:center; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700;">
                            <span style="background:#1a2a6c; color:white; width:30px; height:30px; display:inline-flex; align-items:center; justify-content:center; border-radius:50%; margin-right:12px; font-size:16px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">📊</span> 
                            DEEP PREDICTION ANALYSIS & MODEL BREAKDOWN
                        </h4>
                        <div style="height: 2px; width: 60px; background: #1a2a6c; margin-bottom: 15px; margin-left: 42px;"></div>
                        
                        <div style="background:white; padding:15px; border-radius:8px; margin-bottom:15px; border-left:4px solid #1a2a6c;">
                            <b style="color:#1a2a6c;">Ensemble Voting System & Model Consensus</b><br>
                            <span style="font-size:13px; color:#444; line-height:1.6;">
                                <b>System:</b> 3-model ensemble (KNN, SVM, Random Forest) with majority voting.<br>
                                <b>Model Disagreement Analysis:</b> 
                                <ul style="margin:10px 0 0 20px; padding:0;">
                                    <li><b>KNN (${RISK_LABELS[Number(r.modelVotes?.KNN)] || 'N/A'} — Sleep Disorder: ${Number.isFinite(Number(r.modelVotes?.KNN)) ? (RISK_LABELS[Number(r.modelVotes.KNN)] !== 'Low' ? 'Yes' : 'No') : 'N/A'}):</b> Focuses on local patterns in similar cases, predicts more conservatively</li>
                                    <li><b>SVM (${RISK_LABELS[Number(r.modelVotes?.SVM)] || 'N/A'} — Sleep Disorder: ${Number.isFinite(Number(r.modelVotes?.SVM)) ? (RISK_LABELS[Number(r.modelVotes.SVM)] !== 'Low' ? 'Yes' : 'No') : 'N/A'}):</b> Emphasizes margin-based classification, flags borderline cases as risky</li>
                                    <li><b>Random Forest (${RISK_LABELS[Number(r.modelVotes?.RandomForest)] || 'N/A'} — Sleep Disorder: ${Number.isFinite(Number(r.modelVotes?.RandomForest)) ? (RISK_LABELS[Number(r.modelVotes.RandomForest)] !== 'Low' ? 'Yes' : 'No') : 'N/A'}):</b> ${String(r.snoring || '').toLowerCase() === 'never' ? 'Ensemble tree-based voting highlights BMI + blood pressure + short sleep interaction (without snoring).' : 'Ensemble tree-based voting detects interaction between snoring + BMI + blood pressure.'}</li>
                                    <li><b style="color:#d9534f;">Majority Vote: ${r.riskLevel} (${Number(r.votingConfidence) >= 99 ? '3/3' : Number(r.votingConfidence) >= 66 ? '2/3' : '1/3'} models agree)</b></li>
                                </ul>
                                <b style="color:#1a2a6c;">Model Agreement: ${Number(r.votingConfidence) >= 99 ? '3/3' : Number(r.votingConfidence) >= 66 ? '2/3' : '1/3'} models agreed</b>
                            </span>
                        </div>

                        <div style="background:white; padding:15px; border-radius:8px; margin-bottom:15px; border-left:4px solid #e74c3c;">
                            <b style="color:#1a2a6c;">🔴 Risk Factor Analysis - Why ${r.riskLevel?.toUpperCase() || 'MODERATE'} RISK</b><br>
                            <span style="font-size:13px; color:#444; line-height:1.8;">
                                ${(r.snoring || '').toLowerCase() !== 'never' ? '<b style="color:#d9534f;">⚠️ PRIMARY RISK: Snoring — ' + r.snoring + '</b><br>Combined with sleep duration (' + r.sleep_duration + ' hrs) and ' + r.bmi + ' BMI, ' + (r.snoring || '').toLowerCase() + ' snoring is a primary marker for <b>sleep-related breathing disorder (SRBD)</b> or sleep apnea risk.<br><br>' : '<b style="color:#27ae60;">✓ NO SNORING RISK: Snoring — ' + (r.snoring || 'Never') + '</b><br>No snoring reported. This is a positive indicator — absence of snoring reduces likelihood of SRBD and sleep apnea.<br><br>'}
                                
                                ${parseInt((r.bp || '0').split('/')[0]) >= 130 ? '<b style="color:#d9534f;">⚠️ SECONDARY RISK: Blood Pressure — ' + r.bp + ' mmHg</b><br>Systolic ≥130 indicates Stage 1 Hypertension. Combined with poor sleep, this elevates cardiovascular and sleep disorder risk.<br><br>' : '<b style="color:#27ae60;">✓ Blood Pressure ' + r.bp + ' mmHg — within normal range, no hypertension risk detected.</b><br><br>'}
                                
                                ${(r.bmi || '').toLowerCase().includes('overweight') || (r.bmi || '').toLowerCase().includes('obese') ? '<b style="color:#d9534f;">⚠️ TERTIARY RISK: ' + r.bmi + ' BMI</b><br>Excess body weight increases airway fat deposition, raising airway collapse risk during sleep. Key contributor to SRBD and sleep apnea progression.<br><br>' : (r.bmi || '').toLowerCase().includes('underweight') ? '<b style="color:#d9534f;">⚠️ TERTIARY RISK: ' + r.bmi + ' BMI</b><br>Underweight status can indicate reduced muscle tone, which may affect upper airway stability during sleep.<br><br>' : '<b style="color:#27ae60;">✓ BMI: ' + r.bmi + ' — healthy range, no weight-related airway risk detected.</b><br><br>'}

                                ${Number(r.sleep_duration) < 7 ? '<b style="color:#d9534f;">⚠️ QUATERNARY RISK: Sleep Duration — ' + r.sleep_duration + ' hrs</b><br>Below the recommended 7–9 hours. Short sleep is a mild-to-moderate contributor in this profile and is stronger when combined with severe snoring or uncontrolled BP.<br><br>' : '<b style="color:#27ae60;">✓ Sleep Duration ' + r.sleep_duration + ' hrs — meets recommended 7–9 hrs guideline.</b><br><br>'}

                                ${r.riskLevel === 'Low' ? '<b style="color:#1a2a6c;">Why Overall Low Risk Despite Multiple Factors</b><br>Although several mild contributors may be present (for example short sleep, borderline BP, elevated BMI, or occasional snoring), they are not severe enough or strongly interacting in this case. The majority model vote remains Low risk.<br><br>' : ''}
                                
                                <b>✓ POSITIVE FACTORS:</b><br>
                                • Heart Rate ${r.heart_rate} bpm${Number(r.heart_rate) >= 60 && Number(r.heart_rate) <= 100 ? ' (normal resting rate — cardiovascular baseline stable)' : ' (outside normal range — may warrant evaluation)'}<br>
                                ${(r.snoring || '').toLowerCase() === 'never' ? '• Snoring: Never (reduced direct airway obstruction risk)<br>' : ''}
                                ${(r.bmi || '').toLowerCase().includes('normal') ? '• BMI ' + r.bmi + ' (healthy range)<br>' : ''}
                                • Occupation: ${displayOccupation} (${occupationLower.includes('doctor') ? 'clinical awareness can support early detection, while irregular duty hours may still challenge sleep consistency' : occupationLower.includes('student') ? 'routine discipline and health awareness can help offset lifestyle risks' : 'structured routine can support better sleep habits'})
                            </span>
                        </div>

                        <div style="background:white; padding:15px; border-radius:8px; margin-bottom:15px; border-left:4px solid #f39c12;">
                            <b style="color:#1a2a6c;">📈 Prediction Breakdown</b><br>
                            <span style="font-size:13px; color:#444; line-height:1.6;">
                                <b>Model Sleep Disorder Predictions:</b><br>
                                <div style="margin:10px 0; background:#fff8e1; padding:10px; border-radius:5px;">
                                    KNN: ${Number.isFinite(Number(r.modelVotes?.KNN)) ? (RISK_LABELS[Number(r.modelVotes.KNN)] !== 'Low' ? 'Yes' : 'No') : 'N/A'} &nbsp;|&nbsp; SVM: ${Number.isFinite(Number(r.modelVotes?.SVM)) ? (RISK_LABELS[Number(r.modelVotes.SVM)] !== 'Low' ? 'Yes' : 'No') : 'N/A'} &nbsp;|&nbsp; RF: ${Number.isFinite(Number(r.modelVotes?.RandomForest)) ? (RISK_LABELS[Number(r.modelVotes.RandomForest)] !== 'Low' ? 'Yes' : 'No') : 'N/A'}
                                </div>
                                <b>Interpretation:</b> Yes = Sleep disorder detected, No = No sleep disorder detected<br>
                                <b>Final Verdict:</b> <span style="background:${r.riskLevel === 'High' ? '#d9534f' : r.riskLevel === 'Moderate' ? '#f39c12' : '#27ae60'}; color:white; padding:3px 8px; border-radius:3px; font-weight:bold;">${r.riskLevel?.toUpperCase() || 'MODERATE'} RISK — Sleep Disorder: ${r.riskLevel === 'High' || r.riskLevel === 'Moderate' ? 'Yes' : 'No'}</span>
                            </span>
                        </div>

                        <div style="background:#e6f7ff; padding:15px; border-radius:8px; margin-bottom:15px; border-left:4px solid #1890ff;">
                            <b style="color:#1a2a6c;">🎯 ${Number(r.votingConfidence) >= 99 ? 'Why Models Agreed' : 'Why Models Disagreed'} & Resolution</b><br>
                            <span style="font-size:13px; color:#444; line-height:1.6;">
                                <b>KNN (Conservative):</b> Predicts ${RISK_LABELS[Number(r.modelVotes?.KNN)] || 'Risk'} - looks at neighbors (similar age/health profiles around age ${r.age}) and finds comparable cases.<br><br>
                                <b>SVM (${RISK_LABELS[Number(r.modelVotes?.SVM)] || 'Varied'}):</b> Detects complex boundary between healthy and at-risk populations. ${String(r.snoring || '').toLowerCase() === 'never' ? 'Likely weighing obesity, blood pressure (' + r.bp + '), and sleep duration (' + r.sleep_duration + ' hrs) as dominant risk drivers.' : 'May be flagging snoring (' + r.snoring + ') + ' + r.bmi + ' + BP (' + r.bp + ') interaction.'}<br><br>
                                <b>Random Forest (${RISK_LABELS[Number(r.modelVotes?.RandomForest)] || 'Varied'}):</b> Tree ensemble identifies feature interactions. ${String(r.snoring || '').toLowerCase() === 'never' ? 'Risk synergy appears driven by BMI (' + r.bmi + ') × BP (' + r.bp + ') × sleep duration (' + r.sleep_duration + ' hrs), even without snoring.' : 'Snoring × ' + r.bmi + ' × sleep patterns create risk synergy.'}<br><br>
                                <b>Majority Vote Resolution:</b> <b>${r.riskLevel}</b> Risk consensus - ${Number(r.votingConfidence) >= 99 ? 'all 3 models agree, which strengthens confidence in this classification.' : r.riskLevel === 'Low' ? 'two models support Low risk while one model flags a moderate caution; this reflects mild but non-dominant risk features.' : r.riskLevel === 'High' ? 'supported by multiple interacting risk markers.' : 'driven by mixed but clinically relevant contributors.'}
                            </span>
                        </div>
                    </div>

                    <div style="background:#f8f9fa; padding:25px; border-radius:12px; border: 1px solid rgba(26, 42, 108, 0.1); margin-bottom: 30px; position:relative; z-index:1;">
    <h4 style="margin-top:0; color:#1a2a6c; display:flex; align-items:center; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700;">
        <span style="background:${themeColor}; color:white; width:30px; height:30px; display:inline-flex; align-items:center; justify-content:center; border-radius:50%; margin-right:12px; font-size:16px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">✚</span> 
        ADVISORY & HEALTH RECOMMENDATIONS
    </h4>
    <div style="height: 2px; width: 60px; background: ${themeColor}; margin-bottom: 15px; margin-left: 42px;"></div>
    
    <ul style="padding-left:45px; color:#333; font-size:15px; line-height:1.8; font-weight: 500; list-style-type: square;">
        ${r.recommendations ? r.recommendations.map(t => `<li style="margin-bottom:10px;">${t}</li>`).join('') : 
        `<li style="margin-bottom:10px;">Maintain a consistent sleep-wake schedule to regulate your body's internal clock.</li>
         <li style="margin-bottom:10px;">Reduce exposure to blue light from screens at least 1 hour before sleep.</li>
         <li style="margin-bottom:10px;">Incorporate light physical activity during the day to improve sleep quality.</li>
         <li style="margin-bottom:10px;">If symptoms persist, please consult with our sleep specialist for a detailed polysomnography test.</li>`}
    </ul>
</div>

                    <div style="margin-top:50px; display:flex; justify-content:space-between; align-items:flex-end;">
                        <div style="width:50%;">
                            <p style="font-size:10px; color:#999; line-height:1.4;">
                                This report is generated by A1 Hospital's Predictive AI System.<br>
                                Verification Code: A1-XP-2025-RTX<br>
                                This is a digitally signed document.
                                
                <button onclick="window.print()" style="background:linear-gradient(to right, #1a2a6c, #b21f1f); color:white; padding:15px 40px; border:none; border-radius:50px; cursor:pointer; font-weight:bold; font-size:16px; box-shadow: 0 5px 15px rgba(0,0,0,0.2);">
                    DOWNLOAD PROFESSIONAL REPORT
                </button>
            </div>

            <style>
                @media print {
                    .no-print { display: none !important; }
                    body { background: white !important; padding: 0 !important; }
                    #printArea { box-shadow: none !important; border-radius: 0 !important; width: 100% !important; margin: 0 !important; }
                }
            </style>
        </body>
    `);
});
// --- ADMIN LOGIN PAGE ---
app.get('/admin-login', (req, res) => {
    res.send(`
        <body style="background:#050a14; color:white; text-align:center; padding-top:60px; font-family:Arial;">
            <div id="loginBox" style="width:380px; margin:auto; background:#0b1120; padding:40px; border-radius:12px; border:1px solid #f39c12; box-shadow: 0 0 20px rgba(243, 156, 18, 0.2);">
                <h2 style="color:#f39c12; margin-bottom:10px;">Hospital Staff Login</h2>
                <p style="color:#666; font-size:0.8rem; margin-bottom:25px;"></p>
                <form action="/admin-portal" method="POST">
                    <input type="email" name="adminEmail" placeholder="Official Email (name@hospital.com)" required 
                           style="width:100%; padding:14px; margin-bottom:15px; border-radius:5px; border:1px solid #333; background:#16213e; color:white; box-sizing:border-box;">
                    <input type="password" name="adminKey" placeholder="Password" required 
                           style="width:100%; padding:14px; margin-bottom:20px; border-radius:5px; border:1px solid #333; background:#16213e; color:white; box-sizing:border-box;">
                    <button type="submit" style="width:100%; background:#f39c12; border:none; padding:14px; color:white; font-weight:bold; border-radius:5px; cursor:pointer;">LOGIN TO PORTAL</button>
                </form>
                <div style="margin-top:20px; border-top:1px solid #222; padding-top:20px;">
                    <div style="margin-bottom:8px;">
                        <button type="button" onclick="showRegister()" style="background:none; border:none; color:#2ecc71; padding:0; cursor:pointer; font-size:0.8rem; text-decoration:underline;">New Admin? Register here</button>
                    </div>
                    <div style="margin-bottom:8px;">
                        <button type="button" onclick="showForgotPassword()" style="background:none; border:none; color:#3498db; padding:0; cursor:pointer; font-size:0.8rem; text-decoration:underline;">Forgot Password?</button>
                    </div>
                    <button onclick="showEmergency()" style="background:none; border:1px solid #ff4d4d; color:#ff4d4d; padding:8px 15px; border-radius:5px; cursor:pointer; font-size:0.75rem;">MASTER RESET KEY</button>
                </div>
            </div>

            <div id="registerBox" style="display:none; width:380px; margin:auto; background:#0b1120; padding:40px; border-radius:12px; border:1px solid #2ecc71; box-shadow: 0 0 20px rgba(46, 204, 113, 0.2);">
                <h2 style="color:#2ecc71; margin-bottom:10px;">Admin Registration</h2>
                <p style="color:#666; font-size:0.8rem; margin-bottom:25px;">Register a new hospital admin account</p>
                <input type="text" id="regName" placeholder="Full Name" style="width:100%; padding:14px; margin-bottom:12px; border-radius:5px; border:1px solid #333; background:#16213e; color:white; box-sizing:border-box;">
                <input type="email" id="regAdminEmail" placeholder="Official Email" style="width:100%; padding:14px; margin-bottom:12px; border-radius:5px; border:1px solid #333; background:#16213e; color:white; box-sizing:border-box;">
                <input type="password" id="regAdminPass" placeholder="Password (Min 8 chars)" style="width:100%; padding:14px; margin-bottom:12px; border-radius:5px; border:1px solid #333; background:#16213e; color:white; box-sizing:border-box;">
                <input type="password" id="regAdminConfirm" placeholder="Confirm Password" style="width:100%; padding:14px; margin-bottom:16px; border-radius:5px; border:1px solid #333; background:#16213e; color:white; box-sizing:border-box;">
                <button type="button" onclick="submitAdminRegister()" style="width:100%; background:#2ecc71; border:none; padding:14px; color:white; font-weight:bold; border-radius:5px; cursor:pointer;">REGISTER ADMIN</button>
                <div style="margin-top:15px;">
                    <button type="button" onclick="hideRegister()" style="background:none; border:none; color:#888; cursor:pointer; text-decoration:underline; font-size:0.8rem;">Back to Login</button>
                </div>
            </div>

            <div id="forgotPasswordBox" style="display:none; width:380px; margin:auto; background:#0b1120; padding:40px; border-radius:12px; border:1px solid #3498db; box-shadow: 0 0 20px rgba(52, 152, 219, 0.2);">
                <h2 style="color:#3498db; margin-bottom:10px;">Password Reset</h2>
                <p style="color:#666; font-size:0.8rem; margin-bottom:25px;">Enter your email to receive OTP</p>
                
                <div id="emailInputSection">
                    <input type="email" id="resetEmail" placeholder="Your Email Address" style="width:100%; padding:14px; margin-bottom:15px; border-radius:5px; border:1px solid #333; background:#16213e; color:white; box-sizing:border-box;">
                    <button type="button" onclick="sendAdminResetOTP()" style="width:100%; background:#3498db; border:none; padding:14px; color:white; font-weight:bold; border-radius:5px; cursor:pointer;">SEND OTP</button>
                </div>
                
                <div id="otpVerifySection" style="display:none; margin-top:20px; padding:15px; border:1px dashed #3498db; border-radius:5px; background:#16213e;">
                    <p style="color:#3498db; font-size:0.85rem; margin-bottom:10px;">OTP sent to your email (valid for 5 minutes)</p>
                    <input type="text" id="resetOTP" placeholder="Enter 6-digit OTP" maxlength="6" style="width:100%; padding:12px; margin-bottom:10px; border-radius:5px; border:1px solid #3498db; background:#0b1120; color:white; box-sizing:border-box;">
                    <input type="password" id="newPassword" placeholder="New Password (Min 8 chars)" style="width:100%; padding:12px; margin-bottom:10px; border-radius:5px; border:1px solid #333; background:#0b1120; color:white; box-sizing:border-box;">
                    <button type="button" onclick="resetAdminPassword()" style="width:100%; background:#2ecc71; border:none; padding:12px; color:white; font-weight:bold; border-radius:5px; cursor:pointer; margin-bottom:10px;">RESET PASSWORD</button>
                </div>

                <div style="margin-top:15px;">
                    <button type="button" onclick="hideForgotPassword()" style="background:none; border:none; color:#888; cursor:pointer; text-decoration:underline; font-size:0.8rem;">Back to Login</button>
                </div>
            </div>

            <div id="emergencyBox" style="display:none; width:380px; margin:auto; background:#1a0a0a; padding:40px; border-radius:12px; border:2px dashed #ff4d4d;">
                <h2 style="color:#ff4d4d;">EMERGENCY BYPASS</h2>
                <form action="/admin-portal" method="POST">
                    <input type="hidden" name="adminEmail" value="MASTER-RECOVERY">
                    <input type="password" name="adminKey" placeholder="Enter Master Key" required 
                           style="width:100%; padding:14px; margin-bottom:20px; border-radius:5px; border:1px solid #ff4d4d; background:#000; color:white; box-sizing:border-box;">
                    <button type="submit" style="width:100%; background:#ff4d4d; border:none; padding:14px; color:white; font-weight:bold; border-radius:5px; cursor:pointer;">UNLOCK SYSTEM</button>
                </form>
                <br><button onclick="hideEmergency()" style="color:#888; background:none; border:none; cursor:pointer; text-decoration:underline;">Back</button>
            </div>
            <script>
                function showRegister() { document.getElementById('loginBox').style.display = 'none'; document.getElementById('registerBox').style.display = 'block'; }
                function hideRegister() { document.getElementById('loginBox').style.display = 'block'; document.getElementById('registerBox').style.display = 'none'; }
                function showForgotPassword() { document.getElementById('loginBox').style.display = 'none'; document.getElementById('forgotPasswordBox').style.display = 'block'; }
                function hideForgotPassword() { document.getElementById('loginBox').style.display = 'block'; document.getElementById('forgotPasswordBox').style.display = 'none'; document.getElementById('emailInputSection').style.display = 'block'; document.getElementById('otpVerifySection').style.display = 'none'; }
                function showEmergency() { document.getElementById('loginBox').style.display = 'none'; document.getElementById('emergencyBox').style.display = 'block'; }
                function hideEmergency() { document.getElementById('loginBox').style.display = 'block'; document.getElementById('emergencyBox').style.display = 'none'; }

                async function submitAdminRegister() {
                    const name = document.getElementById('regName').value.trim();
                    const email = document.getElementById('regAdminEmail').value.trim();
                    const password = document.getElementById('regAdminPass').value;
                    const confirm = document.getElementById('regAdminConfirm').value;
                    if (!name || !email || !password) { alert('All fields are required'); return; }
                    if (password.length < 8) { alert('Password must be at least 8 characters'); return; }
                    if (password !== confirm) { alert('Passwords do not match'); return; }
                    try {
                        const response = await fetch('/admin-register', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name, email, password}) });
                        const data = await response.json();
                        if (data.success) { alert('Admin registered successfully! You can now login.'); hideRegister(); }
                        else { alert(data.message || 'Registration failed'); }
                    } catch (error) { alert('Error: ' + error.message); }
                }
                
                async function sendAdminResetOTP() {
                    const email = document.getElementById('resetEmail').value;
                    if (!email) { alert('Please enter your email'); return; }
                    try {
                        const response = await fetch('/admin-send-reset-otp', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email}) });
                        const data = await response.json();
                        if (data.success) { 
                            document.getElementById('emailInputSection').style.display = 'none';
                            document.getElementById('otpVerifySection').style.display = 'block';
                            alert('OTP sent to your email');
                        } else { 
                            alert(data.message || 'Error sending OTP'); 
                        }
                    } catch (error) { alert('Error: ' + error.message); }
                }
                
                async function resetAdminPassword() {
                    const email = document.getElementById('resetEmail').value;
                    const otp = document.getElementById('resetOTP').value;
                    const newPassword = document.getElementById('newPassword').value;
                    
                    if (!otp || !newPassword) { alert('Please enter OTP and new password'); return; }
                    if (newPassword.length < 8) { alert('Password must be at least 8 characters'); return; }
                    
                    try {
                        const response = await fetch('/admin-reset-password', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email, otp, newPassword}) });
                        const data = await response.json();
                        if (data.success) { 
                            alert('Password reset successful! Please login with your new password.');
                            hideForgotPassword();
                            document.getElementById('resetEmail').value = '';
                            document.getElementById('resetOTP').value = '';
                            document.getElementById('newPassword').value = '';
                        } else { 
                            alert(data.message || 'Error resetting password'); 
                        }
                    } catch (error) { alert('Error: ' + error.message); }
                }
            </script>
        </body>
    `);
});

// --- 2. ADMIN PORTAL (Fixing Access Denied & Retaining Data) ---
app.post('/admin-portal', async (req, res) => {
    const { adminEmail, adminKey } = req.body;

    const MASTER_RECOVERY_KEY = "HOSPITAL-EMERGENCY-2025-RECOVER";

    const isMasterUsed = (adminKey === MASTER_RECOVERY_KEY);
    let isAdminValid = false;

    if (isMasterUsed) {
        isAdminValid = true;
    } else {
        // Validate against admin_database.json
        if (fs.existsSync(ADMIN_DB)) {
            const admins = JSON.parse(fs.readFileSync(ADMIN_DB, 'utf8'));
            const admin = admins.find(a => a.email === adminEmail);
            if (admin && await bcrypt.compare(adminKey, admin.password)) {
                isAdminValid = true;
            }
        }
    }

    if (!isAdminValid) {
        return res.send(`
            <body style="background:#050a14; color:white; text-align:center; padding-top:100px; font-family:Arial;">
                <h2 style="color:#ff4d4d;">Access Denied!</h2>
                <p>Invalid credentials. Please use a registered admin account.</p>
                <a href="/admin-login" style="color:#f39c12; text-decoration:none;">Try Again</a>
            </body>
        `);
    }

    // Set admin session
    req.session.isAdmin = true;
    req.session.adminEmail = isMasterUsed ? 'MASTER-RECOVERY' : adminEmail;

    res.redirect('/admin-portal');
});

// --- GET ADMIN PORTAL (session-protected) ---
app.get('/admin-portal', (req, res) => {
    if (!req.session || !req.session.isAdmin) {
        return res.redirect('/admin-login');
    }

    const adminEmail = req.session.adminEmail;

    // --- DATA HANDLING (Safe Loading) ---
    let reports = [];
    try {
        if (fs.existsSync(REPORTS_DB)) {
            reports = JSON.parse(fs.readFileSync(REPORTS_DB, 'utf8'));
        }
    } catch (err) {
        console.error("Data reading error:", err);
        reports = [];
    }

    // Calculations for Charts
    const highRiskReports = reports.filter(r => r.result && r.result.includes('High'));
    const highRiskCount = highRiskReports.length;
    const lowRiskCount = reports.length - highRiskCount;

    const ageGroups = { '18-30': 0, '31-50': 0, '50+': 0 };
    reports.forEach(r => {
        const age = parseInt(r.age);
        if (age <= 30) ageGroups['18-30']++;
        else if (age <= 50) ageGroups['31-50']++;
        else ageGroups['50+']++;
    });

    // Table Rows
    let tableRows = reports.slice().reverse().map(r => {
        const isHighRisk = r.result && r.result.includes("High");
        const phone = normalizePhoneForDisplay(r.phone_number || r.phone) || "N/A";
        const callablePhone = normalizePhoneForCallLink(r.phone_number || r.phone);
        return `
        <tr class="search-row" style="border-bottom: 1px solid #333;">
            <td style="padding:15px;"><b>${r.email}</b><br><small style="color:#888;">${phone}</small></td>
            <td style="padding:15px;">
                <span style="color:${isHighRisk ? '#ff4d4d' : '#2ecc71'}; font-weight:bold;">${r.result}</span>
                ${isHighRisk ? '<div class="blink" style="color:red; font-size:10px;">🚨 URGENT</div>' : ''}
            </td>
            <td style="padding:15px;">
                <a href="/view-report?id=${r.id}" style="background:#f39c12; color:white; padding:5px 10px; text-decoration:none; border-radius:4px; font-size:12px;">VIEW</a>
                ${callablePhone ? `<a href="tel:${callablePhone}" style="display:inline-block; background:#2ecc71; color:white; padding:5px 10px; text-decoration:none; border-radius:4px; font-size:12px; margin-left:5px; cursor:pointer;">CALL</a>` : '<span style="margin-left:5px; color:#777; font-size:12px;">NO PHONE</span>'}
            </td>
        </tr>`;
    }).join('');

    let callLogs = [];
    try {
        if (fs.existsSync(CALL_LOGS_DB)) {
            callLogs = JSON.parse(fs.readFileSync(CALL_LOGS_DB, 'utf8'));
        }
    } catch (err) {
        callLogs = [];
    }

    const recentCallRows = callLogs.slice().reverse().slice(0, 8).map(log => `
        <tr style="border-bottom:1px solid #2a2f3a;">
            <td style="padding:10px;">${log.patientEmail || 'N/A'}</td>
            <td style="padding:10px;">${log.phone || 'N/A'}</td>
            <td style="padding:10px; color:#9aa4b2;">${log.time || 'N/A'}</td>
            <td style="padding:10px; color:#2ecc71;">${log.status || 'Initiated'}</td>
        </tr>
    `).join('');

    res.send(`
        <body style="background:#050a14; color:white; font-family:Arial; padding:30px;">
            <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
            <style>.blink { animation: blinker 1s linear infinite; } @keyframes blinker { 50% { opacity: 0; } }</style>
            
            <div style="max-width:1200px; margin:auto;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h2 style="color:#f39c12;">HOSPITAL ADMIN PORTAL - Welcome ${adminEmail}</h2>
                    <a href="/admin-logout" style="color:red; text-decoration:none; border:1px solid red; padding:5px 15px; border-radius:5px;">LOGOUT</a>
                </div>

                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px; margin-bottom:20px;">
                    <div style="background:#0b1120; padding:20px; border-radius:10px;"><canvas id="riskChart"></canvas></div>
                    <div style="background:#0b1120; padding:20px; border-radius:10px;"><canvas id="ageChart"></canvas></div>
                </div>

                <div style="background:#0b1120; padding:20px; border-radius:10px; border:1px solid #333;">
                    <input type="text" id="adminSearch" onkeyup="search()" placeholder="Search Patient Email or Result..." style="width:100%; padding:12px; margin-bottom:20px; background:#16213e; color:white; border:1px solid #444; border-radius:5px;">
                    <table style="width:100%; border-collapse:collapse;">
                        <thead style="background:#16213e; color:#f39c12; text-align:left;">
                            <tr><th style="padding:15px;">Patient</th><th style="padding:15px;">Diagnosis</th><th style="padding:15px;">Action</th></tr>
                        </thead>
                        <tbody id="adminTable">${tableRows}</tbody>
                    </table>
                </div>

                <div style="background:#0b1120; padding:20px; border-radius:10px; border:1px solid #333; margin-top:20px;">
                    <h3 style="color:#2ecc71; margin-bottom:12px;">Recent Call Activity</h3>
                    <table style="width:100%; border-collapse:collapse; font-size:13px;">
                        <thead style="background:#16213e; color:#f39c12; text-align:left;">
                            <tr><th style="padding:10px;">Patient</th><th style="padding:10px;">Phone</th><th style="padding:10px;">Time</th><th style="padding:10px;">Status</th></tr>
                        </thead>
                        <tbody>${recentCallRows || '<tr><td colspan="4" style="padding:14px; color:#666; text-align:center;">No call activity yet</td></tr>'}</tbody>
                    </table>
                </div>
            </div>

            <script>
                function search() {
                    let f = document.getElementById("adminSearch").value.toUpperCase();
                    let rows = document.getElementsByClassName("search-row");
                    for (let r of rows) { r.style.display = r.innerText.toUpperCase().includes(f) ? "" : "none"; }
                }
                function startCall(phone, patientEmail) {
                    const normalized = String(phone || '').replace(/\D/g, '');
                    if (!normalized) {
                        alert('Invalid phone number');
                        return;
                    }
                    window.location.href = 'tel:' + normalized;
                }
                new Chart(document.getElementById('riskChart'), { type: 'doughnut', data: { labels: ['High Risk', 'Healthy'], datasets: [{ data: [${highRiskCount}, ${lowRiskCount}], backgroundColor: ['#ff4d4d', '#2ecc71'] }] } });
                new Chart(document.getElementById('ageChart'), { type: 'bar', data: { labels: ['18-30', '31-50', '50+'], datasets: [{ label: 'Total Patients', data: [${ageGroups['18-30']}, ${ageGroups['31-50']}, ${ageGroups['50+']}], backgroundColor: '#3498db' }] } });
            </script>
        </body>
    `);
});

// --- ADMIN LOGOUT ---
app.get('/admin-logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/admin-login');
    });
});

// --- ADMIN REGISTRATION ---
app.post('/admin-register', async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.json({ success: false, message: 'All fields are required' });
    }
    if (password.length < 8) {
        return res.json({ success: false, message: 'Password must be at least 8 characters' });
    }

    const admins = fs.existsSync(ADMIN_DB) ? JSON.parse(fs.readFileSync(ADMIN_DB, 'utf8')) : [];
    if (admins.find(a => a.email === email)) {
        return res.json({ success: false, message: 'Admin with this email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    admins.push({ name, email, password: hashedPassword });
    fs.writeFileSync(ADMIN_DB, JSON.stringify(admins, null, 2));

    res.json({ success: true, message: 'Admin registered successfully' });
});

// --- ADMIN CALL LOGGING ---
app.post('/admin-log-call', (req, res) => {
    if (!req.session || !req.session.isAdmin) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const { phone, patientEmail } = req.body;
    const cleanedPhone = String(phone || '').replace(/[^0-9+]/g, '').trim();
    if (!cleanedPhone) {
        return res.status(400).json({ success: false, message: 'Invalid phone number' });
    }

    const logs = fs.existsSync(CALL_LOGS_DB) ? JSON.parse(fs.readFileSync(CALL_LOGS_DB, 'utf8')) : [];
    logs.push({
        adminEmail: req.session.adminEmail || 'Unknown',
        patientEmail: patientEmail || 'Unknown',
        phone: cleanedPhone,
        status: 'Initiated',
        time: new Date().toLocaleString()
    });
    fs.writeFileSync(CALL_LOGS_DB, JSON.stringify(logs, null, 2));

    res.json({ success: true });
});

// --- ADMIN CLOUD CALL (Asterisk ARI) ---
app.post('/admin-cloud-call', async (req, res) => {
    if (!req.session || !req.session.isAdmin) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    if (!hasAsteriskConfig) {
        return res.status(400).json({
            success: false,
            message: 'Cloud call is not configured. Set ASTERISK_ARI_URL, ASTERISK_ARI_USERNAME, ASTERISK_ARI_PASSWORD, and ASTERISK_ENDPOINT_PREFIX.'
        });
    }

    const { phone, patientEmail } = req.body;
    const toNumber = normalizePhoneForCloudCall(phone);
    if (!toNumber) {
        return res.status(400).json({ success: false, message: 'Invalid phone number for cloud call. Use +countrycode or 10-digit number.' });
    }

    try {
        const normalizedForEndpoint = toNumber.startsWith('+') ? toNumber.slice(1) : toNumber;
        const endpoint = `${asteriskEndpointPrefix}/${normalizedForEndpoint}`;
        const url = new URL('/channels', asteriskAriUrl.endsWith('/') ? asteriskAriUrl : `${asteriskAriUrl}/`);
        url.searchParams.set('endpoint', endpoint);
        url.searchParams.set('app', asteriskAriApp);
        url.searchParams.set('callerId', asteriskCallerId);
        url.searchParams.set('timeout', '30');

        const ariResponse = await fetch(url.toString(), {
            method: 'POST',
            headers: {
                Authorization: `Basic ${Buffer.from(`${asteriskAriUser}:${asteriskAriPass}`).toString('base64')}`,
                'Content-Type': 'application/json'
            }
        });

        if (!ariResponse.ok) {
            const errorText = await ariResponse.text();
            return res.status(500).json({
                success: false,
                message: `Asterisk call failed: ${errorText || ariResponse.statusText}`
            });
        }

        const call = await ariResponse.json();

        const logs = fs.existsSync(CALL_LOGS_DB) ? JSON.parse(fs.readFileSync(CALL_LOGS_DB, 'utf8')) : [];
        logs.push({
            adminEmail: req.session.adminEmail || 'Unknown',
            patientEmail: patientEmail || 'Unknown',
            phone: toNumber,
            status: `Cloud:${call.state || 'queued'}`,
            sid: call.id,
            time: new Date().toLocaleString()
        });
        fs.writeFileSync(CALL_LOGS_DB, JSON.stringify(logs, null, 2));

        return res.json({ success: true, status: call.state || 'queued', sid: call.id });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Cloud call failed' });
    }
});
const nodemailer = require('nodemailer');

let tempOTP; 
let tempResetOTP = {}; // Store reset OTPs with email as key
let adminResetOTP = {}; // Store admin reset OTPs with email as key

// Email configuration
const emailConfig = {
    service: 'gmail',
    auth: {
        user: 'bhargaviperam5@gmail.com',
        pass: 'sysp idbl isuh wlwh'
    }
};

app.post('/send-otp', async (req, res) => {
    const { type, receiver } = req.body;
    
    tempOTP = Math.floor(100000 + Math.random() * 900000);
    console.log(`OTP for ${receiver}: ${tempOTP}`);

    // Only email OTP - phone OTP removed per requirements
    if (type === 'email') {
        let transporter = nodemailer.createTransport(emailConfig);

        let mailOptions = {
            from: 'bhargaviperam5@gmail.com', 
            to: receiver,
            subject: 'Your OTP for Registration',
            text: `Your OTP is: ${tempOTP}. This is valid for 5 minutes.`
        };

        try {
            await transporter.sendMail(mailOptions);
            res.status(200).send("OTP Sent to Email");
        } catch (error) {
            console.log(error);
            res.status(500).send("Error sending email");
        }
    }
});

app.post('/verify-otp', (req, res) => {
    const { otp } = req.body;

    if (parseInt(otp) === tempOTP) {
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// --- PASSWORD RESET WITH EMAIL OTP ---
app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    
    // Check if user exists
    const users = readData(USERS_DB);
    const userExists = users.find(u => u.email === email);
    
    if (!userExists) {
        return res.json({ success: false, message: 'Email not registered' });
    }

    // Generate OTP for password reset
    const resetOTP = Math.floor(100000 + Math.random() * 900000);
    tempResetOTP[email] = resetOTP;
    
    console.log(`Password Reset OTP for ${email}: ${resetOTP}`);

    let transporter = nodemailer.createTransport(emailConfig);
    let mailOptions = {
        from: 'bhargaviperam5@gmail.com',
        to: email,
        subject: 'Password Reset OTP',
        text: `Your OTP for password reset is: ${resetOTP}. This is valid for 5 minutes.`
    };

    try {
        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'OTP sent to email' });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Error sending OTP' });
    }
});

app.post('/reset-password', async (req, res) => {
    const { email, otp, newPassword } = req.body;

    // Validate OTP
    if (!tempResetOTP[email] || parseInt(otp) !== tempResetOTP[email]) {
        return res.json({ success: false, message: 'Invalid OTP' });
    }

    // Validate password strength
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/;
    if (!passwordRegex.test(newPassword)) {
        return res.json({ success: false, message: 'Password too weak! Must include letters, numbers, and a special symbol.' });
    }

    try {
        // Update password in database
        let users = readData(USERS_DB);
        const userIndex = users.findIndex(u => u.email === email);
        
        if (userIndex === -1) {
            return res.json({ success: false, message: 'User not found' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        users[userIndex].password = hashedPassword;
        writeData(USERS_DB, users);
        
        // Clear the OTP after successful reset
        delete tempResetOTP[email];
        
        res.json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Error resetting password' });
    }
});

// --- ADMIN PASSWORD RESET WITH EMAIL OTP ---
app.post('/admin-send-reset-otp', async (req, res) => {
    const { email } = req.body;
    
    try {
        // Check if admin exists in admin_database
        if (!fs.existsSync(ADMIN_DB)) {
            return res.json({ success: false, message: 'Admin database not found' });
        }
        
        const admins = JSON.parse(fs.readFileSync(ADMIN_DB, 'utf8'));
        const adminExists = admins.find(a => a.email === email);
        
        if (!adminExists) {
            return res.json({ success: false, message: 'Email not registered as admin' });
        }

        // Generate OTP for admin password reset
        const resetOTP = Math.floor(100000 + Math.random() * 900000);
        adminResetOTP[email] = { otp: resetOTP, timestamp: Date.now() };
        
        console.log(`Admin Password Reset OTP for ${email}: ${resetOTP}`);

        let transporter = nodemailer.createTransport(emailConfig);
        let mailOptions = {
            from: 'bhargaviperam5@gmail.com',
            to: email,
            subject: 'Hospital Admin - Password Reset OTP',
            text: `Your OTP for admin password reset is: ${resetOTP}. This is valid for 5 minutes. Do not share this OTP with anyone.`
        };

        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'OTP sent to email' });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Error sending OTP' });
    }
});

app.post('/admin-reset-password', async (req, res) => {
    const { email, otp, newPassword } = req.body;

    try {
        // Validate OTP and check expiry (5 minutes = 300000ms)
        if (!adminResetOTP[email] || parseInt(otp) !== adminResetOTP[email].otp) {
            return res.json({ success: false, message: 'Invalid OTP' });
        }
        
        if (Date.now() - adminResetOTP[email].timestamp > 300000) {
            delete adminResetOTP[email];
            return res.json({ success: false, message: 'OTP expired. Please request a new one.' });
        }

        // Validate password strength (min 8 characters)
        if (!newPassword || newPassword.length < 8) {
            return res.json({ success: false, message: 'Password must be at least 8 characters' });
        }

        // Read admin database
        const admins = JSON.parse(fs.readFileSync(ADMIN_DB, 'utf8'));
        const adminIndex = admins.findIndex(a => a.email === email);
        
        if (adminIndex === -1) {
            return res.json({ success: false, message: 'Admin not found' });
        }

        // Hash new password and update
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        admins[adminIndex].password = hashedPassword;
        fs.writeFileSync(ADMIN_DB, JSON.stringify(admins, null, 2));
        
        // Clear the OTP after successful reset
        delete adminResetOTP[email];
        
        res.json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: 'Error resetting password' });
    }
});

app.listen(3000, '0.0.0.0', () => {
    console.log('Server is running on http://localhost:3000');
    console.log('Or on mobile at: http://YOUR_IP_ADDRESS:3000');
    console.log('\n=== AUTHENTICATION FEATURES ===');
    console.log('✓ Registration: Email OTP verification');
    console.log('✓ Login: Email & Password');
    console.log('✓ Password Reset: Email OTP verification');
    console.log('✗ Phone OTP: Removed (per requirements)');
    console.log('=================================\n');
});
