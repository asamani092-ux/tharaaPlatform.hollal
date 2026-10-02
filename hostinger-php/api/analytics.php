<?php
ob_start();
error_reporting(0);
header('Content-Type: application/json; charset=utf-8');

require_once 'cors.php';
require_once 'db.php';
if (!function_exists('requireStaffRole')) {
    require_once 'auth_helpers.php';
}
if (!function_exists('weekLabelForDate')) {
    require_once 'week_label_helpers.php';
}

function loadSettings(PDO $pdo): array
{
    $row = $pdo->query('SELECT * FROM settings LIMIT 1')->fetch(PDO::FETCH_ASSOC);
    return $row ?: ['weekly_quota' => 75, 'submission_start_day' => 0];
}

function getBatchEpoch(string $batchCreatedAt, int $submissionStartDay): DateTime
{
    $created = new DateTime($batchCreatedAt);
    $created->setTime(0, 0, 0);
    for ($i = 0; $i < 8; $i++) {
        $candidate = (clone $created)->modify("+{$i} day");
        if ((int)$candidate->format('w') === $submissionStartDay) {
            return $candidate;
        }
    }
    return $created;
}

function getBatchWeekNow(DateTime $epoch): int
{
    $today = new DateTime('today');
    if ($today < $epoch) {
        return 1;
    }
    $days = (int)$epoch->diff($today)->format('%a');
    return max(1, (int)floor($days / 7) + 1);
}

function getEffectiveTrack(?string $override, ?string $batchDefault): string
{
    if (!empty($override)) {
        return $override;
    }
    if (!empty($batchDefault)) {
        return $batchDefault;
    }
    return 'full';
}

function bookMatchesTrack(array $book, string $track): bool
{
    $tt = $book['track_type'] ?? 'both';
    return $tt === $track || $tt === 'both';
}

function normalizeBookLevelType($levelType): string
{
    $lt = strtolower(trim((string)($levelType ?? 'basic')));
    if (in_array($lt, ['optional', 'اختياري', 'إختياري'], true)) {
        return 'optional';
    }
    return 'basic';
}

/** أساسي = أي level_type غير optional (لا ربط بمرحلة) */
function bookIsBasic(array $book): bool
{
    return normalizeBookLevelType($book['level_type'] ?? null) === 'basic';
}

function bookIsOptional(array $book): bool
{
    return normalizeBookLevelType($book['level_type'] ?? null) === 'optional';
}

function bookMatchesCoreTrack(array $book, string $track): bool
{
    return bookMatchesTrack($book, $track) && bookIsBasic($book);
}

function bookMatchesOptionalTrack(array $book, string $track): bool
{
    return bookMatchesTrack($book, $track) && bookIsOptional($book);
}

function sumTrackPages(array $booksMap, string $track): int
{
    $sum = 0;
    foreach ($booksMap as $book) {
        if (bookMatchesTrack($book, $track)) {
            $sum += (int)$book['total_pages'];
        }
    }
    return $sum;
}

function sumCoreTrackPages(array $booksMap, string $track): int
{
    $sum = 0;
    foreach ($booksMap as $book) {
        if (bookMatchesCoreTrack($book, $track)) {
            $sum += (int)$book['total_pages'];
        }
    }
    return $sum;
}

/** تقدم رسمي في المسار: كتب مكتملة (ضمن المسار) + last_page للكتاب الحالي */
function evalProgressPagesForTrack(array $user, array $booksMap, string $track): int
{
    $completedIds = json_decode($user['completed_books'] ?: '[]', true) ?: [];
    $pages = 0;
    foreach ($completedIds as $bookId) {
        $bookId = (int)$bookId;
        if (!isset($booksMap[$bookId])) {
            continue;
        }
        $book = $booksMap[$bookId];
        if (bookMatchesTrack($book, $track)) {
            $pages += (int)$book['total_pages'];
        }
    }

    $currentBookId = (int)($user['current_book_id'] ?? 0);
    if ($currentBookId > 0 && isset($booksMap[$currentBookId])) {
        $current = $booksMap[$currentBookId];
        if (bookMatchesTrack($current, $track)) {
            $pages += (int)($user['last_page'] ?? 0);
        }
    }

    return $pages;
}

/** تقدم رسمي للكتب الأساسية فقط (بطاقة الطالب / ختم المسار) */
function evalProgressPagesForCoreTrack(array $user, array $booksMap, string $track): int
{
    $completedIds = json_decode($user['completed_books'] ?: '[]', true) ?: [];
    $pages = 0;
    foreach ($completedIds as $bookId) {
        $bookId = (int)$bookId;
        if (!isset($booksMap[$bookId])) {
            continue;
        }
        $book = $booksMap[$bookId];
        if (bookMatchesCoreTrack($book, $track)) {
            $pages += (int)$book['total_pages'];
        }
    }

    $currentBookId = (int)($user['current_book_id'] ?? 0);
    if ($currentBookId > 0 && isset($booksMap[$currentBookId])) {
        $current = $booksMap[$currentBookId];
        if (bookMatchesCoreTrack($current, $track)) {
            $pages += (int)($user['last_page'] ?? 0);
        }
    }

    return $pages;
}

function evalNumeratorFromUser(array $user, array $booksMap): int
{
    return evalProgressPagesForTrack($user, $booksMap, 'full');
}

function trackLabelAr(string $effectiveTrack): string
{
    return $effectiveTrack === 'simplified' ? 'الميسر' : 'الكامل';
}

/** أسابيع الدفعة؛ بدون دفعة: خطة واقعية لا تضغط المقام على أسبوع واحد */
function resolveBatchWeekNow(int $batchId, array $batchWeekCache, int $totalTrackPages, int $weeklyQuota): int
{
    if ($batchId > 0) {
        return max(1, (int)($batchWeekCache[$batchId] ?? 1));
    }
    if ($totalTrackPages <= 0) {
        return 4;
    }
    $weeksToCoverTrack = (int)ceil($totalTrackPages / max(1, $weeklyQuota));
    return max(4, $weeksToCoverTrack);
}

/**
 * مجموع pages_read ضمن المسار، مع إزالة التكرار لنفس الكتاب والأسبوع.
 * $pagesScope: core | optional | all
 */
function sumGamificationPagesForTrack(
    int $userId,
    string $track,
    array $booksMap,
    array $logsRows,
    string $pagesScope = 'all'
): int {
    $deduped = [];
    foreach ($logsRows as $log) {
        if ((int)($log['user_id'] ?? 0) !== $userId) {
            continue;
        }
        $bookId = (int)($log['book_id'] ?? 0);
        if ($bookId <= 0 || !isset($booksMap[$bookId])) {
            continue;
        }
        $book = $booksMap[$bookId];
        if ($pagesScope === 'core') {
            if (!bookMatchesCoreTrack($book, $track)) {
                continue;
            }
        } elseif ($pagesScope === 'optional') {
            if (!bookMatchesOptionalTrack($book, $track)) {
                continue;
            }
        } elseif (!bookMatchesTrack($book, $track)) {
            continue;
        }
        $week = trim((string)($log['week_label'] ?? ''));
        $key = $bookId . '|' . ($week !== '' ? $week : 'no-week');
        $pages = max(0, (int)($log['pages_read'] ?? 0));
        if (!isset($deduped[$key]) || $pages > $deduped[$key]) {
            $deduped[$key] = $pages;
        }
    }
    return (int)array_sum($deduped);
}

/** صفحات اختيارية: سجلات القراءة + كتب اختيارية مكتملة في completed_books (لكل كتاب الأعلى) */
function sumOptionalGamificationPages(
    int $userId,
    string $track,
    array $booksMap,
    array $logsRows,
    array $completedIds
): int {
    $byBookMax = [];

    foreach ($logsRows as $log) {
        if ((int)($log['user_id'] ?? 0) !== $userId) {
            continue;
        }
        $bookId = (int)($log['book_id'] ?? 0);
        if ($bookId <= 0 || !isset($booksMap[$bookId])) {
            continue;
        }
        $book = $booksMap[$bookId];
        if (!bookMatchesOptionalTrack($book, $track)) {
            continue;
        }
        $pages = max(0, (int)($log['pages_read'] ?? 0));
        if (!isset($byBookMax[$bookId]) || $pages > $byBookMax[$bookId]) {
            $byBookMax[$bookId] = $pages;
        }
    }

    foreach ($completedIds as $bookId) {
        $bookId = (int)$bookId;
        if ($bookId <= 0 || !isset($booksMap[$bookId])) {
            continue;
        }
        $book = $booksMap[$bookId];
        if (!bookMatchesOptionalTrack($book, $track)) {
            continue;
        }
        $total = max(0, (int)($book['total_pages'] ?? 0));
        if (!isset($byBookMax[$bookId]) || $total > $byBookMax[$bookId]) {
            $byBookMax[$bookId] = $total;
        }
    }

    return (int)array_sum($byBookMax);
}

function isTrackCurriculumComplete(array $completedIds, array $booksMap, string $track): bool
{
    $completedSet = array_flip(array_map('intval', $completedIds));
    $hasAnyBook = false;
    foreach ($booksMap as $book) {
        if (!bookMatchesTrack($book, $track)) {
            continue;
        }
        $hasAnyBook = true;
        if (!isset($completedSet[(int)$book['id']])) {
            return false;
        }
    }
    return $hasAnyBook;
}

/** ختم المسار الأساسي: كل الكتب basic في المسار مكتملة */
function isCoreTrackCurriculumComplete(array $completedIds, array $booksMap, string $track): bool
{
    $completedSet = array_flip(array_map('intval', $completedIds));
    $hasAnyBook = false;
    foreach ($booksMap as $book) {
        if (!bookMatchesCoreTrack($book, $track)) {
            continue;
        }
        $hasAnyBook = true;
        if (!isset($completedSet[(int)$book['id']])) {
            return false;
        }
    }
    return $hasAnyBook;
}

/** عدد الكتب الأساسية في منهج المسار — O(B) */
function countCoreBooksInTrack(array $booksMap, string $track): int
{
    $n = 0;
    foreach ($booksMap as $book) {
        if (bookMatchesCoreTrack($book, $track)) {
            $n++;
        }
    }
    return $n;
}

/** كتب أساسية مكتملة في المسار — O(B + C) */
function countCompletedCoreBooksInTrack(array $completedIds, array $booksMap, string $track): int
{
    $completedSet = array_flip(array_map('intval', $completedIds));
    $n = 0;
    foreach ($booksMap as $book) {
        if (!bookMatchesCoreTrack($book, $track)) {
            continue;
        }
        if (isset($completedSet[(int)$book['id']])) {
            $n++;
        }
    }
    return $n;
}

/** تقدم تراكمي للمنهج بالكتب الأساسية (0–100%) — لا يعتمد على التاريخ */
function evalCurriculumBooksProgressRate(array $completedIds, array $booksMap, string $track): float
{
    $total = countCoreBooksInTrack($booksMap, $track);
    if ($total <= 0) {
        return 0.0;
    }
    $done = countCompletedCoreBooksInTrack($completedIds, $booksMap, $track);
    return round(min(100, ($done / $total) * 100), 1);
}

/** يحدد مرحلة التقدم 1–10 من نسبة الصفحات — O(1). */
function resolveFinishHintTier(int $progressPercent): int
{
    if ($progressPercent <= 0) {
        return 1;
    }
    if ($progressPercent <= 10) {
        return 2;
    }
    if ($progressPercent <= 20) {
        return 3;
    }
    if ($progressPercent <= 30) {
        return 4;
    }
    if ($progressPercent <= 40) {
        return 5;
    }
    if ($progressPercent <= 50) {
        return 6;
    }
    if ($progressPercent <= 60) {
        return 7;
    }
    if ($progressPercent <= 70) {
        return 8;
    }
    if ($progressPercent <= 85) {
        return 9;
    }
    return 10;
}

/** جملة السطر الثاني لبطاقة موعد الختم — O(1). */
function resolveProgressSentence(int $tier, int $monthsLeft): string
{
    switch ($tier) {
        case 1:
            return 'بداية رحلتك — كل أسبوع قراءة يقربك من ختم المنهج.';
        case 2:
            return 'أنجزت بداية المسار — استمر على وتيرتك.';
        case 3:
            return 'تقدم مبكر جيد — أحسنت البداية.';
        case 4:
            return 'أكملت نحو ربع المسار — ثابر.';
        case 5:
            return 'تجاوزت 30% من المسار — أنت في المسار الصحيح.';
        case 6:
            return 'في منتصف رحلتك — استمر بنفس الوتيرة.';
        case 7:
            return 'تجاوزت نصف المسار — أداء ممتاز.';
        case 8:
            return 'تقدم قوي — أنجزت أكثر من 60% من المسار.';
        case 9:
            return "اقتربت من الختم — متبقي نحو {$monthsLeft} شهراً.";
        case 10:
        default:
            return "أوشكت على الإتمام — متبقي نحو {$monthsLeft} شهراً.";
    }
}

function formatPlanHint(string $trackAr, string $progressSentence): string
{
    return "خطتك هي : {$trackAr}\n{$progressSentence}";
}

function buildFinishHint(
    int $totalTrackPages,
    int $batchWeekNow,
    int $weeklyQuota,
    string $effectiveTrack,
    int $trackGamificationPages,
    bool $trackComplete
): string {
    $trackAr = trackLabelAr($effectiveTrack);

    if ($trackComplete) {
        return "مبروك! أتممت المنهج الأساسي في المسار {$trackAr} 🎉";
    }

    if ($totalTrackPages <= 0 || $batchWeekNow <= 0) {
        return formatPlanHint($trackAr, 'استمر في القراءة الأسبوعية.');
    }

    $pacePages = min(max(0, $trackGamificationPages), $totalTrackPages);
    $remaining = max(0, $totalTrackPages - $pacePages);
    $progressPercent = $totalTrackPages > 0
        ? (int)min(100, round(($pacePages / $totalTrackPages) * 100))
        : 0;

    $pace = max($trackGamificationPages / $batchWeekNow, 1.0);
    $weeksLeft = $remaining > 0
        ? (int)ceil($remaining / max($pace, $weeklyQuota * 0.25))
        : 1;
    $monthsLeft = (int)ceil($weeksLeft / 4.33);
    $maxMonths = $effectiveTrack === 'simplified' ? 20 : 27;
    $monthsLeft = min($maxMonths, max(1, $monthsLeft));

    if ($pace >= $weeklyQuota) {
        return formatPlanHint(
            $trackAr,
            "وتيرتك ممتازة — متبقي نحو {$monthsLeft} شهراً لختم المسار."
        );
    }

    if ($remaining <= 0) {
        $tier = 10;
    } else {
        $tier = resolveFinishHintTier($progressPercent);
    }

    return formatPlanHint($trackAr, resolveProgressSentence($tier, $monthsLeft));
}

function loadLastLogDateByUser(PDO $pdo): array
{
    $map = [];
    try {
        $rows = $pdo->query('SELECT user_id, MAX(`date`) AS last_date FROM reading_logs GROUP BY user_id')->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as $row) {
            $uid = (int)($row['user_id'] ?? 0);
            if ($uid > 0 && !empty($row['last_date'])) {
                $map[$uid] = (string)$row['last_date'];
            }
        }
    } catch (Exception $e) {
        // ignore if date column missing
    }
    return $map;
}

/** آخر رصد أساسي فقط (on_time|late|missed) — O(U) عبر SQL. */
function loadLastPrimaryLogDateByUser(PDO $pdo): array
{
    $map = [];
    try {
        $rows = $pdo->query("
            SELECT user_id,
                   MAX(
                     CASE
                       WHEN `date` IS NOT NULL AND TRIM(CAST(`date` AS CHAR)) <> ''
                         THEN LEFT(CAST(`date` AS CHAR), 10)
                       WHEN week_label IS NOT NULL AND TRIM(week_label) <> ''
                         THEN LEFT(week_label, 10)
                       ELSE NULL
                     END
                   ) AS last_date
            FROM reading_logs
            WHERE (
                submission_status IN ('on_time', 'late', 'missed')
                OR submission_status IS NULL
                OR TRIM(submission_status) = ''
            )
            GROUP BY user_id
        ")->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as $row) {
            $uid = (int)($row['user_id'] ?? 0);
            $last = normalizeWeekLabel($row['last_date'] ?? '');
            if ($uid > 0 && $last !== '') {
                $map[$uid] = $last;
            }
        }
    } catch (Exception $e) {
        try {
            $rows = $pdo->query("
                SELECT user_id, MAX(LEFT(week_label, 10)) AS last_date
                FROM reading_logs
                WHERE (
                submission_status IN ('on_time', 'late', 'missed')
                OR submission_status IS NULL
                OR TRIM(submission_status) = ''
            )
                  AND week_label IS NOT NULL AND TRIM(week_label) <> ''
                GROUP BY user_id
            ")->fetchAll(PDO::FETCH_ASSOC);
            foreach ($rows as $row) {
                $uid = (int)($row['user_id'] ?? 0);
                $last = normalizeWeekLabel($row['last_date'] ?? '');
                if ($uid > 0 && $last !== '') {
                    $map[$uid] = $last;
                }
            }
        } catch (Exception $e2) {
            // ignore
        }
    }
    return $map;
}

/**
 * تعداد مفاتيح أسابيع الرصد من تاريخ إلى اليوم — O(W)، W ≤ maxWeeks.
 * @return list<string>
 */
function enumerateWeekLabelsSince(string $filterFrom, int $startDay, int $maxWeeks = 12): array
{
    $tz = new DateTimeZone(APP_TIMEZONE);
    try {
        $from = new DateTime($filterFrom, $tz);
    } catch (Exception $e) {
        $from = riyadhDateTime();
        $from->modify('-7 days');
    }
    $from->setTime(0, 0, 0);
    $today = riyadhDateTime();
    $today->setTime(0, 0, 0);

    $labels = [];
    $cursor = new DateTime(weekLabelForDate($from, $startDay), $tz);
    $endLabel = weekLabelForDate($today, $startDay);
    while (count($labels) < $maxWeeks && $cursor->format('Y-m-d') <= $endLabel) {
        $labels[] = $cursor->format('Y-m-d');
        $cursor->modify('+7 days');
    }
    return $labels;
}

/**
 * تطبيع مفتاح أسبوع الرصد إلى Y-m-d — O(1).
 */
function normalizeWeekLabel($raw): string
{
    $s = trim((string)$raw);
    if ($s === '') {
        return '';
    }
    if (preg_match('/^(\d{4}-\d{2}-\d{2})/', $s, $m)) {
        return $m[1];
    }
    try {
        $dt = new DateTime($s, new DateTimeZone(APP_TIMEZONE));
        return $dt->format('Y-m-d');
    } catch (Exception $e) {
        return '';
    }
}

/**
 * هل يوجد رصد أساسي يتقاطع مع فترة الفلتر [filterFrom, today]؟
 * زمن: O(W) لأسابيع المشارك.
 *
 * @param array<string, true> $weeksWithPrimary
 */
function hasPrimaryInFilterPeriod(
    array $weeksWithPrimary,
    ?string $lastPrimaryAt,
    string $filterFrom,
    string $todayYmd,
    int $primaryStartDay
): bool {
    $from = normalizeWeekLabel($filterFrom);
    $to = normalizeWeekLabel($todayYmd);
    if ($from === '' || $to === '') {
        return false;
    }

    $last = normalizeWeekLabel($lastPrimaryAt ?? '');
    if ($last !== '' && $last >= $from && $last <= $to) {
        return true;
    }

    if ($last !== '') {
        try {
            $lastWeek = weekLabelForDate(
                new DateTime($last, new DateTimeZone(APP_TIMEZONE)),
                $primaryStartDay
            );
            $weekEnd = (new DateTime($lastWeek, new DateTimeZone(APP_TIMEZONE)))
                ->modify('+6 days')
                ->format('Y-m-d');
            if ($lastWeek <= $to && $weekEnd >= $from) {
                return true;
            }
        } catch (Exception $e) {
            // continue
        }
    }

    foreach ($weeksWithPrimary as $label => $_) {
        $w = normalizeWeekLabel($label);
        if ($w === '') {
            continue;
        }
        try {
            $weekEnd = (new DateTime($w, new DateTimeZone(APP_TIMEZONE)))
                ->modify('+6 days')
                ->format('Y-m-d');
        } catch (Exception $e) {
            continue;
        }
        // الأسبوع يتقاطع مع فترة الفلتر
        if ($w <= $to && $weekEnd >= $from) {
            return true;
        }
    }

    return false;
}

/**
 * متعثرون: بلا أي رصد أساسي خلال فترة الفلتر فقط (وليس التاريخ كله).
 * زمن: O(U·W) حيث W ≤ 12؛ مكان: O(U).
 *
 * @param array<int, string|null> $lastPrimaryByUser
 * @param array<int, array<string, true>> $primaryWeeksByUser
 * @return list<array<string, mixed>>
 */
function buildWeeklyStrugglers(
    array $users,
    array $batchesMap,
    array $lastPrimaryByUser,
    array $primaryWeeksByUser,
    array $memberContextByUser,
    int $windowDays,
    string $filterFrom,
    ?int $strugglerBatchId,
    int $primaryStartDay
): array {
    $windowDays = max(1, min(90, $windowDays));
    $tz = new DateTimeZone(APP_TIMEZONE);
    $today = riyadhDateTime();
    $today->setTime(0, 0, 0);
    $todayYmd = $today->format('Y-m-d');
    $filterFromNorm = normalizeWeekLabel($filterFrom);
    if ($filterFromNorm === '') {
        $filterFromNorm = (clone $today)->modify('-7 days')->format('Y-m-d');
    }

    try {
        $eligibilityCutoff = new DateTime($filterFromNorm, $tz);
        $eligibilityCutoff->setTime(0, 0, 0);
    } catch (Exception $e) {
        $eligibilityCutoff = (clone $today)->modify('-7 days');
    }

    $weekLabels = enumerateWeekLabelsSince($filterFromNorm, $primaryStartDay, 12);
    $students = [];

    foreach ($users as $user) {
        $uid = (int)($user['id'] ?? 0);
        if ($uid <= 0) {
            continue;
        }

        $status = strtolower(trim((string)($user['status'] ?? 'active')));
        if ($status !== '' && $status !== 'active') {
            continue;
        }

        $batchId = (int)($user['batch_id'] ?? 0);
        if ($strugglerBatchId !== null && $strugglerBatchId > 0 && $batchId !== $strugglerBatchId) {
            continue;
        }

        $ctx = $memberContextByUser[$uid] ?? [
            'userCreatedAt' => $user['user_created_at'] ?? null,
            'batchCreatedAt' => $user['batch_created_at'] ?? null,
        ];
        $memberSince = resolveMemberSinceDate(
            $ctx['userCreatedAt'] ?? null,
            $ctx['batchCreatedAt'] ?? null
        );
        if ($memberSince !== null) {
            $memberDay = (clone $memberSince)->setTime(0, 0, 0);
            // انضم بعد بداية فترة الفلتر → لم تُحسب عليه الفترة كاملة
            if ($memberDay > $eligibilityCutoff) {
                continue;
            }
        }

        $weeksWithPrimary = $primaryWeeksByUser[$uid] ?? [];
        $lastPrimary = $lastPrimaryByUser[$uid] ?? null;
        // الشرط الوحيد للدخول: لا رصد أساسي يتقاطع مع فترة الفلتر
        if (hasPrimaryInFilterPeriod(
            $weeksWithPrimary,
            is_string($lastPrimary) ? $lastPrimary : null,
            $filterFromNorm,
            $todayYmd,
            $primaryStartDay
        )) {
            continue;
        }

        $missed = 0;
        foreach ($weekLabels as $label) {
            if (!isset($weeksWithPrimary[$label])) {
                $missed++;
            }
        }

        $batchName = ($batchId > 0 && isset($batchesMap[$batchId]))
            ? (string)$batchesMap[$batchId]['name']
            : '—';
        $lastPrimaryAt = $lastPrimary !== null && trim((string)$lastPrimary) !== ''
            ? substr((string)$lastPrimary, 0, 10)
            : null;

        $students[] = [
            'id' => $uid,
            'name' => (string)($user['name'] ?? ''),
            'phone' => (string)($user['phone'] ?? ''),
            'batchId' => $batchId > 0 ? $batchId : null,
            'batchName' => $batchName,
            'lastPrimaryAt' => $lastPrimaryAt,
            'lastLogAt' => $lastPrimaryAt,
            'missedWeeksSinceFilter' => $missed,
            'filterFrom' => $filterFromNorm,
        ];
    }

    usort($students, function ($a, $b) {
        $missCmp = ($b['missedWeeksSinceFilter'] <=> $a['missedWeeksSinceFilter']);
        if ($missCmp !== 0) {
            return $missCmp;
        }
        return strcmp((string)$a['name'], (string)$b['name']);
    });

    return $students;
}

/** مرجع بدء المتابعة: تاريخ إنشاء المشارك أو الدفعة (الأحدث) — O(1) */
function resolveMemberSinceDate(?string $userCreatedAt, ?string $batchCreatedAt): ?DateTime
{
    $latest = null;
    foreach ([$userCreatedAt, $batchCreatedAt] as $raw) {
        if ($raw === null || trim((string)$raw) === '') {
            continue;
        }
        try {
            $dt = new DateTime((string)$raw);
            if ($latest === null || $dt > $latest) {
                $latest = $dt;
            }
        } catch (Exception $e) {
            // ignore invalid date
        }
    }
    return $latest;
}

/**
 * منقطع: آخر رصد أقدم من (اليوم − N)، أو بلا أي رصد بعد مرور N يوماً من تاريخ الانضمام.
 * مشارك جديد بلا سجلات لا يُحسب منقطعاً قبل انتهاء فترة N — O(U) زمنياً.
 */
function isStudentAtRisk(
    ?string $lastLogDate,
    ?string $userCreatedAt,
    ?string $batchCreatedAt,
    DateTime $cutoff,
    int $inactiveDays
): bool {
    if ($lastLogDate !== null && trim($lastLogDate) !== '') {
        try {
            $lastDt = new DateTime($lastLogDate);
            return $lastDt < $cutoff;
        } catch (Exception $e) {
            return false;
        }
    }

    $memberSince = resolveMemberSinceDate($userCreatedAt, $batchCreatedAt);
    if ($memberSince === null) {
        return false;
    }

    $today = new DateTime('today');
    $graceEnd = (clone $memberSince)->setTime(0, 0, 0)->modify('+' . max(1, $inactiveDays) . ' days');
    return $today >= $graceEnd;
}

function buildAtRiskStudents(
    array $usersDetail,
    array $lastLogByUser,
    int $inactiveDays,
    array $memberContextByUser
): array {
    $cutoff = (new DateTime('today'))->modify('-' . max(1, $inactiveDays) . ' days');
    $students = [];
    foreach ($usersDetail as $u) {
        $uid = (int)$u['id'];
        $last = $lastLogByUser[$uid] ?? null;
        $ctx = $memberContextByUser[$uid] ?? [];
        $isAtRisk = isStudentAtRisk(
            $last,
            $ctx['userCreatedAt'] ?? null,
            $ctx['batchCreatedAt'] ?? null,
            $cutoff,
            $inactiveDays
        );
        if ($isAtRisk) {
            $students[] = [
                'id' => $uid,
                'name' => $u['name'],
                'batchName' => $u['batchName'],
                'trackLabelAr' => $u['trackLabelAr'] ?? '',
                'lastLogAt' => $last,
            ];
        }
    }
    return $students;
}

function buildBookBottleneck(array $filteredUsers, array $booksMap): ?array
{
    $counts = [];
    foreach ($filteredUsers as $user) {
        $bookId = (int)($user['current_book_id'] ?? 0);
        if ($bookId <= 0 || !isset($booksMap[$bookId])) {
            continue;
        }
        $completed = json_decode($user['completed_books'] ?: '[]', true) ?: [];
        $completedIds = array_map('intval', is_array($completed) ? $completed : []);
        if (in_array($bookId, $completedIds, true)) {
            continue;
        }
        $counts[$bookId] = ($counts[$bookId] ?? 0) + 1;
    }
    if (count($counts) === 0) {
        return null;
    }
    arsort($counts);
    $bookId = (int)array_key_first($counts);
    $book = $booksMap[$bookId];
    return [
        'bookId' => $bookId,
        'title' => $book['title'] ?? ('كتاب ' . $bookId),
        'stuckCount' => (int)$counts[$bookId],
        'method' => 'current_book',
    ];
}

try {
    $scopeMe = isset($_GET['scope']) && $_GET['scope'] === 'me';
    if (!$scopeMe) {
        requireStaffRole($pdo);
    }

    $settings = loadSettings($pdo);
    $weeklyQuota = max(1, (int)($settings['weekly_quota'] ?? 75));
    $atRiskInactiveDays = max(1, min(90, (int)($settings['at_risk_inactive_days'] ?? 14)));
    $submissionStartDay = (int)($settings['submission_start_day'] ?? 0);
    $primaryStartDay = resolvePrimaryStartDay($settings);

    $stmtBooks = $pdo->query('SELECT id, title, total_pages, phase_number, track_type, level_type FROM curriculum');
    $allBooks = $stmtBooks->fetchAll(PDO::FETCH_ASSOC);
    $booksMap = [];
    foreach ($allBooks as $book) {
        $booksMap[(int)$book['id']] = $book;
    }

    $stmtBatches = $pdo->query('SELECT id, name, default_track, created_at FROM batches');
    $batches = $stmtBatches->fetchAll(PDO::FETCH_ASSOC);
    $batchesMap = [];
    $batchEpochCache = [];
    $batchWeekCache = [];
    foreach ($batches as $batch) {
        $bid = (int)$batch['id'];
        $batchesMap[$bid] = $batch;
        $epoch = getBatchEpoch($batch['created_at'], $submissionStartDay);
        $batchEpochCache[$bid] = $epoch;
        $batchWeekCache[$bid] = getBatchWeekNow($epoch);
    }

    $stmtUsers = $pdo->query("
        SELECT u.id, u.name, u.phone, u.batch_id, u.completed_books, u.last_page, u.current_book_id,
               u.track_override, u.status, u.created_at AS user_created_at,
               b.default_track, b.created_at AS batch_created_at
        FROM users u
        LEFT JOIN batches b ON b.id = u.batch_id
        WHERE u.role = 'student'
    ");
    $users = $stmtUsers->fetchAll(PDO::FETCH_ASSOC);

    try {
        $logsStmt = $pdo->query("
            SELECT user_id, book_id, week_label, submission_status, pages_read, `date`
            FROM reading_logs
        ");
        $logsRows = $logsStmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (Exception $e) {
        $logsStmt = $pdo->query("
            SELECT user_id, book_id, week_label, submission_status, pages_read
            FROM reading_logs
        ");
        $logsRows = $logsStmt->fetchAll(PDO::FETCH_ASSOC);
    }

    $onTimeWeeksByUser = [];
    $lateWeeksByUser = [];
    $primaryWeeksByUser = [];
    $lastPrimaryFromLogs = [];

    foreach ($logsRows as $log) {
        $uid = (int)$log['user_id'];
        $week = trim((string)($log['week_label'] ?? ''));
        $status = $log['submission_status'] ?? '';
        // لا تدخل سجلات إنجاز سابق / تحفيز اختياري في مؤشر التزام أو المتعثرين
        if ($status === 'extra') {
            continue;
        }
        $isPrimary = ($status === '' || in_array($status, ['on_time', 'late', 'missed'], true));
        if ($isPrimary) {
            $weekNorm = normalizeWeekLabel($week);
            $logDate = trim((string)($log['date'] ?? ''));
            $day = $logDate !== '' ? substr($logDate, 0, 10) : '';
            if ($weekNorm === '' && $day !== '') {
                try {
                    $weekNorm = weekLabelForDate(
                        new DateTime($day, new DateTimeZone(APP_TIMEZONE)),
                        $primaryStartDay
                    );
                } catch (Exception $e) {
                    $weekNorm = '';
                }
            }
            if ($weekNorm !== '') {
                $primaryWeeksByUser[$uid][$weekNorm] = true;
            }
            if ($day !== '') {
                if (!isset($lastPrimaryFromLogs[$uid]) || $day > $lastPrimaryFromLogs[$uid]) {
                    $lastPrimaryFromLogs[$uid] = $day;
                }
            } elseif ($weekNorm !== '' && (!isset($lastPrimaryFromLogs[$uid]) || $weekNorm > $lastPrimaryFromLogs[$uid])) {
                $lastPrimaryFromLogs[$uid] = $weekNorm;
            }
        }
        $weekNormForCommit = normalizeWeekLabel($week);
        if ($weekNormForCommit === '') {
            continue;
        }
        if ($status === 'on_time') {
            $onTimeWeeksByUser[$uid][$weekNormForCommit] = true;
        } elseif ($status === 'late') {
            $lateWeeksByUser[$uid][$weekNormForCommit] = true;
        }
    }

    $filterTrack = isset($_GET['track']) ? strtolower(trim($_GET['track'])) : null;
    if ($filterTrack && !in_array($filterTrack, ['full', 'simplified'], true)) {
        $filterTrack = null;
    }
    $filterBatchId = isset($_GET['batchId']) ? (int)$_GET['batchId'] : null;
    $strugglerBatchId = isset($_GET['strugglerBatchId']) ? (int)$_GET['strugglerBatchId'] : null;
    if ($strugglerBatchId !== null && $strugglerBatchId <= 0) {
        $strugglerBatchId = null;
    }
    $defaultStrugglerFrom = riyadhDateTime();
    $defaultStrugglerFrom->modify('-7 days');
    $strugglerFromRaw = isset($_GET['strugglerFrom']) ? trim((string)$_GET['strugglerFrom']) : '';
    if ($strugglerFromRaw !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $strugglerFromRaw)) {
        $strugglerFrom = $strugglerFromRaw;
    } else {
        $strugglerFrom = $defaultStrugglerFrom->format('Y-m-d');
    }
    $meId = $scopeMe ? (int)($_COOKIE['userId'] ?? 0) : 0;
    $lastLogByUser = $scopeMe ? [] : loadLastLogDateByUser($pdo);
    $lastPrimaryByUser = [];
    if (!$scopeMe) {
        $lastPrimaryByUser = loadLastPrimaryLogDateByUser($pdo);
        foreach ($lastPrimaryFromLogs as $uid => $day) {
            $uid = (int)$uid;
            if (!isset($lastPrimaryByUser[$uid]) || $day > $lastPrimaryByUser[$uid]) {
                $lastPrimaryByUser[$uid] = $day;
            }
        }
    }

    $usersDetail = [];
    $totalBooksCompleted = 0;
    $filteredUsersRaw = [];
    $memberContextByUser = [];

    foreach ($users as $user) {
        $userId = (int)$user['id'];
        if ($scopeMe && $userId !== $meId) {
            continue;
        }

        $batchId = (int)($user['batch_id'] ?? 0);
        if ($filterBatchId && $batchId !== $filterBatchId) {
            continue;
        }

        $effectiveTrack = getEffectiveTrack($user['track_override'] ?? null, $user['default_track'] ?? null);
        if ($filterTrack && $effectiveTrack !== $filterTrack) {
            continue;
        }

        $memberContextByUser[$userId] = [
            'userCreatedAt' => $user['user_created_at'] ?? null,
            'batchCreatedAt' => $user['batch_created_at'] ?? null,
        ];

        $totalTrackPages = sumTrackPages($booksMap, $effectiveTrack);
        $totalCoreTrackPages = sumCoreTrackPages($booksMap, $effectiveTrack);
        $batchWeekNow = resolveBatchWeekNow($batchId, $batchWeekCache, $totalCoreTrackPages, $weeklyQuota);
        $batchWeekSupervisor = resolveBatchWeekNow($batchId, $batchWeekCache, $totalTrackPages, $weeklyQuota);

        $completedIds = json_decode($user['completed_books'] ?: '[]', true) ?: [];
        if (!is_array($completedIds)) {
            $completedIds = [];
        }

        $gamificationPagesCore = sumGamificationPagesForTrack(
            $userId,
            $effectiveTrack,
            $booksMap,
            $logsRows,
            'core'
        );
        $gamificationPagesOptional = sumOptionalGamificationPages(
            $userId,
            $effectiveTrack,
            $booksMap,
            $logsRows,
            $completedIds
        );
        $gamificationPages = $gamificationPagesCore;

        $progressPagesCore = evalProgressPagesForCoreTrack($user, $booksMap, $effectiveTrack);
        $progressPages = evalProgressPagesForTrack($user, $booksMap, $effectiveTrack);
        $batchPaceTargetCore = min($totalCoreTrackPages, $batchWeekNow * $weeklyQuota);
        /** إنجاز مرحلي: تقدم أساسي رسمي ÷ هدف دفعة أساسي */
        $stageCompletionRate = $batchPaceTargetCore > 0
            ? round(min(100, ($progressPagesCore / $batchPaceTargetCore) * 100), 1)
            : 0;

        /** نسبة التقدم التراكمي للدفعة (بطاقة الطالب): صفحات أساسية مسجّلة ÷ هدف الدفعة الأساسي */
        $batchCumulativeRate = $batchPaceTargetCore > 0
            ? round(min(100, ($gamificationPagesCore / $batchPaceTargetCore) * 100), 1)
            : 0;
        $trackCompleted = isCoreTrackCurriculumComplete($completedIds, $booksMap, $effectiveTrack);
        $totalCoreBooksInTrack = countCoreBooksInTrack($booksMap, $effectiveTrack);
        $completedCoreBooksInTrack = countCompletedCoreBooksInTrack($completedIds, $booksMap, $effectiveTrack);
        $curriculumBooksProgressRate = evalCurriculumBooksProgressRate($completedIds, $booksMap, $effectiveTrack);

        $onTimeWeeks = isset($onTimeWeeksByUser[$userId]) ? count($onTimeWeeksByUser[$userId]) : 0;
        $lateWeeks = isset($lateWeeksByUser[$userId]) ? count($lateWeeksByUser[$userId]) : 0;
        $commitmentIndex = round(($onTimeWeeks + 0.5 * $lateWeeks) / $batchWeekNow, 2);
        $completedBooksCount = count($completedIds);
        if ($trackCompleted) {
            $totalBooksCompleted++;
        }
        $filteredUsersRaw[] = $user;

        $usersDetail[] = [
            'id' => $userId,
            'name' => $user['name'],
            'batchId' => $batchId,
            'batchName' => $batchId && isset($batchesMap[$batchId]) ? $batchesMap[$batchId]['name'] : 'بدون دفعة',
            'effectiveTrack' => $effectiveTrack,
            'stageCompletionRate' => $stageCompletionRate,
            'batchCumulativeRate' => $batchCumulativeRate,
            'curriculumBooksProgressRate' => $curriculumBooksProgressRate,
            'completedCoreBooksInTrack' => $completedCoreBooksInTrack,
            'totalCoreBooksInTrack' => $totalCoreBooksInTrack,
            'batchPaceTarget' => $batchPaceTargetCore,
            'gamificationPages' => $gamificationPages,
            'gamificationPagesOptional' => $gamificationPagesOptional,
            'trackCompleted' => $trackCompleted,
            'trackLabelAr' => trackLabelAr($effectiveTrack),
            'commitmentIndex' => $commitmentIndex,
            'completedBooksCount' => $completedBooksCount,
            'totalReadPages' => $progressPages,
            'completionRate' => $stageCompletionRate,
            'batchWeekNow' => $batchWeekNow,
            'expectedFinishHint' => buildFinishHint(
                $totalCoreTrackPages,
                $batchWeekNow,
                $weeklyQuota,
                $effectiveTrack,
                $gamificationPagesCore,
                $trackCompleted
            ),
            'totalCoreTrackPages' => $totalCoreTrackPages,
            'progressPagesCore' => $progressPagesCore,
        ];
    }

    $disciplineLeaderboard = $usersDetail;
    usort($disciplineLeaderboard, fn($a, $b) => $b['commitmentIndex'] <=> $a['commitmentIndex']);
    $disciplineLeaderboard = array_slice($disciplineLeaderboard, 0, 10);

    $eliteReadersLeaderboard = $usersDetail;
    usort($eliteReadersLeaderboard, fn($a, $b) => $b['gamificationPages'] <=> $a['gamificationPages']);
    $eliteReadersLeaderboard = array_slice($eliteReadersLeaderboard, 0, 10);

    $batchStats = [];
    foreach ($batches as $batch) {
        $bid = (int)$batch['id'];
        $batchUsers = array_filter($usersDetail, fn($u) => $u['batchId'] === $bid);
        $userCount = count($batchUsers);
        $batchStats[] = [
            'batchId' => $bid,
            'batchName' => $batch['name'],
            'studentCount' => $userCount,
            'totalPages' => array_sum(array_column($batchUsers, 'gamificationPages')),
            'avgCompletionRate' => $userCount > 0
                ? round(array_sum(array_column($batchUsers, 'stageCompletionRate')) / $userCount, 1)
                : 0,
            'avgCommitmentIndex' => $userCount > 0
                ? round(array_sum(array_column($batchUsers, 'commitmentIndex')) / $userCount, 2)
                : 0,
        ];
    }

    $count = count($usersDetail);
    $response = [
        'overview' => [
            'totalStudents' => $count,
            'totalBooksCompleted' => $totalBooksCompleted,
            'avgCompletionRate' => $count > 0
                ? round(array_sum(array_column($usersDetail, 'stageCompletionRate')) / $count, 1)
                : 0,
            'avgStageCompletionRate' => $count > 0
                ? round(array_sum(array_column($usersDetail, 'stageCompletionRate')) / $count, 1)
                : 0,
            'avgCommitmentIndex' => $count > 0
                ? round(array_sum(array_column($usersDetail, 'commitmentIndex')) / $count, 2)
                : 0,
            'avgBatchCumulativeRate' => $count > 0
                ? round(array_sum(array_column($usersDetail, 'batchCumulativeRate')) / $count, 1)
                : 0,
        ],
        'usersDetail' => $usersDetail,
        'batchStats' => $batchStats,
        'disciplineLeaderboard' => $disciplineLeaderboard,
        'eliteReadersLeaderboard' => $eliteReadersLeaderboard,
        'topCommitted' => array_map(fn($u) => [
            'name' => $u['name'],
            'logs_count' => $u['commitmentIndex'],
        ], $disciplineLeaderboard),
    ];

    if (!$scopeMe) {
        $strugglerWindowDays = 7;
        $atRiskList = buildWeeklyStrugglers(
            $users,
            $batchesMap,
            $lastPrimaryByUser,
            $primaryWeeksByUser,
            $memberContextByUser,
            $strugglerWindowDays,
            $strugglerFrom,
            $strugglerBatchId,
            $primaryStartDay
        );
        $response['supervisorIndicators'] = [
            'atRisk' => [
                'count' => count($atRiskList),
                'windowDays' => $strugglerWindowDays,
                'filterFrom' => $strugglerFrom,
                'batchId' => $strugglerBatchId,
                'experimental' => true,
                'students' => $atRiskList,
            ],
            'bookBottleneck' => buildBookBottleneck($filteredUsersRaw, $booksMap),
        ];
        $response['filters'] = [
            'batchId' => $filterBatchId,
            'track' => $filterTrack,
            'strugglerFrom' => $strugglerFrom,
            'strugglerBatchId' => $strugglerBatchId,
        ];
    }

    if ($scopeMe) {
        $me = $usersDetail[0] ?? null;
        echo json_encode(['me' => $me], JSON_UNESCAPED_UNICODE);
    } else {
        echo json_encode($response, JSON_UNESCAPED_UNICODE);
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
}

ob_end_flush();
