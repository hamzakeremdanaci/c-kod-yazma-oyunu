'use strict';

/* Kurs içeriği doğrulama: her alıştırmanın çözümü testlerden geçmeli. */

const BASE = 'http://127.0.0.1:4173';

async function main() {
  const res = await fetch(BASE + '/api/course');
  if (!res.ok) throw new Error('course yüklenemedi: ' + res.status);
  const course = await res.json();

  let passed = 0;
  const failures = [];

  for (const lesson of course.lessons) {
    for (const ex of lesson.exercises) {
      const r = await fetch(BASE + '/api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exerciseId: ex.id, code: ex.solution }),
      });
      const data = await r.json();
      if (data.ok) {
        passed++;
        console.log(`PASS ${ex.id}  ${ex.title}`);
      } else {
        failures.push({ id: ex.id, data });
        console.log(`FAIL ${ex.id}  ${ex.title}`);
      }
    }
  }

  console.log(`\nToplam: ${passed}/${course.lessons.reduce((s, l) => s + l.exercises.length, 0)} çözümler geçti`);
  for (const f of failures) {
    console.log('\n--- ' + f.id);
    console.log(JSON.stringify(f.data, null, 2).slice(0, 2000));
  }

  // Negatif kontrol: boş kod reddedilmeli
  const bad = await fetch(BASE + '/api/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exerciseId: 'l01e1', code: '' }),
  });
  const badData = await bad.json();
  console.log('\nBoş kod reddedildi mi:', bad.ok === false || badData.ok === false ? 'EVET' : 'HAYIR!!');

  // Negatif kontrol: yanlış çözüm geçmemeli
  const wrong = await fetch(BASE + '/api/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exerciseId: 'l01e1', code: '#include <stdio.h>\nint main(void){ printf("yanlis\\n"); return 0; }' }),
  });
  const wrongData = await wrong.json();
  console.log('Yanlış çözüm reddedildi mi:', wrongData.ok === false ? 'EVET' : 'HAYIR!!');

  // Serbest çalıştırma uç noktası
  const run = await fetch(BASE + '/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: '#include <stdio.h>\nint main(void){ int x; scanf("%d",&x); printf("2x=%d\\n", x*2); return 0; }', stdin: '21\n' }),
  });
  const runData = await run.json();
  console.log('Serbest çalıştırma:', JSON.stringify(runData));

  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error('HATA:', e);
  process.exit(2);
});