export function buildAnalyticsUrl(
  batchId: string,
  track: string,
  extras?: { strugglerBatchId?: string; strugglerFrom?: string }
): string {
  const params = new URLSearchParams();
  if (batchId !== "all") params.set("batchId", batchId);
  if (track !== "all") params.set("track", track);
  if (extras?.strugglerBatchId && extras.strugglerBatchId !== "all") {
    params.set("strugglerBatchId", extras.strugglerBatchId);
  }
  if (extras?.strugglerFrom) {
    params.set("strugglerFrom", extras.strugglerFrom);
  }
  const qs = params.toString();
  return `/api/analytics.php${qs ? `?${qs}` : ""}`;
}

export type AtRiskStudent = {
  id: number;
  name: string;
  phone?: string;
  batchId?: number | null;
  batchName: string;
  lastPrimaryAt?: string | null;
  lastLogAt?: string | null;
  missedWeeksSinceFilter?: number;
};

export type SupervisorIndicators = {
  atRisk?: {
    count: number;
    windowDays: number;
    filterFrom?: string;
    filterTo?: string | null;
    batchId?: number | null;
    experimental?: boolean;
    students: AtRiskStudent[];
    activeTotal?: number;
    coveredCount?: number;
    coveredPrimaryCount?: number;
    coveredExtraOnlyCount?: number;
    primaryDay?: string;
    primaryDayAr?: string;
    primaryDayFromSettings?: boolean;
    lastPrimaryDay?: string;
    formula?: string;
  };
  bookBottleneck?: {
    bookId: number;
    title: string;
    stuckCount: number;
    method: string;
  } | null;
};

/** تاريخ بتوقيت الرياض — O(1). */
export function riyadhYmd(offsetDays = 0): string {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60_000;
  const riyadh = new Date(utc + 3 * 60 * 60_000);
  riyadh.setDate(riyadh.getDate() + offsetDays);
  const y = riyadh.getFullYear();
  const m = String(riyadh.getMonth() + 1).padStart(2, "0");
  const day = String(riyadh.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** عرض تاريخ ميلادي بالعربية — O(1). */
export function formatArDate(ymd?: string | null): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "—";
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat("ar", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    calendar: "gregory",
  }).format(dt);
}

export function parseYmd(ymd: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return undefined;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
