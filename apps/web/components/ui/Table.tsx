"use client";

import { cn } from "@/lib/cn";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  render?: (row: T) => React.ReactNode;
  className?: string;
}

/**
 * Responsive table: real table on md+ screens, stacked key/value cards on
 * small screens (same columns, no separate mobile markup needed).
 */
export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string;
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
  className?: string;
}) {
  const cell = (row: T, c: Column<T>) => (c.render ? c.render(row) : (row as Record<string, unknown>)[c.key] as React.ReactNode);

  return (
    <div className={className}>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-surface shadow-sm md:block">
        <table className="w-full text-sm">
          <thead className="bg-soft/60">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted",
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "border-t border-line",
                  onRowClick && "cursor-pointer hover:bg-soft/70",
                )}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-4 py-3 align-middle text-inksoft", c.className)}>
                    {cell(row, c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="px-4 py-10">{empty}</div>}
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {rows.map((row, i) => (
          <div
            key={rowKey(row, i)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn(
              "rounded-2xl border border-line bg-surface p-4 shadow-sm",
              onRowClick && "cursor-pointer active:bg-soft",
            )}
          >
            {columns.map((c) => (
              <div key={c.key} className="flex items-start justify-between gap-3 py-1 text-sm">
                <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-faint">
                  {c.header}
                </span>
                <span className="text-right text-inksoft">{cell(row, c)}</span>
              </div>
            ))}
          </div>
        ))}
        {rows.length === 0 && (
          <div className="rounded-2xl border border-line bg-surface px-4 py-10 shadow-sm">{empty}</div>
        )}
      </div>
    </div>
  );
}
