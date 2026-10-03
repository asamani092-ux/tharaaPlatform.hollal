import { useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowLeft, CalendarDays } from "lucide-react";
import { ar } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AtRiskStudent } from "@/lib/analyticsQuery";
import { formatArDate, parseYmd, riyadhYmd, toYmd } from "@/lib/analyticsQuery";
import { buildStrugglerWhatsAppUrl } from "@/lib/whatsappLink";
import { WhatsAppIcon } from "@/components/admin/WhatsAppIcon";
import { cn } from "@/lib/utils";

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
  variant?: "full" | "teaser";
  activeTotal?: number;
  coveredCount?: number;
  coveredPrimaryCount?: number;
  coveredExtraOnlyCount?: number;
  primaryDayAr?: string;
  primaryDayFromSettings?: boolean;
  lastPrimaryDay?: string;
  filterFrom?: string | null;
  filterTo?: string | null;
};

function formatLastPrimary(value: string | null | undefined): string {
  if (!value || value.trim() === "") return "لا يوجد";
  return formatArDate(value.slice(0, 10));
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

function presetClass(active: boolean): string {
  return cn(
    "min-h-10 px-3 text-xs",
    active
      ? "bg-[var(--primary-600)] text-white hover:bg-[var(--primary-800)]"
      : "bg-[var(--bg-primary)]"
  );
}

export function StrugglersTeaserCard({
  count,
  windowDays = 7,
  isLoading = false,
  primaryDayAr,
  filterFrom,
}: {
  count: number;
  windowDays?: number;
  isLoading?: boolean;
  primaryDayAr?: string;
  filterFrom?: string | null;
}) {
  return (
    <Card className="border-[var(--error-600)]/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex flex-wrap items-center gap-2 text-[var(--error-600)]">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>متعثرون منذ آخر يوم رصد</span>
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
          بلا رصد أساسي أو إضافي من {primaryDayAr || "يوم الرصد"}{" "}
          {filterFrom ? `(${formatArDate(filterFrom)})` : ""} حتى اليوم
          {windowDays > 1 ? ` — ${windowDays} أيام` : ""}.
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
  activeTotal,
  coveredCount,
  coveredPrimaryCount,
  coveredExtraOnlyCount,
  primaryDayAr,
  primaryDayFromSettings,
  lastPrimaryDay,
  filterFrom,
  filterTo,
}: Props) {
  const [visible, setVisible] = useState(INITIAL_VISIBLE);
  const [calOpen, setCalOpen] = useState(false);
  const rows = useMemo(() => students.slice(0, visible), [students, visible]);
  const hasMore = students.length > visible;

  const effectiveFrom = strugglerFrom || filterFrom || lastPrimaryDay || "";
  const todayYmd = riyadhYmd(0);
  const sevenYmd = riyadhYmd(-7);
  const selectedDate = parseYmd(effectiveFrom);
  const todayDate = parseYmd(todayYmd);

  const activePreset =
    lastPrimaryDay && effectiveFrom === lastPrimaryDay
      ? "primary"
      : effectiveFrom === todayYmd
        ? "today"
        : effectiveFrom === sevenYmd
          ? "seven"
          : "custom";

  if (variant === "teaser") {
    return (
      <StrugglersTeaserCard
        count={count}
        windowDays={windowDays}
        isLoading={isLoading}
        primaryDayAr={primaryDayAr}
        filterFrom={filterFrom}
      />
    );
  }

  return (
    <Card className="border-[var(--error-600)]/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex flex-wrap items-center gap-2 text-[var(--error-600)]">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>متعثرون منذ تاريخ الفلتر</span>
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
          من أرسل رصداً أساسياً أو إنجازاً إضافياً بتاريخ داخل الفترة يخرج من القائمة، حتى لو كان خارج يوم الرصد.
        </p>
        {!isLoading && activeTotal != null ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3 text-[11px] text-[var(--text-secondary)] space-y-1 leading-relaxed">
            <p>
              النشطون ({activeTotal}) − أساسي ({coveredPrimaryCount ?? 0}) − إضافي فقط ({coveredExtraOnlyCount ?? 0}) ={" "}
              <span className="font-semibold tabular-nums text-[var(--error-600)]">{count}</span>
            </p>
            <p>
              الفترة: {formatArDate(effectiveFrom)} → {formatArDate(filterTo || todayYmd)}
              {windowDays ? ` (${windowDays} يوم)` : ""}
            </p>
            <p>
              يوم الرصد:{" "}
              <span className="font-semibold text-[var(--text-primary)]">
                {primaryDayAr || "—"}
              </span>
              {primaryDayFromSettings === false
                ? " (افتراضي: لم يُحفظ في الإعدادات)"
                : " (من الإعدادات)"}
              {lastPrimaryDay ? ` — آخره ${formatArDate(lastPrimaryDay)}` : ""}
            </p>
            <p>المغطّون إجمالاً: {coveredCount ?? 0}</p>
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          <div className="space-y-1.5">
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
          <div className="space-y-1.5">
            <Label className="text-xs text-[var(--text-secondary)]">من تاريخ (حتى اليوم)</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={activePreset === "primary" ? "default" : "outline"}
                className={presetClass(activePreset === "primary")}
                onClick={() => onFromChange("")}
              >
                آخر يوم رصد
              </Button>
              <Button
                type="button"
                variant={activePreset === "seven" ? "default" : "outline"}
                className={presetClass(activePreset === "seven")}
                onClick={() => onFromChange(sevenYmd)}
              >
                آخر 7 أيام
              </Button>
              <Button
                type="button"
                variant={activePreset === "today" ? "default" : "outline"}
                className={presetClass(activePreset === "today")}
                onClick={() => onFromChange(todayYmd)}
              >
                اليوم
              </Button>
            </div>
            <Popover open={calOpen} onOpenChange={setCalOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full min-h-12 justify-between text-right font-normal"
                >
                  <span>{formatArDate(effectiveFrom)}</span>
                  <CalendarDays className="w-4 h-4 shrink-0 opacity-70" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-2" align="start" dir="rtl">
                <Calendar
                  mode="single"
                  locale={ar}
                  dir="rtl"
                  selected={selectedDate}
                  defaultMonth={selectedDate}
                  onSelect={(day) => {
                    if (!day) return;
                    onFromChange(toYmd(day));
                    setCalOpen(false);
                  }}
                  disabled={todayDate ? { after: todayDate } : undefined}
                />
              </PopoverContent>
            </Popover>
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
                    <TableHead className="text-center">آخر رصد</TableHead>
                    <TableHead className="text-center">تعثرات منذ الفلتر</TableHead>
                    <TableHead className="text-center">تواصل</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>{s.batchName || "—"}</TableCell>
                      <TableCell className="text-center">
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
                    آخر رصد: {formatLastPrimary(s.lastPrimaryAt ?? s.lastLogAt)}
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
