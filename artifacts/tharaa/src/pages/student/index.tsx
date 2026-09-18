import { useState, useEffect, useMemo } from "react";
import {
  useGetMe,
  useListCurriculum,
  useGetSettings,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import { StudentLayout } from "@/components/layout";
import {
  BookLevelBadge,
  isBasicCurriculumBook,
} from "@/components/student/book-level-badge";
import { CurriculumDownloadButton } from "@/components/student/curriculum-download-button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Loader2,
  BookOpen,
  CheckCircle,
  TrendingUp,
  Download,
  Info,
  Lightbulb,
  Send,
  Calendar,
  Check,
  Search,
  Trophy,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSubmissionWindow } from "@/lib/submissionWindow";
import {
  type LogRow,
  normalizeRow,
  pagesInRow,
  sumPages,
  quotaRemainingAfter,
  needsMultiBookContinuation,
  suggestPageRange,
  booksAvailableForRollover,
  consumedAllAvailableInBook,
  validatePageRangeAgainstBook,
  clampPageRangeToBook,
  bookTotalPages,
} from "@/lib/weeklyLogEngine";

const WEEKLY_QUOTA = 75;

const STUDENT_SURFACE_CARD =
  "rounded-[var(--radius-xl)] border-2 border-[var(--border-strong)] bg-[var(--bg-primary)] shadow-[var(--shadow-md)]";

const COMPLETED_BADGE_CLASS =
  "inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold "
  + "bg-white text-[var(--success-600)] border border-[var(--success-600)]";


type StudentAnalyticsMe = {
  effectiveTrack?: string;
  /** نسبة التقدم التراكمي للدفعة (SUM pages_read ÷ هدف الدفعة) */
  batchCumulativeRate?: number;
  stageCompletionRate?: number;
  gamificationPages?: number;
  gamificationPagesOptional?: number;
  expectedFinishHint?: string;
  trackCompleted?: boolean;
  trackLabelAr?: string;
};

const STUDENT_ANALYTICS_ME_KEY = ["student-analytics-me"] as const;
const WEEKLY_LOG_STATUS_KEY = ["logs-weekly-status"] as const;
const MY_READING_LOGS_KEY = ["student-my-reading-logs"] as const;
const EMPTY_COMPLETED_BOOKS: number[] = [];

type StudentReadingLog = {
  bookId?: number;
  book_id?: number;
  endPage?: number;
  end_page?: number;
};

const TRACK_COMPLETE_MESSAGES = [
  "بارك الله فيك! أتممت رحلة المعرفة في مسارك — استمر في الإفادة والدعوة.",
  "إنجاز عظيم! ختمت جميع مراحل مسارك — نسأل الله أن ينفع بما قرأت.",
  "مبروك هذا الإنجاز! أنت من فرسان البرنامج الذين أكملوا المسار كاملاً.",
] as const;

/** مسودة أرقام الصفحات: فارغ أو أرقام فقط — O(1). */
function isDigitDraft(value: string): boolean {
  return value === "" || /^\d+$/.test(value);
}

/** تحويل المسودة لرقم عند blur/submit مع احتفاظ بالمنطق السابق — O(1). */
function parsePageDraft(value: string, fallback: number): number {
  if (value.trim() === "") return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function trackCompleteStorageKey(userId: number) {
  return `tharaa_track_congrats_${userId}`;
}

export default function StudentPortal() {
  const queryClient = useQueryClient();
  const { data: session } = useGetMe();
  const user = session?.user;

  const { data: settings } = useGetSettings();
  const weeklyQuota = settings?.weeklyQuota || WEEKLY_QUOTA;
  const settingsExtended = settings as
    | {
        primaryDay?: string;
        submissionStartDay?: number;
        allDaysActive?: boolean;
        curriculumPdfUrl?: string | null;
        curriculumPdfUrlFull?: string | null;
        curriculumPdfUrlSimplified?: string | null;
        priorAchievementEnabled?: boolean;
      }
    | undefined;
  const priorAchievementEnabled = settingsExtended?.priorAchievementEnabled !== false;
  const settingsWithDay = settingsExtended;

  const submissionWindow = useMemo(
    () =>
      getSubmissionWindow({
        allDaysActive: settings?.allDaysActive,
        primaryDay: settingsWithDay?.primaryDay,
        submissionStartDay: settings?.submissionStartDay,
      }),
    [settings, settingsWithDay?.primaryDay, settings?.submissionStartDay, settings?.allDaysActive]
  );

  const { data: books } = useListCurriculum();

  const { data: analyticsPayload, isLoading: isAnalyticsLoading } = useQuery({
    queryKey: STUDENT_ANALYTICS_ME_KEY,
    queryFn: async () => {
      try {
        const res = await fetch("/api/analytics.php?scope=me", { credentials: "include" });
        if (!res.ok) return { me: {} as StudentAnalyticsMe };
        return (await res.json()) as { me: StudentAnalyticsMe };
      } catch {
        return { me: {} as StudentAnalyticsMe };
      }
    },
    enabled: !!session?.authenticated,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const meAnalytics = analyticsPayload?.me;
  const effectiveTrack =
    (user as { effectiveTrack?: string })?.effectiveTrack ??
    meAnalytics?.effectiveTrack ??
    "full";

  const curriculumPdfUrl = useMemo(() => {
    const legacy = settingsExtended?.curriculumPdfUrl?.trim() || "";
    const full = settingsExtended?.curriculumPdfUrlFull?.trim() || legacy;
    const simplified =
      settingsExtended?.curriculumPdfUrlSimplified?.trim() || legacy;
    return effectiveTrack === "simplified" ? simplified : full;
  }, [settingsExtended, effectiveTrack]);

  const matchesTrack = (b: { trackType?: string }) =>
    b.trackType === "both" || b.trackType === effectiveTrack;

  const trackBooks = useMemo(
    () => (books ?? []).filter((b) => matchesTrack(b as { trackType?: string })),
    [books, effectiveTrack]
  );

  const coreTrackBooks = useMemo(
    () => trackBooks.filter((b) => isBasicCurriculumBook(b)),
    [trackBooks]
  );

  const { data: weeklyLogStatus } = useQuery({
    queryKey: WEEKLY_LOG_STATUS_KEY,
    queryFn: async () => {
      const res = await fetch("/api/logs.php?id=status", { credentials: "include" });
      if (!res.ok) return { hasPrimaryThisWeek: false };
      return (await res.json()) as { hasPrimaryThisWeek?: boolean };
    },
    enabled: !!session?.authenticated,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const { data: myReadingLogs } = useQuery({
    queryKey: MY_READING_LOGS_KEY,
    queryFn: async () => {
      const res = await fetch("/api/logs.php?id=my", { credentials: "include" });
      if (!res.ok) return [] as StudentReadingLog[];
      const data = await res.json();
      return Array.isArray(data) ? (data as StudentReadingLog[]) : [];
    },
    enabled: !!session?.authenticated,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  /** آخر صفحة لكل كتاب: bookProgress من /me + reading_logs — O(n). */
  const maxEndPageByBookId = useMemo(() => {
    const map = new Map<number, number>();
    const fromMe = (user as { bookProgress?: Record<string, number> } | undefined)
      ?.bookProgress;
    if (fromMe && typeof fromMe === "object") {
      for (const [key, value] of Object.entries(fromMe)) {
        const bookId = Number(key);
        const endPage = Number(value);
        if (!Number.isFinite(bookId) || bookId <= 0) continue;
        if (!Number.isFinite(endPage) || endPage <= 0) continue;
        map.set(bookId, endPage);
      }
    }
    for (const log of myReadingLogs ?? []) {
      const bookId = Number(log.bookId ?? log.book_id);
      const endPage = Number(log.endPage ?? log.end_page);
      if (!Number.isFinite(bookId) || bookId <= 0) continue;
      if (!Number.isFinite(endPage) || endPage <= 0) continue;
      const prev = map.get(bookId) ?? 0;
      if (endPage > prev) map.set(bookId, endPage);
    }
    return map;
  }, [myReadingLogs, user]);

  const completedBookIds: number[] = user?.completedBooks ?? EMPTY_COMPLETED_BOOKS;
  const completedBookIdSet = useMemo(() => new Set<number>(completedBookIds), [completedBookIds]);

  const phaseStats = useMemo(() => {
    const totalsByPhase = new Map<number, { total: number; completed: number }>();
    for (const b of coreTrackBooks) {
      const phase = b.phaseNumber;
      const row = totalsByPhase.get(phase) ?? { total: 0, completed: 0 };
      row.total += 1;
      if (completedBookIdSet.has(b.id)) row.completed += 1;
      totalsByPhase.set(phase, row);
    }
    const phases = Array.from(totalsByPhase.keys()).sort((a, b) => a - b);
    if (phases.length === 0) return [{ phase: 1, percent: 0 }];
    return phases.map((phase) => {
      const { total, completed } = totalsByPhase.get(phase)!;
      return { phase, percent: total > 0 ? Math.round((completed / total) * 100) : 0 };
    });
  }, [coreTrackBooks, completedBookIdSet]);

  const [viewPhase, setViewPhase] = useState<number>(1);
  const [bookId, setBookId] = useState<string>("");
  const [startPage, setStartPage] = useState<number>(1);
  const [endPage, setEndPage] = useState<number>(weeklyQuota);
  /** مسودة نصية أثناء الكتابة — تسمح بالفراغ دون فرض رقم فوري. */
  const [startPageInput, setStartPageInput] = useState<string>("1");
  const [endPageInput, setEndPageInput] = useState<string>(String(weeklyQuota));
  const [reflection, setReflection] = useState("");
  const [showReflection, setShowReflection] = useState(false);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [nextBookIdForRollover, setNextBookIdForRollover] = useState<string>("");
  const [rolloverEndPage, setRolloverEndPage] = useState(1);
  const [rolloverEndPageInput, setRolloverEndPageInput] = useState<string>("1");
  const [rolloverPagesManuallyEdited, setRolloverPagesManuallyEdited] = useState(false);
  const [pendingSubmissionData, setPendingSubmissionData] = useState<{
    rows: LogRow[];
    reflection?: string;
    remainingPages: number;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [showCustomProgress, setShowCustomProgress] = useState(false);
  const [selectedCustomBooks, setSelectedCustomBooks] = useState<number[]>([]);
  const [priorBookSearch, setPriorBookSearch] = useState("");
  const [isSubmittingCustom, setIsSubmittingCustom] = useState(false);

  const [hasPrimaryThisWeek, setHasPrimaryThisWeek] = useState(false);
  const [isExtraMode, setIsExtraMode] = useState(false);
  /** يمنع useEffect من إعادة حقن الصفحات فوق تعديل المستخدم */
  const [pagesManuallyEdited, setPagesManuallyEdited] = useState(false);
  const [bookFieldError, setBookFieldError] = useState(false);
  const [showTrackCompleteModal, setShowTrackCompleteModal] = useState(false);

  const trackCompletedOnBooks = useMemo(
    () =>
      coreTrackBooks.length > 0 &&
      coreTrackBooks.every((b) => completedBookIdSet.has(b.id)),
    [coreTrackBooks, completedBookIdSet]
  );

  const trackCompleted = meAnalytics?.trackCompleted ?? trackCompletedOnBooks;
  const trackLabelAr =
    meAnalytics?.trackLabelAr ??
    (effectiveTrack === "simplified" ? "الميسر" : "الكامل");

  const trackCompleteMessage = useMemo(() => {
    const idx = user?.id ? user.id % TRACK_COMPLETE_MESSAGES.length : 0;
    return TRACK_COMPLETE_MESSAGES[idx];
  }, [user?.id]);

  type LogCardMode = "track-complete" | "submitted" | "off-day" | "open";
  const logCardMode: LogCardMode = useMemo(() => {
    if (isExtraMode) return "open";
    if (trackCompleted) return "track-complete";
    if (hasPrimaryThisWeek) return "submitted";
    if (!submissionWindow.allowsPrimary) return "off-day";
    return "open";
  }, [
    isExtraMode,
    trackCompleted,
    hasPrimaryThisWeek,
    submissionWindow.allowsPrimary,
  ]);

  useEffect(() => {
    if (!trackCompleted || !user?.id) return;
    const key = trackCompleteStorageKey(user.id);
    if (localStorage.getItem(key) === "1") return;
    setShowTrackCompleteModal(true);
    localStorage.setItem(key, "1");
  }, [trackCompleted, user?.id]);

  useEffect(() => {
    if (user?.phaseNumber) setViewPhase(user.phaseNumber);
  }, [user?.phaseNumber]);

  useEffect(() => {
    if (!weeklyLogStatus?.hasPrimaryThisWeek) return;
    setHasPrimaryThisWeek(true);
  }, [weeklyLogStatus?.hasPrimaryThisWeek]);

  const displayedPhaseBooks = trackBooks.filter((b) => b.phaseNumber === viewPhase);
  const displayedPhaseCoreBooks = displayedPhaseBooks.filter((b) =>
    isBasicCurriculumBook(b)
  );
  const availableBooks = displayedPhaseBooks.filter(
    (b) => !completedBookIds.includes(b.id)
  );
  const availableCoreBooks = displayedPhaseCoreBooks.filter(
    (b) => !completedBookIds.includes(b.id)
  );
  const availableBooksCore = availableBooks.filter((b) => isBasicCurriculumBook(b));
  const availableBooksOptional = availableBooks.filter(
    (b) => !isBasicCurriculumBook(b)
  );

  const bookIdIsInAvailableList = useMemo(
    () => !!bookId && availableBooks.some((b) => b.id.toString() === bookId),
    [bookId, availableBooks]
  );

  const selectBookValue = bookIdIsInAvailableList ? bookId : undefined;

  const priorBooksNotCompleted = useMemo(
    () => trackBooks.filter((b) => !completedBookIds.includes(b.id)),
    [trackBooks, completedBookIds]
  );

  const priorBooksFiltered = useMemo(() => {
    const q = priorBookSearch.trim().toLowerCase();
    if (!q) return priorBooksNotCompleted;
    return priorBooksNotCompleted.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        (b.bookCode?.toLowerCase().includes(q) ?? false)
    );
  }, [priorBooksNotCompleted, priorBookSearch]);

  const lastPageForBook = (book: { id: number }) => {
    const fromLogs = maxEndPageByBookId.get(book.id) ?? 0;
    if (user?.currentBookId === book.id) {
      return Math.max(user?.lastPage ?? 0, fromLogs);
    }
    return fromLogs;
  };

  const userCurrentBook = user?.currentBookId
    ? trackBooks.find((b) => b.id === user.currentBookId)
    : null;
  const isCurrentBookValid =
    !!userCurrentBook &&
    isBasicCurriculumBook(userCurrentBook) &&
    !completedBookIds.includes(userCurrentBook.id) &&
    userCurrentBook.phaseNumber === viewPhase;

  const selectedBook =
    availableBooks.find((b) => b.id.toString() === bookId) ??
    displayedPhaseBooks.find((b) => b.id.toString() === bookId);

  const selectedBookIsOptional = !!selectedBook && !isBasicCurriculumBook(selectedBook);
  const capPagesByQuota = !isExtraMode && !selectedBookIsOptional;

  const currentBook = isCurrentBookValid
    ? userCurrentBook
    : availableCoreBooks[0] ?? availableBooks[0];
  const effectiveLastPage = currentBook ? lastPageForBook(currentBook) : 0;
  const remainingInCurrentBook = currentBook
    ? Math.max(0, currentBook.totalPages - effectiveLastPage)
    : 0;

  useEffect(() => {
    setPagesManuallyEdited(false);
  }, [bookId, viewPhase, isExtraMode]);

  /** إزالة bookId إن كان لكتاب مكتمل أو غير موجود في القائمة (يمنع التضليل في Select) */
  useEffect(() => {
    if (!bookId) return;
    if (!availableBooks.some((b) => b.id.toString() === bookId)) {
      setBookId("");
    }
  }, [availableBooks, bookId]);

  useEffect(() => {
    if (pagesManuallyEdited) return;

    const injectForBook = (book: (typeof trackBooks)[number]) => {
      const range = suggestPageRange(
        book,
        lastPageForBook(book),
        weeklyQuota,
        0,
        capPagesByQuota
      );
      setStartPage(range.startPage);
      setEndPage(range.endPage);
    };

    const picked =
      availableBooks.find((b) => b.id.toString() === bookId) ??
      displayedPhaseBooks.find((b) => b.id.toString() === bookId);
    if (picked) {
      injectForBook(picked);
      return;
    }

    setStartPage(1);
    setEndPage(capPagesByQuota ? weeklyQuota : 1);
  }, [
    bookId,
    viewPhase,
    isExtraMode,
    capPagesByQuota,
    weeklyQuota,
    pagesManuallyEdited,
    availableBooks,
    user?.currentBookId,
    user?.lastPage,
    maxEndPageByBookId,
  ]);

  // مزامنة المسودة مع القيم الرقمية بعد الحقن البرمجي أو التصحيح.
  useEffect(() => {
    setStartPageInput(String(startPage));
  }, [startPage]);

  useEffect(() => {
    setEndPageInput(String(endPage));
  }, [endPage]);

  useEffect(() => {
    setRolloverEndPageInput(String(rolloverEndPage));
  }, [rolloverEndPage]);

  const pickCurrentBookForLog = () => {
    if (!isCurrentBookValid || !userCurrentBook) return;
    setBookFieldError(false);
    setPagesManuallyEdited(false);
    setBookId(userCurrentBook.id.toString());
  };

  const openExtraLogMode = () => {
    setBookId("");
    setBookFieldError(false);
    setPagesManuallyEdited(false);
    setIsExtraMode(true);
  };
  const pagesCount = Math.max(
    0,
    parsePageDraft(endPageInput, endPage) - parsePageDraft(startPageInput, startPage) + 1
  );
  const nextBook =
    availableCoreBooks.find((b) => b.id !== currentBook?.id) ??
    availableBooks.find((b) => b.id !== currentBook?.id);

  const batchCumulativeRate = Math.min(
    100,
    Math.round(
      meAnalytics?.batchCumulativeRate ??
        meAnalytics?.stageCompletionRate ??
        0
    )
  );
  const gamificationPages = meAnalytics?.gamificationPages ?? 0;
  const gamificationPagesOptionalFromApi = meAnalytics?.gamificationPagesOptional ?? 0;
  const optionalPagesFromCompleted = useMemo(
    () =>
      trackBooks
        .filter((b) => !isBasicCurriculumBook(b) && completedBookIds.includes(b.id))
        .reduce((sum, b) => sum + (Number(b.totalPages) || 0), 0),
    [trackBooks, completedBookIds]
  );
  const gamificationPagesOptional = Math.max(
    gamificationPagesOptionalFromApi,
    optionalPagesFromCompleted
  );
  const showOptionalGamification = gamificationPagesOptional > 0;
  const expectedFinishHint = meAnalytics?.expectedFinishHint?.trim() || "—";

  const shareViaWhatsApp = () => {
    if (!reflection.trim() || !selectedBook) {
      toast.error("أكتب فائدة لكي تتمكن من المشاركة");
      return;
    }
    const message = ` *فائدة من كتاب: ${selectedBook.title}*\n\n"${reflection.trim()}"\n\n تمت المشاركة عبر منصة ثراء المعرفة`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
  };

  const submitLogs = async (
    rows: LogRow[],
    mode: "primary" | "extra",
    reflectionText?: string
  ) => {
    if (mode === "primary" && trackCompleted) {
      toast.info("أتممت مسارك — الرصد الأسبوعي غير مطلوب. يمكنك إرسال إنجاز إضافي .");
      return;
    }
    if (isSubmitting || rows.length === 0) return;
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/logs.php", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, reflection: reflectionText, rows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "فشل الرصد");

      if (mode === "primary") {
        setHasPrimaryThisWeek(true);
        setIsExtraMode(false);
        toast.success("شكراً لك! تم تسجيل رصدك الأسبوعي بنجاح");
      } else {
        setIsExtraMode(false);
        toast.success("تم تسجيل الإنجاز الإضافي ");
      }

      setReflection("");
      setShowCompletionModal(false);
      setPendingSubmissionData(null);
      setNextBookIdForRollover("");
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      await queryClient.invalidateQueries({ queryKey: WEEKLY_LOG_STATUS_KEY });
      await queryClient.invalidateQueries({ queryKey: MY_READING_LOGS_KEY });
      await queryClient.invalidateQueries({ queryKey: STUDENT_ANALYTICS_ME_KEY });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "حدث خطأ أثناء الرصد";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const buildValidatedLogRow = (): LogRow | null => {
    setBookFieldError(false);
    if (!bookIdIsInAvailableList || !selectedBook) {
      setBookFieldError(true);
      toast.error("الرجاء اختيار الكتاب من القائمة أولاً");
      return null;
    }

    // اعتماد المسودة عند الإرسال (حتى بلا blur) — نفس منطق الفراغ والسقف.
    const start = Math.max(1, parsePageDraft(startPageInput, 1));
    const endRaw = parsePageDraft(endPageInput, start);
    const lastPage = lastPageForBook(selectedBook);
    const clamped = clampPageRangeToBook(selectedBook, start, endRaw, lastPage);
    setStartPage(clamped.startPage);
    setEndPage(clamped.endPage);
    setStartPageInput(String(clamped.startPage));
    setEndPageInput(String(clamped.endPage));

    const check = validatePageRangeAgainstBook(
      selectedBook,
      clamped.startPage,
      clamped.endPage,
      lastPage
    );
    if (!check.ok) {
      toast.error(check.message ?? "تحقق من نطاق الصفحات");
      if (check.normalizedEnd !== clamped.endPage) {
        setEndPage(check.normalizedEnd);
        setEndPageInput(String(check.normalizedEnd));
      }
      return null;
    }
    if (check.normalizedEnd !== clamped.endPage) {
      setEndPage(check.normalizedEnd);
      setEndPageInput(String(check.normalizedEnd));
    }
    return normalizeRow(selectedBook, clamped.startPage, check.normalizedEnd);
  };

  const openMultiBookDialog = (rows: LogRow[], remainingQuota: number) => {
    setPendingSubmissionData({
      rows,
      reflection: reflection.trim() || undefined,
      remainingPages: remainingQuota,
    });
    setShowCompletionModal(true);
    setNextBookIdForRollover("");
    setRolloverPagesManuallyEdited(false);
    setRolloverEndPage(Math.max(1, remainingQuota));
  };

  const rolloverSelectedBook = useMemo(() => {
    if (!nextBookIdForRollover) return null;
    return (
      availableCoreBooks.find((b) => b.id.toString() === nextBookIdForRollover) ?? null
    );
  }, [nextBookIdForRollover, availableCoreBooks]);

  useEffect(() => {
    if (!pendingSubmissionData || !rolloverSelectedBook || rolloverPagesManuallyEdited) {
      return;
    }
    const alreadyLogged = sumPages(pendingSubmissionData.rows);
    const range = suggestPageRange(
      rolloverSelectedBook,
      lastPageForBook(rolloverSelectedBook),
      weeklyQuota,
      alreadyLogged,
      true
    );
    const clamped = clampPageRangeToBook(
      rolloverSelectedBook,
      range.startPage,
      range.endPage,
      lastPageForBook(rolloverSelectedBook)
    );
    setRolloverEndPage(clamped.endPage);
  }, [
    pendingSubmissionData,
    rolloverSelectedBook,
    rolloverPagesManuallyEdited,
    weeklyQuota,
    user?.currentBookId,
    user?.lastPage,
    maxEndPageByBookId,
  ]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const row = buildValidatedLogRow();
    if (!row || !selectedBook) return;

    if (selectedBookIsOptional) {
      submitLogs([row], "extra", reflection.trim() || undefined);
      return;
    }

    const lastPage = lastPageForBook(selectedBook);
    const { needed, remainingQuota } = needsMultiBookContinuation(
      row,
      selectedBook,
      lastPage,
      weeklyQuota
    );

    if (needed) {
      const others = booksAvailableForRollover(availableCoreBooks, new Set([row.bookId]));
      if (others.length === 0) {
        toast.warning(
          `متبقي ${remainingQuota} صفحة من النصاب ولا توجد كتب أخرى في المرحلة — سيتم حفظ ما قرأته.`
        );
        submitLogs([row], "primary", reflection.trim() || undefined);
        return;
      }
      toast.info(`لم تكتمل ${weeklyQuota} صفحة بعد — أكمل من كتاب آخر أو تخطَّ`);
      openMultiBookDialog([row], remainingQuota);
      return;
    }

    submitLogs([row], "primary", reflection.trim() || undefined);
  };

  const handleExtraSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const row = buildValidatedLogRow();
    if (!row) return;
    submitLogs([row], "extra", reflection.trim() || undefined);
  };

  const confirmRolloverSubmit = (withRollover: boolean) => {
    if (!pendingSubmissionData) return;

    if (!withRollover) {
      submitLogs(pendingSubmissionData.rows, "primary", pendingSubmissionData.reflection);
      return;
    }

    if (!nextBookIdForRollover) {
      toast.error("اختر الكتاب التالي");
      return;
    }

    const nextBook = availableCoreBooks.find(
      (b) => b.id.toString() === nextBookIdForRollover
    );
    if (!nextBook) {
      toast.error("الكتاب غير متاح");
      return;
    }

    const lastPageOnNext = lastPageForBook(nextBook);
    const rolloverStartPage = Math.max(1, lastPageOnNext + 1);
    const endRaw = parsePageDraft(rolloverEndPageInput, rolloverStartPage);
    const clamped = clampPageRangeToBook(
      nextBook,
      rolloverStartPage,
      endRaw,
      lastPageOnNext
    );
    setRolloverEndPage(clamped.endPage);
    setRolloverEndPageInput(String(clamped.endPage));

    const rangeCheck = validatePageRangeAgainstBook(
      nextBook,
      rolloverStartPage,
      clamped.endPage,
      lastPageOnNext
    );
    if (!rangeCheck.ok) {
      toast.error(rangeCheck.message ?? "تحقق من نطاق الصفحات في الكتاب التالي");
      if (rangeCheck.normalizedEnd !== rolloverEndPage) {
        setRolloverEndPage(rangeCheck.normalizedEnd);
      }
      return;
    }

    const rows = [...pendingSubmissionData.rows];
    const nextRow = normalizeRow(nextBook, rolloverStartPage, rangeCheck.normalizedEnd);
    rows.push(nextRow);

    const totalPages = sumPages(rows);
    if (totalPages > weeklyQuota) {
      toast.info(
        `سُجِّل ${totalPages} صفحة (أكثر من النصاب ${weeklyQuota}) — قراءتك الفعلية محفوظة.`
      );
    }

    const stillRemaining = quotaRemainingAfter(rows, weeklyQuota);
    const usedIds = new Set(rows.map((r) => r.bookId));
    const moreBooks = booksAvailableForRollover(availableCoreBooks, usedIds);

    if (
      stillRemaining > 0 &&
      consumedAllAvailableInBook(nextBook, nextRow, lastPageOnNext) &&
      moreBooks.length > 0
    ) {
      toast.info(`متبقي ${stillRemaining} صفحة من النصاب — اختر كتاباً آخر أو تخطَّ`);
      setPendingSubmissionData({
        rows,
        reflection: pendingSubmissionData.reflection,
        remainingPages: stillRemaining,
      });
      setNextBookIdForRollover("");
      setRolloverPagesManuallyEdited(false);
      return;
    }

    submitLogs(rows, "primary", pendingSubmissionData.reflection);
  };

  const rolloverBookOptions = useMemo(() => {
    if (!pendingSubmissionData) return [];
    const used = new Set(pendingSubmissionData.rows.map((r) => r.bookId));
    return booksAvailableForRollover(availableCoreBooks, used);
  }, [pendingSubmissionData, availableCoreBooks]);

  const rolloverPagesCount = Math.max(
    0,
    parsePageDraft(rolloverEndPageInput, rolloverEndPage) -
      Math.max(1, (rolloverSelectedBook ? lastPageForBook(rolloverSelectedBook) : 0) + 1) +
      1
  );

  const submitCustomProgress = async () => {
    if (!priorAchievementEnabled) {
      toast.error("ميزة إنجاز سابق غير متاحة حالياً.");
      return;
    }
    if (trackCompleted) {
      toast.info("أتممت مسارك بالكامل — لا حاجة لإنجاز سابق.");
      return;
    }
    if (selectedCustomBooks.length === 0) {
      toast.error("اختر كتاباً واحداً على الأقل");
      return;
    }
    setIsSubmittingCustom(true);
    try {
      const mergedCompleted = [
        ...new Set([...completedBookIds, ...selectedCustomBooks]),
      ];
      const currentStillInProgress =
        !!user?.currentBookId && !mergedCompleted.includes(user.currentBookId);
      const nextCurrent =
        coreTrackBooks.find((b) => !mergedCompleted.includes(b.id))?.id ?? null;

      const payload: {
        completedBooks: number[];
        newCurrentBookId?: number | null;
      } = { completedBooks: mergedCompleted };
      // لا تستبدل المؤشر إن بقي الكتاب الجاري غير مكتمل.
      if (!currentStillInProgress) {
        payload.newCurrentBookId = nextCurrent;
      }

      const response = await fetch("/api/users.php?id=custom_progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.error || "فشل في تحديث البيانات");
      }
      const result = (await response.json().catch(() => ({}))) as {
        gamificationPagesAdded?: number;
      };
      const added = result.gamificationPagesAdded ?? 0;
      if (added > 0) {
        toast.success(
          `تم اعتماد الكتب السابقة. أُضيف ${added} صفحة   .`
        );
      } else {
        toast.success("تم اعتماد الكتب السابقة بنجاح!");
      }
      setShowCustomProgress(false);
      setSelectedCustomBooks([]);
      setPriorBookSearch("");
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      await queryClient.invalidateQueries({ queryKey: MY_READING_LOGS_KEY });
      await queryClient.invalidateQueries({ queryKey: STUDENT_ANALYTICS_ME_KEY });
      await queryClient.refetchQueries({ queryKey: STUDENT_ANALYTICS_ME_KEY });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "حدث خطأ";
      toast.error(message);
    } finally {
      setIsSubmittingCustom(false);
    }
  };

  const bannerBase =
    "flex gap-2 items-start p-[var(--sp-4)] rounded-[var(--radius-lg)] border border-[var(--border-subtle)]";
  const warningText = "text-[var(--secondary-400)]";
  const successText = "text-[var(--success-600)]";
  const muted = "text-[var(--text-secondary)]";

  return (
    <StudentLayout>
      <div className="max-w-2xl mx-auto space-y-6" dir="rtl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[var(--font-lg)] font-bold">
              مرحباً، <span className={warningText}>{user?.name}</span>
            </h2>
            {!isExtraMode && (
              <p className={`text-[var(--font-xs)] mt-0.5 ${muted}`}>
                النصاب الأسبوعي:{" "}
                <strong className="text-[var(--text-primary)]">{weeklyQuota} صفحة</strong>
              </p>
            )}
          </div>
          {curriculumPdfUrl ? (
            <CurriculumDownloadButton href={curriculumPdfUrl} />
          ) : null}
        </div>

        {trackCompleted && !isExtraMode && (
          <div
            className={`${bannerBase} bg-[hsl(var(--success)/0.08)] border-[var(--success-600)]`}
          >
            <Trophy className="w-5 h-5 text-[var(--success-600)] shrink-0" />
            <span className={successText}>
              أتممت المنهج <strong>الأساسي</strong> في المسار <strong>{trackLabelAr}</strong>.
              الرصد الأسبوعي مغلق؛    .
            </span>
          </div>
        )}

        <Card className={STUDENT_SURFACE_CARD}>
          {logCardMode === "track-complete" ? (
            <CardContent className="pt-10 pb-10 space-y-5 text-center">
              <Trophy className="w-16 h-16 mx-auto text-[var(--secondary-400)]" />
              <div>
                <p className="text-xl font-bold text-[var(--text-primary)]">
                  مبروك! أتممت المسار {trackLabelAr}
                </p>
                <p className="text-sm text-[var(--text-secondary)] mt-3 max-w-md mx-auto leading-relaxed">
                  {trackCompleteMessage}
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="w-full max-w-xs mx-auto h-11 rounded-[var(--radius-lg)]"
                onClick={openExtraLogMode}
              >
                إرسال إنجاز إضافي 
              </Button>
            </CardContent>
          ) : logCardMode === "submitted" ? (
            <CardContent className="pt-10 pb-10 space-y-5 text-center">
              <CheckCircle className="w-14 h-14 mx-auto text-[var(--success-600)]" />
              <div>
                <p className="text-lg font-bold text-[var(--text-primary)]">
                  شكراً لك! تم تسليم رصدك الأسبوعي بنجاح
                </p>
                <p className="text-sm text-[var(--text-secondary)] mt-2 max-w-md mx-auto leading-relaxed">
                  الإنجاز الإضافي يزيد صفحاتك ولا يغيّر تقييمك الأسبوعي المغلق.
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="w-full max-w-xs mx-auto h-11 rounded-[var(--radius-lg)]"
                onClick={openExtraLogMode}
              >
                إرسال إنجاز إضافي
              </Button>
            </CardContent>
          ) : logCardMode === "off-day" ? (
            <CardContent className="pt-10 pb-10 space-y-5 text-center">
              <Calendar className="w-14 h-14 mx-auto text-[var(--secondary-400)]" />
              <div>
                <p className="text-lg font-bold text-[var(--text-primary)]">
                  اليوم ليس موعد الرصد الأسبوعي
                </p>
                <p className="text-sm text-[var(--text-secondary)] mt-2 max-w-md mx-auto leading-relaxed">
                  موعد الرصد: <strong>{submissionWindow.primaryDayLabelAr}</strong>، ويوم التأخير:{" "}
                  <strong>{submissionWindow.lateDayLabelAr}</strong>. اليوم:{" "}
                  <strong>{submissionWindow.todayLabelAr}</strong>. يمكنك إرسال إنجاز إضافي 
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="w-full max-w-xs mx-auto h-11 rounded-[var(--radius-lg)]"
                onClick={openExtraLogMode}
              >
                إرسال إنجاز إضافي
              </Button>
            </CardContent>
          ) : (
            <>
              <CardHeader className="border-b border-[var(--border-subtle)]">
                <CardTitle className="text-[var(--font-lg)] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-[var(--primary-600)]" />
                    {isExtraMode ? "إنجاز إضافي " : "الرصد الأسبوعي"}
                  </div>
                  {isExtraMode && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setPagesManuallyEdited(false);
                        setIsExtraMode(false);
                      }}
                    >
                      رجوع
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>

              <CardContent className="pt-5">
                {isExtraMode && (
                  <div className={`${bannerBase} bg-[var(--bg-tertiary)] mb-4`}>
                    <Info className="w-4 h-4 text-[var(--secondary-400)] shrink-0 mt-0.5" />
                    <span className="text-sm text-[var(--text-secondary)]">
                      إنجاز إضافي  
                      .
                    </span>
                  </div>
                )}

                {!isExtraMode && submissionWindow.kind === "official" && (
                  <div className={`${bannerBase} bg-[var(--bg-primary)] border-[var(--primary-600)] mb-4`}>
                    <Calendar className="w-4 h-4 text-[var(--primary-600)] shrink-0" />
                    <span className="text-sm text-[var(--text-primary)]">
                      اليوم هو <strong>يوم الرصد الرسمي</strong> — النموذج جاهز لإتمام نصابك (
                      {weeklyQuota} صفحة).
                    </span>
                  </div>
                )}

                {!isExtraMode && submissionWindow.kind === "late" && (
                  <div className={`${bannerBase} bg-[var(--bg-tertiary)] mb-4`}>
                    <Calendar className="w-4 h-4 text-[var(--secondary-400)] shrink-0" />
                    <span className="text-sm text-[var(--text-secondary)]">
                      اليوم <strong>يوم التأخير</strong> — يمكنك إتمام رصدك الأسبوعي.
                    </span>
                  </div>
                )}

                {!isExtraMode && submissionWindow.kind === "anytime" && (
                  <div className={`${bannerBase} bg-[var(--bg-tertiary)] mb-4`}>
                    <Info className="w-4 h-4 text-[var(--secondary-400)] shrink-0 mt-0.5" />
                    <span className="text-sm text-[var(--text-secondary)]">
                      الرصد مفعّل طوال أيام الأسبوع.
                    </span>
                  </div>
                )}

                {!isExtraMode &&
                  currentBook &&
                  remainingInCurrentBook < weeklyQuota &&
                  remainingInCurrentBook > 0 && (
                    <div className={`${bannerBase} bg-[var(--bg-tertiary)] mb-4`}>
                      <Lightbulb className="w-4 h-4 text-[var(--secondary-400)] shrink-0 mt-0.5" />
                      <span className="text-[var(--text-secondary)]">
                        متبقي <strong>{remainingInCurrentBook}</strong> صفحة في "{currentBook.title}".
                      </span>
                    </div>
                  )}

                {!isExtraMode &&
                  currentBook &&
                  remainingInCurrentBook === 0 &&
                  nextBook && (
                    <div className={`${bannerBase} bg-[var(--bg-primary)] border-[var(--success-600)] mb-4`}>
                      <CheckCircle className="w-4 h-4 text-[var(--success-600)] shrink-0" />
                      <span className={successText}>
                        أنهيت "{currentBook.title}"! انتقل إلى "{nextBook.title}".
                      </span>
                    </div>
                  )}

                <form
                  onSubmit={isExtraMode ? handleExtraSubmit : handleSubmit}
                  className="space-y-5"
                >
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center mb-1">
                      <Label>الكتاب</Label>
                      <span className="text-[var(--font-xs)] text-[var(--text-secondary)]">
                        مرحلة {viewPhase}
                      </span>
                    </div>
                    <Select
                      value={selectBookValue}
                      onValueChange={(value) => {
                        setBookFieldError(false);
                        setPagesManuallyEdited(false);
                        setBookId(value);
                      }}
                    >
                      <SelectTrigger
                        className={cn(
                          "h-11",
                          bookFieldError &&
                            "border-[var(--error-600)] ring-2 ring-[var(--error-600)]/30"
                        )}
                        aria-invalid={bookFieldError}
                      >
                        <SelectValue placeholder="اختر الكتاب" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableBooksCore.length > 0 && (
                          <SelectGroup>
                            <SelectLabel>أساسي — يحسب في النصاب والإنجاز</SelectLabel>
                            {availableBooksCore.map((book) => (
                              <SelectItem key={book.id} value={book.id.toString()}>
                                <span className="flex items-center gap-2">
                                  <BookLevelBadge levelType={book.levelType} />
                                  <span>
                                    {book.title} ({book.totalPages} ص)
                                  </span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        )}
                        {availableBooksOptional.length > 0 && (
                          <>
                            {availableBooksCore.length > 0 && <SelectSeparator />}
                            <SelectGroup>
                              <SelectLabel>اختياري</SelectLabel>
                              {availableBooksOptional.map((book) => (
                                <SelectItem key={book.id} value={book.id.toString()}>
                                  <span className="flex items-center gap-2">
                                    <BookLevelBadge levelType={book.levelType} />
                                    <span>
                                      {book.title} ({book.totalPages} ص)
                                    </span>
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                    {!isExtraMode && selectedBookIsOptional && (
                      <div
                        className={`${bannerBase} bg-[var(--bg-tertiary)] mt-2`}
                      >
                        <Info className="w-4 h-4 text-[var(--secondary-400)] shrink-0 mt-0.5" />
                        <span className="text-xs text-[var(--text-secondary)] leading-relaxed">
                          كتاب اختياري
                           .
                        </span>
                      </div>
                    )}
                    {isCurrentBookValid && userCurrentBook && !bookIdIsInAvailableList && (
                      <Button
                        type="button"
                        variant="link"
                        className="h-auto p-0 text-xs text-[var(--primary-600)]"
                        onClick={pickCurrentBookForLog}
                      >
                        استخدام كتابي الحالي: {userCurrentBook.title}
                      </Button>
                    )}
                    {bookFieldError && (
                      <p className="text-xs text-[var(--error-600)]">الرجاء اختيار الكتاب أولاً</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>من صفحة</Label>
                      <Input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        min={1}
                        value={startPageInput}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!isDigitDraft(v)) return;
                          setPagesManuallyEdited(true);
                          setStartPageInput(v);
                        }}
                        onBlur={() => {
                          const start = Math.max(1, parsePageDraft(startPageInput, 1));
                          setStartPage(start);
                          setStartPageInput(String(start));
                          if (endPage < start) {
                            setEndPage(start);
                            setEndPageInput(String(start));
                          }
                        }}
                        className="h-11 text-center"
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>إلى صفحة</Label>
                      <Input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        min={startPage}
                        max={selectedBook ? bookTotalPages(selectedBook) : undefined}
                        value={endPageInput}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!isDigitDraft(v)) return;
                          setPagesManuallyEdited(true);
                          setEndPageInput(v);
                        }}
                        onBlur={() => {
                          const start = Math.max(1, parsePageDraft(startPageInput, 1));
                          const endRaw = parsePageDraft(endPageInput, start);
                          if (!selectedBook) {
                            const end = Math.max(endRaw, start);
                            setStartPage(start);
                            setEndPage(end);
                            setStartPageInput(String(start));
                            setEndPageInput(String(end));
                            return;
                          }
                          const clamped = clampPageRangeToBook(
                            selectedBook,
                            start,
                            endRaw,
                            lastPageForBook(selectedBook)
                          );
                          setStartPage(clamped.startPage);
                          setEndPage(clamped.endPage);
                          setStartPageInput(String(clamped.startPage));
                          setEndPageInput(String(clamped.endPage));
                        }}
                        className="h-11 text-center"
                        required
                      />
                    </div>
                  </div>

                  {bookId && !isExtraMode && !selectedBookIsOptional && (
                    <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Progress
                          value={Math.min(100, (pagesCount / weeklyQuota) * 100)}
                          className="h-2 flex-1"
                          tone="gold"
                        />
                        <span className="text-xs font-semibold text-[var(--secondary-400)] tabular-nums shrink-0">
                          {Math.min(100, Math.round((pagesCount / weeklyQuota) * 100))}%
                        </span>
                      </div>
                      <p className="text-[10px] text-[var(--text-secondary)] tabular-nums">
                        النصاب: {pagesCount} / {weeklyQuota} صفحة
                      </p>
                      {selectedBook &&
                        parseInt(bookId, 10) === currentBook?.id &&
                        effectiveLastPage > 0 && (
                          <p className="text-[10px] text-[var(--text-disabled)] leading-relaxed">
                            في «{selectedBook.title}»: {effectiveLastPage}/{selectedBook.totalPages} — متبقي{" "}
                            {remainingInCurrentBook} صفحة
                          </p>
                        )}
                    </div>
                  )}

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => setShowReflection(!showReflection)}
                  >
                    {showReflection ? "إخفاء الفائدة" : "إضافة فائدة (اختياري)"}
                  </Button>

                  {showReflection && (
                    <div className="space-y-2">
                      <Textarea
                        value={reflection}
                        onChange={(e) => setReflection(e.target.value)}
                        className="min-h-[80px]"
                      />
                      {reflection.trim() && (
                        <Button type="button" variant="secondary" onClick={shareViaWhatsApp}>
                          <Send className="w-4 h-4 ml-2" />
                          واتساب
                        </Button>
                      )}
                    </div>
                  )}

                  <Button
                    type="submit"
                    className="w-full h-11"
                    disabled={isSubmitting || !bookIdIsInAvailableList}
                  >
                    {isSubmitting ? (
                      <Loader2 className="animate-spin" />
                    ) : isExtraMode || selectedBookIsOptional ? (
                      selectedBookIsOptional && !isExtraMode
                        ? "تسجيل قراءة اختيارية "
                        : "إرسال إنجاز إضافي"
                    ) : (
                      "اعتماد الرصد"
                    )}
                  </Button>
                </form>
              </CardContent>
            </>
          )}
        </Card>

        <div className="grid grid-cols-3 gap-3">
          <Card className={STUDENT_SURFACE_CARD}>
            <CardContent className="p-4 text-center space-y-2 min-h-[120px] flex flex-col justify-center">
              {isAnalyticsLoading ? (
                <Loader2 className="w-6 h-6 mx-auto animate-spin text-[var(--text-secondary)]" />
              ) : (
                <>
                  <div
                    className="relative mx-auto w-14 h-14 flex items-center justify-center rounded-full border-2 border-[var(--secondary-400)] shadow-[0_0_12px_rgba(202,162,100,0.35)]"
                    aria-hidden
                  >
                    <span className="text-sm font-bold text-[var(--secondary-400)]">
                      {batchCumulativeRate}%
                    </span>
                  </div>
                  <Progress
                    value={batchCumulativeRate}
                    className="h-1.5 [&>div]:bg-[var(--secondary-400)]"
                  />
                </>
              )}
              <p className="text-xs text-[var(--text-secondary)]">نسبة التقدم التراكمي للدفعة</p>
              <p className="text-[10px] text-[var(--text-disabled)] leading-tight mt-0.5">
                صفحاتك المسجّلة مقارنة بخطة الدفعة حتى هذا الأسبوع
              </p>
            </CardContent>
          </Card>

          <Card className={STUDENT_SURFACE_CARD}>
            <CardContent className="p-4 text-center min-h-[120px] flex flex-col justify-center">
              {isAnalyticsLoading ? (
                <Loader2 className="w-6 h-6 mx-auto animate-spin text-[var(--text-secondary)]" />
              ) : showOptionalGamification ? (
                <div className="w-full space-y-3">
                  <div>
                    <TrendingUp className="w-4 h-4 mx-auto mb-1 text-[var(--secondary-400)]" />
                    <p className="text-xl font-bold leading-none">{gamificationPages}</p>
                    <p className="text-[10px] text-[var(--text-secondary)] mt-1">
                      الحصيلة الأساسية
                    </p>
                  </div>
                  <div className="pt-3 border-t border-[var(--border-subtle)] w-full">
                    <p className="text-base font-bold text-[var(--secondary-400)] leading-none">
                      {gamificationPagesOptional}
                    </p>
                    <p className="text-[10px] text-[var(--text-disabled)] mt-1">
                      الحصيلة الاختيارية
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <TrendingUp className="w-4 h-4 mx-auto mb-1 text-[var(--secondary-400)]" />
                  <p className="text-xl font-bold leading-none">{gamificationPages}</p>
                  <p className="text-[10px] text-[var(--text-secondary)] mt-1">أساسي</p>
                </>
              )}
              <p className="text-xs text-[var(--text-secondary)] mt-2">عدد الصفحات</p>
              <p className="text-[10px] text-[var(--text-disabled)] leading-tight">
                مسار {trackLabelAr}
              </p>
            </CardContent>
          </Card>

          <Card className={STUDENT_SURFACE_CARD}>
            <CardContent className="p-4 text-center min-h-[120px] flex flex-col justify-center">
              {isAnalyticsLoading ? (
                <Loader2 className="w-6 h-6 mx-auto animate-spin text-[var(--text-secondary)]" />
              ) : (
                <>
                  <Calendar className="w-4 h-4 mx-auto mb-1 text-[var(--secondary-400)] shrink-0" />
                  <p className="text-xs font-medium leading-snug text-[var(--text-primary)] line-clamp-3 whitespace-pre-line">
                    {expectedFinishHint}
                  </p>
                </>
              )}
              <p className="text-xs text-[var(--text-secondary)] mt-2">موعد الختم</p>
              <p className="text-[10px] text-[var(--text-disabled)] leading-tight">
                تقدير تحفيزي من وتيرة قراءتك
              </p>
            </CardContent>
          </Card>
        </div>

        <div>
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-bold text-sm">كتب المرحلة</h3>
            {!trackCompleted && priorAchievementEnabled && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedCustomBooks([]);
                  setPriorBookSearch("");
                  setShowCustomProgress(true);
                }}
              >
                إنجاز سابق
              </Button>
            )}
          </div>
          <Select value={viewPhase.toString()} onValueChange={(v) => setViewPhase(parseInt(v, 10))}>
            <SelectTrigger className="mb-3">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {phaseStats.map((ps) => (
                <SelectItem key={ps.phase} value={ps.phase.toString()}>
                  المرحلة {ps.phase} ({ps.percent}%)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="grid gap-3">
            {displayedPhaseBooks.map((book) => {
              const isCompleted = completedBookIds.includes(book.id);
              const isCurrent = user?.currentBookId === book.id;
              return (
                <div
                  key={book.id}
                  className={cn(
                    "flex items-center gap-4 p-4 rounded-lg border-2 transition-colors bg-[var(--bg-primary)] shadow-sm",
                    isCompleted
                      ? "border-[var(--success-600)] bg-[hsl(var(--success)/0.08)]"
                      : isCurrent
                        ? "border-[hsl(var(--primary))]"
                        : "border-[var(--border-strong)]"
                  )}
                >
                  <BookOpen className="w-4 h-4 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <BookLevelBadge levelType={book.levelType} />
                      <span className="font-medium truncate">{book.title}</span>
                      {isCompleted && <span className={COMPLETED_BADGE_CLASS}>مكتمل</span>}
                      {isCurrent && !isCompleted && <Badge variant="outline">حالي</Badge>}
                    </div>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {book.bookCode} · {book.totalPages} ص
                    </p>
                  </div>
                  {book.pdfUrl && (
                    <a href={book.pdfUrl} target="_blank" rel="noreferrer">
                      <Download className="w-4 h-4" />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <Dialog open={showTrackCompleteModal} onOpenChange={setShowTrackCompleteModal}>
          <DialogContent className="border-2 border-[var(--success-600)] text-center">
            <DialogHeader>
              <DialogTitle className="text-[var(--success-600)] flex items-center justify-center gap-2">
                <Trophy className="w-6 h-6" />
                ختم المسار {trackLabelAr}
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed px-2">
              {trackCompleteMessage}
            </p>
            <p className="text-xs text-[var(--text-disabled)]">
              أتممت جميع الكتب الأساسية في مسارك. نسأل الله القبول والنفع.
            </p>
            <Button
              className="w-full"
              variant="secondary"
              onClick={() => setShowTrackCompleteModal(false)}
            >
              بارك الله فيك
            </Button>
          </DialogContent>
        </Dialog>

        <Dialog open={showCustomProgress} onOpenChange={setShowCustomProgress}>
          <DialogContent className="border-2 border-[var(--border-strong)]">
            <DialogHeader>
              <DialogTitle>إنجاز سابق</DialogTitle>
            </DialogHeader>
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)]" />
              <Input
                value={priorBookSearch}
                onChange={(e) => setPriorBookSearch(e.target.value)}
                placeholder="ابحث باسم الكتاب أو الرمز..."
                className="h-10 pr-9"
                dir="rtl"
              />
            </div>
            <div className="max-h-[40vh] overflow-y-auto space-y-2">
              {priorBooksFiltered.length === 0 ? (
                <p className="text-sm text-center text-[var(--text-secondary)] py-6">
                  لا توجد كتب مطابقة للبحث
                </p>
              ) : (
                priorBooksFiltered.map((book) => {
                  const isSelected = selectedCustomBooks.includes(book.id);
                  return (
                    <div
                      key={book.id}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "p-3 rounded-lg cursor-pointer border-2 flex items-center justify-between gap-2 transition-all",
                        isSelected
                          ? "border-[hsl(var(--primary))] bg-[var(--bg-tertiary)] ring-2 ring-[hsl(var(--primary))]/25"
                          : "border-[var(--border-strong)] bg-[var(--bg-primary)] hover:border-[var(--border-default)]"
                      )}
                      onClick={() =>
                        setSelectedCustomBooks((prev) =>
                          prev.includes(book.id)
                            ? prev.filter((id) => id !== book.id)
                            : [...prev, book.id]
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedCustomBooks((prev) =>
                            prev.includes(book.id)
                              ? prev.filter((id) => id !== book.id)
                              : [...prev, book.id]
                          );
                        }
                      }}
                    >
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <BookLevelBadge levelType={book.levelType} />
                        <span className="font-medium text-sm truncate">{book.title}</span>
                      </div>
                      {isSelected && (
                        <Check className="w-5 h-5 shrink-0 text-[hsl(var(--primary))]" />
                      )}
                    </div>
                  );
                })
              )}
            </div>
            <Button
              className="w-full mt-4"
              disabled={!selectedCustomBooks.length || isSubmittingCustom}
              onClick={submitCustomProgress}
            >
              اعتماد ({selectedCustomBooks.length})
            </Button>
          </DialogContent>
        </Dialog>

        <Dialog
          open={showCompletionModal}
          onOpenChange={(open) => {
            setShowCompletionModal(open);
            if (!open) {
              setNextBookIdForRollover("");
              setRolloverPagesManuallyEdited(false);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>أكمل النصاب الأسبوعي</DialogTitle>
            </DialogHeader>
            {pendingSubmissionData && (
              <div className="space-y-4">
                <p className="text-sm text-[var(--text-secondary)]">
                  قرأت <strong>{sumPages(pendingSubmissionData.rows)}</strong> من{" "}
                  <strong>{weeklyQuota}</strong> صفحة. متبقي{" "}
                  <strong>{pendingSubmissionData.remainingPages}</strong> صفحة لإكمال النصاب.
                </p>
                {pendingSubmissionData.rows.length > 0 && (
                  <ul className="text-xs text-[var(--text-secondary)] space-y-1 border rounded-lg p-3 bg-[var(--bg-tertiary)]">
                    {pendingSubmissionData.rows.map((r, i) => {
                      const title =
                        trackBooks.find((b) => b.id === r.bookId)?.title ?? `كتاب ${r.bookId}`;
                      return (
                        <li key={`${r.bookId}-${i}`}>
                          {title}: ص {r.startPage}–{r.endPage} ({pagesInRow(r)} ص)
                        </li>
                      );
                    })}
                  </ul>
                )}
                <Select
                  value={nextBookIdForRollover}
                  onValueChange={(value) => {
                    setNextBookIdForRollover(value);
                    setRolloverPagesManuallyEdited(false);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="الكتاب التالي في المرحلة" />
                  </SelectTrigger>
                  <SelectContent>
                    {rolloverBookOptions.map((book) => (
                      <SelectItem key={book.id} value={book.id.toString()}>
                        <span className="flex items-center gap-2">
                          <BookLevelBadge levelType={book.levelType} />
                          <span>
                            {book.title} ({book.totalPages} ص)
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {rolloverSelectedBook && (() => {
                  const rolloverBookTotal = bookTotalPages(rolloverSelectedBook);
                  const rolloverLast = lastPageForBook(rolloverSelectedBook);
                  const rolloverStartPage = Math.max(1, rolloverLast + 1);
                  const applyRolloverRange = (nextEnd: number) => {
                    const clamped = clampPageRangeToBook(
                      rolloverSelectedBook,
                      rolloverStartPage,
                      nextEnd,
                      rolloverLast
                    );
                    setRolloverEndPage(clamped.endPage);
                  };
                  return (
                  <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3 space-y-3">
                    <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                      أدخل الصفحة التي وصلت إليها في «{rolloverSelectedBook.title}» (حد أقصى{" "}
                      <strong>{rolloverBookTotal}</strong> صفحة). يمكنك تسجيل أكثر من المتبقي من
                      النصاب ({pendingSubmissionData.remainingPages} ص) دون تجاوز حجم الكتاب.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">من صفحة</Label>
                        <Input
                          type="number"
                          min={rolloverStartPage}
                          max={rolloverStartPage}
                          value={rolloverStartPage}
                          readOnly
                          disabled
                          className="h-10 text-center opacity-70"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">إلى صفحة</Label>
                        <Input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          min={rolloverStartPage}
                          max={rolloverBookTotal}
                          value={rolloverEndPageInput}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!isDigitDraft(v)) return;
                            setRolloverPagesManuallyEdited(true);
                            setRolloverEndPageInput(v);
                          }}
                          onBlur={() => {
                            const raw = parsePageDraft(
                              rolloverEndPageInput,
                              rolloverStartPage
                            );
                            applyRolloverRange(raw);
                          }}
                          className="h-10 text-center"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-[var(--text-primary)] tabular-nums">
                      هذا الجزء: <strong>{rolloverPagesCount}</strong> صفحة — المجموع بعد الإرسال:{" "}
                      <strong>{sumPages(pendingSubmissionData.rows) + rolloverPagesCount}</strong> /{" "}
                      {weeklyQuota}
                    </p>
                  </div>
                  );
                })()}
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={isSubmitting}
                    onClick={() => confirmRolloverSubmit(false)}
                  >
                    تخطي / إنهاء الرصد
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={!nextBookIdForRollover || isSubmitting}
                    onClick={() => confirmRolloverSubmit(true)}
                  >
                    متابعة
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </StudentLayout>
  );
}
