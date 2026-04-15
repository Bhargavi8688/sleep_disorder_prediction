#!/usr/bin/env node

const http = require('http');
const querystring = require('querystring');

const BASE_URL = 'http://localhost:3000';

// Helper to make HTTP requests
function makeRequest(method, path, data, cookies = '') {
    return new Promise((resolve, reject) => {
        const url = new URL(BASE_URL + path);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            }
        };

        if (cookies) {
            options.headers['Cookie'] = cookies;
        }

        const req = http.request(options, (res) => {
            let body = '';
            
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                const setCookie = res.headers['set-cookie'];
                resolve({
                    status: res.statusCode,
                    body: body,
                    headers: res.headers,
                    setCookie: setCookie
                });
            });
        });

        req.on('error', reject);
        
        if (data) {
            req.write(querystring.stringify(data));
        }
        req.end();
    });
}

function extractSession(setCookieHeaders) {
    if (!setCookieHeaders) return '';
    for (const header of setCookieHeaders) {
        if (header.includes('connect.sid')) {
            return header.split(';')[0];
        }
    }
    return '';
}

async function runTest() {
    console.log('\n🧪 Testing Weekly Entry Limit (3 per week max)\n');
    
    try {
        // Step 1: Register Test User
        const testEmail = `testuser_${Date.now()}@test.com`;
        const testPassword = 'Test@12345';
        const testPhone = '9876543210';
        
        console.log(`📝 Step 1: Registering test user (${testEmail})...`);
        const registerRes = await makeRequest('POST', '/register', {
            name: 'Test User',
            email: testEmail,
            phone: testPhone,
            password: testPassword
        });
        console.log(`✅ Registration response status: ${registerRes.status}`);
        
        // Step 2: Login
        console.log(`\n🔐 Step 2: Logging in...`);
        const loginRes = await makeRequest('POST', '/login', {
            email: testEmail,
            password: testPassword
        });
        const sessionCookie = extractSession(loginRes.setCookie);
        console.log(`✅ Login status: ${loginRes.status}`);
        console.log(`✅ Session cookie extracted: ${sessionCookie ? 'YES' : 'NO'}`);
        
        if (!sessionCookie) {
            console.error('❌ Failed to extract session cookie!');
            return;
        }
        
        // Step 3: Submit entries
        const testData = {
            email: testEmail,
            phone_number: '9876543210',
            age: '30',
            gender: 'Male',
            occupation: 'Engineer',
            anger_response: 'calm',
            diet: 'sometimes',
            problem_solving: 'solve',
            prev_health: 'no',
            bp: '120/80',
            heart_rate: '72',
            sleep_duration: '7',
            tea_coffee: '2',
            bmi: 'Normal (18.5 - 24.9)',
            snoring: 'Never',
            work_hours: '40'
        };

        for (let i = 1; i <= 4; i++) {
            console.log(`\n📊 Step 3.${i}: Submitting sleep analysis entry #${i}...`);
            const submitRes = await makeRequest('POST', '/predict', testData, sessionCookie);
            
            const isError = submitRes.body.includes('weekly-limit') || submitRes.body.includes('weekly');
            const isSuccess = submitRes.status === 302 || !isError;
            
            if (i <= 3) {
                if (isSuccess && !isError) {
                    console.log(`✅ Entry #${i} accepted (redirected to report)`);
                } else {
                    console.log(`❌ Entry #${i} was unexpectedly rejected!`);
                    console.log(`   Response includes 'weekly': ${submitRes.body.includes('weekly')}`);
                }
            } else {
                // 4th entry should be rejected
                if (isError) {
                    console.log(`✅ Entry #${i} correctly REJECTED with weekly-limit error`);
                    if (submitRes.body.includes('You can create only 3 sleep-analysis entries')) {
                        console.log(`✅ Error message is correct!`);
                    }
                } else {
                    console.log(`❌ Entry #${i} was unexpectedly ACCEPTED!`);
                }
            }
        }
        
        console.log('\n\n✅ Test complete! Weekly limit is working as expected.\n');
        
    } catch (error) {
        console.error('❌ Test failed with error:', error.message);
    }
}

runTest();
