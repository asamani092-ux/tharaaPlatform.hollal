import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListBatches } from "@workspace/api-client-react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { AdminLayout } from "@/components/layout";
import { WeeklyStrugglersCard } from "@/components/admin/WeeklyStrugglersCard";
import { buildAnalyticsUrl, defaultStrugglerFrom } from "@/lib/analyticsQuery";

export default function AdminStrugglers() {
  const { data: batches } = useListBatches();
  const [strugglerBatchId, setStrugglerBatchId] = useState("all");
  const [strugglerFrom, setStrugglerFrom] = useState(defaultStrugglerFrom);

  const { data: analytics, isLoading } = useQuery({
    queryKey: ["admin-strugglers", strugglerBatchId, strugglerFrom],
    queryFn: async () => {
      const res = await fetch(
        buildAnalyticsUrl("all", "all", {
          strugglerBatchId,
          strugglerFrom,
        })
      );
      if (!res.ok) throw new Error("فشل جلب قائمة المتعثرين");
      return res.json();
    },
  });

  const atRisk = analytics?.supervisorIndicators?.atRisk;

  return (
    <AdminLayout>
      <div className="space-y-6" dir="rtl">
        <div>
          <h2 className="text-2xl font-bold text-[var(--error-600)] flex flex-wrap items-center gap-2">
            <AlertTriangle className="w-6 h-6" />
            المتعثرون
            <span className="text-[10px] font-normal px-2 py-0.5 rounded-md border border-[var(--error-600)]/40">
              تجريبي
            </span>
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            يظهر من لم يُرسل أي رصد (أساسي أو إضافي) يغطي الفترة حتى اليوم. من رصد اليوم أو أنجز إضافةً داخل الفترة يخرج فوراً.
          </p>
        </div>

        {isLoading && !analytics ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--secondary-400)]" />
            <p className="text-[var(--text-secondary)] text-sm">جاري التحميل...</p>
          </div>
        ) : (
          <WeeklyStrugglersCard
            students={atRisk?.students ?? []}
            count={atRisk?.count ?? 0}
            windowDays={atRisk?.windowDays ?? 7}
            batches={batches}
            strugglerBatchId={strugglerBatchId}
            strugglerFrom={strugglerFrom}
            onBatchChange={setStrugglerBatchId}
            onFromChange={setStrugglerFrom}
            isLoading={isLoading}
            activeTotal={atRisk?.activeTotal}
            coveredCount={atRisk?.coveredCount}
            primaryDayAr={atRisk?.primaryDayAr}
            primaryDayFromSettings={atRisk?.primaryDayFromSettings}
            filterTo={atRisk?.filterTo}
          />
        )}
      </div>
    </AdminLayout>
  );
}
