import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListBatches } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, Star, Trophy, Loader2, BookOpen } from "lucide-react";
import { buildAnalyticsUrl } from "@/lib/analyticsQuery";
import { StrugglersTeaserCard } from "@/components/admin/WeeklyStrugglersCard";
import { Link } from "wouter";

function StatCard({
  label,
  value,
  valueClassName = "text-[var(--text-primary)]",
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6 pb-6 px-6">
        <p className="text-[var(--font-sm)] text-[var(--text-secondary)] mb-2">{label}</p>
        <p className={`text-3xl md:text-4xl font-bold ${valueClassName}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

export default function AdminOverview() {
  const { data: batches } = useListBatches();
  const [selectedBatch, setSelectedBatch] = useState("all");
  const [selectedTrack, setSelectedTrack] = useState("all");

  const { data: analytics, isLoading } = useQuery({
    queryKey: ["admin-analytics-overview", selectedBatch, selectedTrack],
    queryFn: async () => {
      const res = await fetch(buildAnalyticsUrl(selectedBatch, selectedTrack));
      if (!res.ok) throw new Error("فشل جلب البيانات");
      return res.json();
    },
  });

  const discipline = analytics?.disciplineLeaderboard ?? [];
  const elite = analytics?.eliteReadersLeaderboard ?? [];
  const indicators = analytics?.supervisorIndicators;
  const atRisk = indicators?.atRisk;
  const bottleneck = indicators?.bookBottleneck;

  const batchLabel =
    selectedBatch === "all"
      ? "كل الدفعات"
      : batches?.find((b: { id: number }) => b.id.toString() === selectedBatch)?.name ?? selectedBatch;
  const trackLabel =
    selectedTrack === "all" ? "كل المسارات" : selectedTrack === "simplified" ? "ميسر" : "كامل";

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="flex flex-col items-center justify-center py-32 gap-4">
          <Loader2 className="w-10 h-10 animate-spin text-[var(--secondary-400)]" />
          <p className="text-[var(--text-secondary)]">جاري التحميل...</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-8 text-right" dir="rtl">
        <div className="flex flex-wrap justify-between items-start gap-4">
          <div>
            <h2 className="text-3xl font-bold flex items-center gap-3 text-[var(--secondary-400)]">
              <TrendingUp className="w-8 h-8" />
              نظرة عامة
            </h2>
            <p className="text-[var(--text-secondary)] text-sm mt-1">
              ملخص مع فلترة الدفعة والمسار —{" "}
              <Link href="/admin/analytics" className="text-[var(--primary-600)] underline">
                التفاصيل والتصدير
              </Link>
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Select value={selectedBatch} onValueChange={setSelectedBatch}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="الدفعة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الدفعات</SelectItem>
                {batches?.map((b: { id: number; name: string }) => (
                  <SelectItem key={b.id} value={b.id.toString()}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedTrack} onValueChange={setSelectedTrack}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="المسار" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المسارات</SelectItem>
                <SelectItem value="full">كامل</SelectItem>
                <SelectItem value="simplified">ميسر</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="text-xs text-[var(--text-disabled)]">
          عرض: {batchLabel} · {trackLabel}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <StrugglersTeaserCard
            count={atRisk?.count ?? 0}
            windowDays={atRisk?.windowDays ?? 1}
            primaryDayAr={atRisk?.primaryDayAr}
            filterFrom={atRisk?.filterFrom}
          />
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-[var(--secondary-400)]" />
                كتب تأخذ وقتاً 
              </CardTitle>
            </CardHeader>
            <CardContent>
              {bottleneck ? (
                <>
                  <p className="font-bold text-[var(--text-primary)]">{bottleneck.title}</p>
                  <p className="text-sm text-[var(--text-secondary)] mt-2">
                    {bottleneck.stuckCount} مشارك عالق على الكتاب الحالي
                  </p>
                </>
              ) : (
                <p className="text-sm text-[var(--text-secondary)]">لا توجد بيانات كافية</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard label="المشاركون" value={analytics?.overview?.totalStudents ?? 0} />
          <StatCard
            label="متوسط إنجاز الدفعة"
            value={`${analytics?.overview?.avgBatchCumulativeRate ?? 0}%`}
            valueClassName="text-[var(--secondary-400)]"
          />
          <StatCard
            label="متوسط الإنجاز المرحلي"
            value={`${analytics?.overview?.avgStageCompletionRate ?? 0}%`}
            valueClassName="text-[var(--secondary-400)]"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardContent className="p-0">
              <div className="px-6 py-4 border-b border-[var(--border-subtle)]">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-[var(--secondary-400)]" />
                  الأكثر التزاماً بالإرسال
                </h3>
              </div>
              <div className="divide-y divide-[var(--border-subtle)]">
                {discipline.length === 0 ? (
                  <p className="p-4 text-sm text-center text-[var(--text-secondary)]">لا توجد بيانات</p>
                ) : (
                  discipline.map((user: { id: number; name: string; commitmentIndex: number }, i: number) => (
                    <div key={user.id} className="flex justify-between items-center py-4 px-6">
                      <span className="font-medium">
                        {i + 1}. {user.name}
                      </span>
                      <span className="text-[var(--secondary-400)] font-bold">{user.commitmentIndex}</span>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="px-6 py-4 border-b border-[var(--border-subtle)]">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Star className="w-5 h-5 text-[var(--secondary-400)]" />
                  الأكثر قراءة بعدد الصفحات
                </h3>
              </div>
              <div className="divide-y divide-[var(--border-subtle)]">
                {elite.length === 0 ? (
                  <p className="p-4 text-sm text-center text-[var(--text-secondary)]">لا توجد بيانات</p>
                ) : (
                  elite.map((user: { id: number; name: string; gamificationPages: number }, i: number) => (
                    <div key={user.id} className="flex justify-between items-center py-4 px-6">
                      <span className="font-medium">
                        {i + 1}. {user.name}
                      </span>
                      <span className="text-[var(--secondary-400)] font-bold">
                        {user.gamificationPages} ص
                      </span>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <div className="px-6 py-4 border-b border-[var(--border-subtle)]">
            <h3 className="text-lg font-semibold">تفاصيل الدفعات (ضمن الفلتر)</h3>
          </div>
          <Table>
            <TableHeader className="bg-[var(--bg-secondary)]">
              <TableRow>
                <TableHead className="text-right">الدفعة</TableHead>
                <TableHead className="text-center">المشاركون</TableHead>
                <TableHead className="text-center">عدد الصفحات </TableHead>
                <TableHead className="text-right w-[240px]">متوسط الإنجاز المرحلي</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analytics?.batchStats?.map((batch: {
                batchId: number;
                batchName: string;
                studentCount: number;
                totalPages: number;
                avgCompletionRate: number;
              }) => (
                <TableRow key={batch.batchId}>
                  <TableCell className="font-semibold">{batch.batchName}</TableCell>
                  <TableCell className="text-center">{batch.studentCount}</TableCell>
                  <TableCell className="text-center">
                    {batch.totalPages?.toLocaleString() ?? 0}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={batch.avgCompletionRate} className="h-2 flex-1" />
                      <span className="text-xs">{batch.avgCompletionRate}%</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </AdminLayout>
  );
}
