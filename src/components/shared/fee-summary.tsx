import { EmptyState } from "@/components/shared/empty-state"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { FeeSummary, PaymentDto } from "@/lib/services/fees"
import { formatCurrency, formatDate } from "@/lib/utils/format"

/** Total fee / paid / outstanding / due date — shared by the staff student page and the student portal. */
export function FeeSummaryCards({ summary }: { summary: FeeSummary }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {[
        ["Total fee", formatCurrency(summary.totalFee, summary.currency)],
        ["Total paid", formatCurrency(summary.totalPaid, summary.currency)],
        ["Outstanding", formatCurrency(summary.outstanding, summary.currency)],
        ["Due date", summary.dueDate ? formatDate(summary.dueDate) : "—"],
      ].map(([label, value]) => (
        <Card key={label} size="sm">
          <CardHeader>
            <CardDescription>{label}</CardDescription>
            <CardTitle className="text-lg tabular-nums">{value}</CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}

export function PaymentHistoryTable({ payments, currency }: { payments: PaymentDto[]; currency: string }) {
  if (payments.length === 0) return <EmptyState title="No payments recorded" />
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Reference</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((payment) => (
            <TableRow key={payment.id}>
              <TableCell>{formatDate(payment.paymentDate)}</TableCell>
              <TableCell className="font-mono text-xs">{payment.referenceNumber}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCurrency(payment.amount, currency)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
