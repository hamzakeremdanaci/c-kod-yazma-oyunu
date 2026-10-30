# C ile Programlama — Sıfırdan Uygulamalı Kurs

Türkçe, sıfırdan başlayan biri için hazırlanmış C öğrenme uygulaması: 16 ders,
32 alıştırma, gerçek gcc derleyici ile çalışan kod editörü ve otomatik testler.

## Başlatma

```bash
node server.js
```

Sonra tarayıcıda aç: **http://127.0.0.1:4173**

## Neler var?

- **16 ders** (Temel → Orta): değişkenler, koşullar, döngüler, fonksiyonlar,
  diziler, string'ler, pointer, struct, malloc, dosya işlemleri, hata ayıklama
  ve kapanış projesi.
- **32 alıştırma**: her biri otomatik test edilir (girdi → beklenen çıktı +
  bazı testlerde zorunlu/yasaklı kalıp kontrolleri, dosya içeriği kontrolleri).
- **Editör**: kodu yaz, "Derle ve Çalıştır" (Ctrl+Enter) ya da "Testleri Çalıştır".
  Derleme hataları, çalışma çıktısı, zaman aşımı ayrı ayrı gösterilir.
- **İlerleme kaydı**: çözdüğün alıştırmalar ve yazdığın taslak kodlar
  tarayıcının localStorage'ında tutulur; istediğin an geri dönebilirsin.
- **İpucu / Çözüm** düğmeleri: takıldığında yardım alırsın.

## Dosyalar

| Dosya | Görev |
|---|---|
| `server.js` | HTTP sunucusu; gcc ile derler/çalıştırır/test eder |
| `course.js` | Ders listesini birleştirir |
| `lessons/01-08.js` | 1–8. dersler (temel) |
| `lessons/09-16.js` | 9–16. dersler (orta) |
| `public/` | Arayüz (HTML/CSS/JS) |
| `test-all.js` | Tüm çözümleri test eden doğrulama betiği |

## Gereksinimler

- Node.js
- gcc (bu makineye WinLibs/MinGW64 ile kuruldu). Farklı bir yoldaysa
  `GCC_PATH` ortam değişkenini tanımlayabilirsin.