import { useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AtRiskStudent } from "@/lib/analyticsQuery";
import { buildStrugglerWhatsAppUrl } from "@/lib/whatsappLink";
import { WhatsAppIcon } from "@/components/admin/WhatsAppIcon";

const INITIAL_VISIBLE = 30;

type BatchOption = { id: number; name: string };

type Props = {
  students: AtRiskStudent[];
  count: number;
  windowDays: number;
  batches?: BatchOption[];
  strugglerBatchId: string;
  strugglerFrom: string;
  onBatchChange: (value: string) => void;
  onFromChange: (value: string) => void;
  isLoading?: boolean;
  compact?: boolean;
  /** teaser: ملخص + زر انتقال فقط */
  variant?: "full" | "teaser";
};

function formatLastPrimary(value: string | null | undefined): string {
  if (!value || value.trim() === "") return "لا يوجد";
  return value.slice(0, 10);
}

function WhatsAppButton({ student }: { student: AtRiskStudent }) {
  const url = buildStrugglerWhatsAppUrl(
    student.phone,
    student.name,
    student.lastPrimaryAt ?? student.lastLogAt
  );
  const disabled = !url;

  return (
    <Button
      type="button"
      size="sm"
      variant={disabled ? "outline" : "default"}
      className={[
        "min-h-10 gap-1.5",
        disabled
          ? "opacity-60"
          : "bg-[#25D366] hover:bg-[#1ebe57] text-white border-transparent",
      ].join(" ")}
      disabled={disabled}
      title={disabled ? "رقم الجوال غير صالح" : "فتح واتساب"}
      onClick={() => {
        if (url) window.open(url, "_blank", "noopener,noreferrer");
      }}
    >
      <WhatsAppIcon className="w-4 h-4" />
      <span className="hidden sm:inline">واتساب</span>
    </Button>
  );
}

/** بطاقة ملخص لنظرة عامة / الإحصائيات — O(1). */
export function StrugglersTeaserCard({
  count,
  windowDays = 7,
  isLoading = false,
}: {
  count: number;
  windowDays?: number;
  isLoading?: boolean;
}) {
  return (
    <Card className="border-[var(--error-600)]/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex flex-wrap items-center gap-2 text-[var(--error-600)]">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>متعثرون الأسبوع الماضي ({windowDays} أيام)</span>
          <span className="text-[10px] font-normal px-2 py-0.5 rounded-md border border-[var(--error-600)]/40 text-[var(--error-600)]">
            تجريبي
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-2xl font-bold text-[var(--error-600)] tabular-nums">
          {isLoading ? "..." : count}
        </p>
        <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
          بلا رصد أساسي خلال آخر {windowDays} أيام.
        </p>
        <Link href="/admin/strugglers">
          <Button type="button" variant="secondary" className="w-full sm:w-auto gap-2 min-h-10">
            عرض القائمة
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

export function WeeklyStrugglersCard({
  students,
  count,
  windowDays,
  batches = [],
  strugglerBatchId,
  strugglerFrom,
  onBatchChange,
  onFromChange,
  isLoading = false,
  compact = false,
  variant = "full",
}: Props) {
  const [visible, setVisible] = useState(INITIAL_VISIBLE);
  const rows = useMemo(() => students.slice(0, visible), [students, visible]);
  const hasMore = students.length > visible;

  if (variant === "teaser") {
    return (
      <StrugglersTeaserCard count={count} windowDays={windowDays} isLoading={isLoading} />
    );
  }

  return (
    <Card className="border-[var(--error-600)]/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex flex-wrap items-center gap-2 text-[var(--error-600)]">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>متعثرون الأسبوع الماضي ({windowDays} أيام)</span>
          <span className="text-[10px] font-normal px-2 py-0.5 rounded-md border border-[var(--error-600)]/40 text-[var(--error-600)]">
            تجريبي
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <p className="text-2xl font-bold text-[var(--error-600)] ml-auto tabular-nums">
            {isLoading ? "..." : count}
          </p>
        </div>
        <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
          بلا رصد أساسي خلال آخر {windowDays} أيام. المشارك الجديد يُستثنى حتى انتهاء النافذة.
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="space-y-1.5 flex-1 min-w-[140px]">
            <Label className="text-xs text-[var(--text-secondary)]">الدفعة</Label>
            <Select value={strugglerBatchId} onValueChange={onBatchChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="كل الدفعات" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الدفعات</SelectItem>
                {batches.map((b) => (
                  <SelectItem key={b.id} value={b.id.toString()}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 flex-1 min-w-[160px]">
            <Label className="text-xs text-[var(--text-secondary)]">احسب التعثرات منذ</Label>
            <Input
              type="date"
              dir="ltr"
              value={strugglerFrom}
              onChange={(e) => onFromChange(e.target.value)}
              className="text-left"
            />
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-center text-[var(--text-secondary)] py-6">جاري التحميل...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-center text-[var(--text-secondary)] py-6">لا يوجد متعثرون في الفلتر</p>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader className="bg-[var(--bg-secondary)]">
                  <TableRow>
                    <TableHead className="text-right">الاسم</TableHead>
                    <TableHead className="text-right">الدفعة</TableHead>
                    <TableHead className="text-center">آخر رصد أساسي</TableHead>
                    <TableHead className="text-center">تعثرات منذ الفلتر</TableHead>
                    <TableHead className="text-center">تواصل</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>{s.batchName || "—"}</TableCell>
                      <TableCell className="text-center tabular-nums">
                        {formatLastPrimary(s.lastPrimaryAt ?? s.lastLogAt)}
                      </TableCell>
                      <TableCell className="text-center tabular-nums font-semibold">
                        {s.missedWeeksSinceFilter ?? 0}
                      </TableCell>
                      <TableCell className="text-center">
                        <WhatsAppButton student={s} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="md:hidden space-y-3">
              {rows.map((s) => (
                <div
                  key={s.id}
                  className="border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-3 space-y-2"
                >
                  <p className="font-semibold text-[var(--text-primary)]">{s.name}</p>
                  <p className="text-xs text-[var(--text-secondary)]">الدفعة: {s.batchName || "—"}</p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    آخر رصد أساسي:{" "}
                    <span className="tabular-nums">
                      {formatLastPrimary(s.lastPrimaryAt ?? s.lastLogAt)}
                    </span>
                  </p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    تعثرات منذ الفلتر:{" "}
                    <span className="font-semibold tabular-nums">
                      {s.missedWeeksSinceFilter ?? 0}
                    </span>
                  </p>
                  <div className="pt-1">
                    <WhatsAppButton student={s} />
                  </div>
                </div>
              ))}
            </div>

            {hasMore && !compact ? (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setVisible((v) => v + INITIAL_VISIBLE)}
              >
                عرض المزيد ({students.length - visible} متبقٍ)
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
