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
  themeStyle?: "original" | "cinematic";
  onSelectDate?: (dateIso: string) => void;
}

export function ActivityChart({
  data,
  metric = "totalEvents",
  accentColor = "#D96299",
  themeStyle = "original",
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

  const isCinematic = themeStyle === "cinematic";
  const axisColor = isCinematic ? "#7d7163" : "#71717a";
  const surfaceBg = isCinematic
    ? "rgba(23, 20, 18, 0.96)"
    : "rgba(24, 20, 38, 0.96)";
  const textColor = isCinematic ? "#eae0d0" : "#f5f3f7";
  const dotStroke = isCinematic ? "#171412" : "#181426";

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
              isCinematic
                ? "rgba(234, 224, 208, 0.06)"
                : "rgba(255, 255, 255, 0.05)"
            }
            vertical={false}
          />
          <XAxis
            dataKey="label"
            stroke={axisColor}
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke={axisColor}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ stroke: accentColor, strokeOpacity: 0.3, strokeWidth: 1 }}
            contentStyle={{
              backgroundColor: surfaceBg,
              borderColor: accentColor,
              borderRadius: "12px",
              boxShadow: "0 10px 25px rgba(0, 0, 0, 0.4)",
              color: textColor,
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
              stroke: dotStroke,
            }}
            activeDot={{
              r: 5.5,
              fill: accentColor,
              stroke: textColor,
              strokeWidth: 2,
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
