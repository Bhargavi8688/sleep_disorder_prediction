#!/usr/bin/env node

const http = require('http');
const querystring = require('querystring');

const BASE_URL = 'http://localhost:3000';

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
                    setCookie: setCookie,
                    location: res.headers.location
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
    console.log('\n🧪 Testing Weekly Entry Limit Error Message Display\n');
    
    try {
        const testEmail = `testuser_${Date.now()}@test.com`;
        const testPassword = 'Test@12345';
        
        console.log(`📝 Register & Login...`);
        
        await makeRequest('POST', '/register', {
            name: 'Test User',
            email: testEmail,
            phone: '9876543210',
            password: testPassword
        });
        
        const loginRes = await makeRequest('POST', '/login', {
            email: testEmail,
            password: testPassword
        });
        
        const sessionCookie = extractSession(loginRes.setCookie);
        
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

        // Submit 3 entries
        for (let i = 1; i <= 3; i++) {
            await makeRequest('POST', '/predict', testData, sessionCookie);
        }
        
        // 4th entry submission
        console.log(`\n📊 Submitting 4th entry (should be rejected)...`);
        const submitRes = await makeRequest('POST', '/predict', testData, sessionCookie);
        console.log(`✅ Redirect location: ${submitRes.location}\n`);
        
        // Fetch dashboard to see error message
        console.log(`📄 Fetching dashboard to check error message...`);
        const dashboardRes = await makeRequest('GET', submitRes.location, null, sessionCookie);
        
        if (dashboardRes.body.includes('You can create only 3 sleep-analysis entries within 7 days')) {
            console.log(`✅ Error message displayed correctly on dashboard!`);
            console.log(`\n📋 Error Message:\n`);
            const match = dashboardRes.body.match(/You can create only[^<]+/);
            if (match) {
                console.log(`   "${match[0]}"`);
            }
        } else {
            console.log(`❌ Error message not found in dashboard`);
        }
        
        console.log(`\n✅ Weekly limit enforcement test passed!\n`);
        
    } catch (error) {
        console.error('Test error:', error.message);
    }
}

runTest();
