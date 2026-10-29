"use client";

import React from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

export interface ChartPoint {
  date: string;
  label: string;
  totalEvents: number;
  hoursBooked: number;
  googleEvents: number;
  notionEvents: number;
  webappEvents: number;
}

interface ActivityChartProps {
  data: ChartPoint[];
  metric?: "totalEvents" | "hoursBooked";
  accentColor?: string;
  themeMode?: "dark" | "light";
  onSelectDate?: (dateIso: string) => void;
}

export function ActivityChart({
  data,
  metric = "totalEvents",
  accentColor = "#D96299",
  themeMode = "dark",
  onSelectDate,
}: ActivityChartProps) {
  const hasAnyActivity =
    data && data.length > 0 && data.some((d) => d.totalEvents > 0);

  if (!hasAnyActivity) {
    return (
      <div className="h-[220px] flex items-center justify-center text-xs text-[var(--text-muted)] border border-dashed border-[var(--border-subtle)] rounded-2xl">
        Sin actividad registrada.
      </div>
    );
  }

  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 10, right: 12, left: -24, bottom: 0 }}
          onClick={(state) => {
            if (state?.activePayload?.[0]?.payload?.date && onSelectDate) {
              onSelectDate(state.activePayload[0].payload.date);
            }
          }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={
              themeMode === "dark"
                ? "rgba(255,255,255,0.05)"
                : "rgba(20,18,30,0.06)"
            }
            vertical={false}
          />
          <XAxis
            dataKey="label"
            stroke={themeMode === "dark" ? "#71717a" : "#827f94"}
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke={themeMode === "dark" ? "#71717a" : "#827f94"}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ stroke: accentColor, strokeOpacity: 0.3, strokeWidth: 1 }}
            contentStyle={{
              backgroundColor:
                themeMode === "dark"
                  ? "rgba(24, 20, 38, 0.96)"
                  : "rgba(255, 255, 255, 0.96)",
              borderColor: accentColor,
              borderRadius: "12px",
              boxShadow: "0 10px 25px rgba(0, 0, 0, 0.25)",
              color: themeMode === "dark" ? "#f4f4f5" : "#14121e",
              fontSize: "12px",
            }}
            labelStyle={{ color: accentColor, fontWeight: 600, marginBottom: 2 }}
          />
          <Line
            type="monotone"
            dataKey={metric === "totalEvents" ? "totalEvents" : "hoursBooked"}
            name={metric === "totalEvents" ? "Citas" : "Horas"}
            stroke={accentColor}
            strokeWidth={2.5}
            dot={{
              r: 3.5,
              fill: accentColor,
              strokeWidth: 2,
              stroke: themeMode === "dark" ? "#181426" : "#ffffff",
            }}
            activeDot={{
              r: 5.5,
              fill: accentColor,
              stroke: themeMode === "dark" ? "#ffffff" : "#14121e",
              strokeWidth: 2,
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
