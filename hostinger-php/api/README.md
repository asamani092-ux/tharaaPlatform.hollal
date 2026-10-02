# نسخ PHP لرفعها يدوياً إلى Hostinger (`public_html/api/`)

| ملف | ملاحظة |
|-----|--------|
| **`cors.php`** | **إلزامي** — CORS + كل دوال الصلاحيات. **لا تحتاج** `auth_helpers.php` على Hostinger إذا رفعت هذا الملف. |
| `auth_helpers.php` | للمستودع فقط؛ اختياري على السيرفر (يُحمَّل تلقائياً فقط إن لم تكن الدوال موجودة في `cors.php`) |
| `analytics.php` | مؤشرات، فلترة دفعة/مسار، متعثرون 7 أيام (`strugglerFrom` / `strugglerBatchId` + واتساب)، عنق الزجاجة — **ارفع يدوياً بعد كل تغيير** |
| `settings.php` | منهج PDF؛ صيانة وإنجاز سابق (سوبرفايزر)； `atRiskInactiveDays` |
| `users.php` | المشرف والسوبرفايزر: مشاركين وإحصائيات؛ `?id=admins|admin`: **سوبرفايزر فقط** (حسابات `admin`) |
| `settings.php` | GET/PATCH/PUT/POST — حفظ الإعدادات؛ صيانة وإنجاز سابق: سوبرفايزر فقط |
| `MIGRATION_supervisor_and_at_risk.sql` | أيام الخطر + دور supervisor |
| `MIGRATION_curriculum_pdf_by_track.sql` | منهج PDF كامل/ميسر |
| `MIGRATION_prior_achievement_enabled.sql` | زر إنجاز سابق |
| `CUSTOM_PROGRESS_SERVER.md` | دمج تراكمي `completed_books` |

الواجهة ترسل بالفعل `completedBooks` مدمجة؛ يُفضّل أن يدمج الخادم أيضاً (اتحاد) وليس استبدالاً.
