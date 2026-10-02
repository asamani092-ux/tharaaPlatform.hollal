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
    batchId?: number | null;
    experimental?: boolean;
    students: AtRiskStudent[];
  };
  bookBottleneck?: {
    bookId: number;
    title: string;
    stuckCount: number;
    method: string;
  } | null;
};

/** تاريخ افتراضي لحساب التعثرات: اليوم − 7 — O(1). */
export function defaultStrugglerFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
