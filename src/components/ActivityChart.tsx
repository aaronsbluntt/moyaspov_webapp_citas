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
  onSelectDate?: (dateIso: string) => void;
}

export function ActivityChart({
  data,
  metric = "totalEvents",
  onSelectDate,
}: ActivityChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="h-[220px] flex items-center justify-center text-xs text-zinc-500">
        Sin actividad registrada en este periodo.
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
            stroke="rgba(255,255,255,0.04)"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            stroke="#71717a"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke="#71717a"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ stroke: "rgba(217, 98, 153, 0.25)", strokeWidth: 1 }}
            contentStyle={{
              backgroundColor: "rgba(24, 20, 38, 0.96)",
              borderColor: "rgba(217, 98, 153, 0.35)",
              borderRadius: "12px",
              boxShadow: "0 10px 25px rgba(0, 0, 0, 0.6)",
              color: "#f4f4f5",
              fontSize: "12px",
            }}
            labelStyle={{ color: "#D96299", fontWeight: 600, marginBottom: 2 }}
          />
          <Line
            type="monotone"
            dataKey={metric === "totalEvents" ? "totalEvents" : "hoursBooked"}
            name={metric === "totalEvents" ? "Citas" : "Horas"}
            stroke="#D96299"
            strokeWidth={2.5}
            dot={{ r: 3.5, fill: "#D96299", strokeWidth: 2, stroke: "#181426" }}
            activeDot={{
              r: 5.5,
              fill: "#F5A3C7",
              stroke: "#D96299",
              strokeWidth: 2,
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
