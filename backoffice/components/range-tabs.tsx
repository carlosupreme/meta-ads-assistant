import Link from "next/link";
import { RANGES, type RangeKey } from "@/lib/aggregate";

/** Period presets; every chart, tile and table below follows the selected one. */
export function RangeTabs({ active, basePath, params = {} }: { active: RangeKey; basePath: string; params?: Record<string, string | undefined> }) {
  return <nav className="range-tabs" aria-label="Periodo">
    {RANGES.map((range) => {
      const values: Record<string, string | undefined> = { ...params, range: range.key };
      const query = new URLSearchParams(Object.entries(values).filter((entry): entry is [string, string] => Boolean(entry[1])));
      const selected = range.key === active;
      return <Link key={range.key} href={`${basePath}?${query}`} className={selected ? "selected" : undefined} aria-current={selected ? "page" : undefined}>{range.label}</Link>;
    })}
  </nav>;
}
