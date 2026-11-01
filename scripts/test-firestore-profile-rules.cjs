// Run through `npm run test:rules:profile`; all documents are emulator-only fixtures.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const project = 'demo-simas-profile-rules';
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
  throw new Error('FIRESTORE_EMULATOR_HOST must point to a local emulator.');
}
const origin = `http://${host}`;
const base = `${origin}/v1/projects/${project}/databases/(default)/documents`;
const rules = readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const uid = 'profile-rules-teacher';
const profile = { name: 'Test Teacher', email: 'teacher@example.test', role: 'guru_mapel', additionalRoles: [] };
let checks = 0;

function token(userId) {
  const now = Math.floor(Date.now() / 1000);
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    iss: `https://securetoken.google.com/${project}`, aud: project,
    sub: userId, user_id: userId, iat: now, exp: now + 3600, auth_time: now,
    firebase: { sign_in_provider: 'password', identities: {} }
  })}.`;
}

function fields(document) {
  return Object.fromEntries(Object.entries(document).map(([key, value]) => [key,
    Array.isArray(value)
      ? { arrayValue: { values: value.map(item => ({ stringValue: item })) } }
      : { stringValue: value }
  ]));
}

async function request(documentPath, method, document, credential) {
  const response = await fetch(`${base}/${documentPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}) },
    ...(document ? { body: JSON.stringify({ fields: fields(document) }) } : {}),
    signal: AbortSignal.timeout(30000)
  });
  return { status: response.status, body: await response.json() };
}

async function expectStatus(label, documentPath, method, document, credential, expected) {
  const result = await request(documentPath, method, document, credential);
  assert.equal(result.status, expected, `${label}: ${JSON.stringify(result.body)}`);
  console.log(`PASS ${label} (HTTP ${expected})`);
  checks++;
  return result.body;
}

async function seed(documentPath, document) {
  const result = await request(documentPath, 'PATCH', document, 'owner');
  assert.equal(result.status, 200, JSON.stringify(result.body));
}

async function main() {
  const loaded = await fetch(`${origin}/emulator/v1/projects/${project}:securityRules`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: rules }] } }),
    signal: AbortSignal.timeout(30000)
  });
  const compilation = await loaded.json();
  assert.equal(loaded.status, 200, JSON.stringify(compilation));
  assert.ok(!compilation.issues?.some(issue => issue.severity === 'ERROR'), JSON.stringify(compilation));

  const own = `users/${uid}`;
  const auth = token(uid);
  await seed(own, profile);
  await seed('settings/system_config', { siteName: 'LOCAL TEST' });
  await expectStatus('unauthenticated profile edit rejected', own, 'PATCH', profile, null, 403);
  const edited = { ...profile, name: 'Updated Teacher', email: 'updated@example.test', telegramChatId: '12345' };
  await expectStatus('allowed profile fields can be changed or added', own, 'PATCH', edited, auth, 200);
  await expectStatus('optional profile field can be removed', own, 'PATCH', profile, auth, 200);
  await expectStatus('direct role escalation rejected', own, 'PATCH', { ...profile, role: 'super_admin' }, auth, 403);
  const noRole = { ...profile };
  delete noRole.role;
  await expectStatus('removing own role rejected', own, 'PATCH', noRole, auth, 403);
  await expectStatus('escalation after attempted removal rejected', own, 'PATCH', { ...profile, role: 'super_admin' }, auth, 403);
  await expectStatus('admin settings still protected', 'settings/system_config', 'PATCH', { siteName: 'UNAUTHORIZED' }, auth, 403);
  await expectStatus('changing additional roles rejected', own, 'PATCH', { ...profile, additionalRoles: ['super_admin'] }, auth, 403);
  const noAdditionalRoles = { ...profile };
  delete noAdditionalRoles.additionalRoles;
  await expectStatus('removing additional roles rejected', own, 'PATCH', noAdditionalRoles, auth, 403);

  // Legacy/incomplete documents must not permit adding protected fields either.
  await seed(own, noAdditionalRoles);
  await expectStatus('adding previously absent additional roles rejected', own, 'PATCH', { ...profile, additionalRoles: ['super_admin'] }, auth, 403);
  await seed(own, noRole);
  await expectStatus('adding previously absent primary role rejected', own, 'PATCH', { ...profile, role: 'super_admin' }, auth, 403);
  await seed(own, profile);
  await seed('users/profile-rules-other', profile);
  await expectStatus('editing another teacher profile rejected', 'users/profile-rules-other', 'PATCH', edited, auth, 403);

  // Preserve the separate, intentional administrative permissions.
  await seed('users/profile-rules-admin', { ...profile, role: 'super_admin' });
  await expectStatus('super admin can assign roles', own, 'PATCH', { ...profile, role: 'guru_bk' }, token('profile-rules-admin'), 200);
  await seed(own, profile);
  await seed('users/profile-rules-staff', { ...profile, role: 'staff' });
  await expectStatus('staff can assign permitted teacher roles', own, 'PATCH', { ...profile, role: 'wali_kelas' }, token('profile-rules-staff'), 200);
  await expectStatus('staff cannot assign super admin', own, 'PATCH', { ...profile, role: 'super_admin' }, token('profile-rules-staff'), 403);
  console.log(`All ${checks} Firestore profile authorization checks passed.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
