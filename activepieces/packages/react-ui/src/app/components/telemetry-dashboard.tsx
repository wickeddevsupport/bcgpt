import React, { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowUpRight, TrendingUp, AlertTriangle, Zap } from 'lucide-react'

interface PlatformTelemetry {
    totalExecutions: number
    successfulExecutions: number
    failedExecutions: number
    successRate: number
    medianExecutionMs: number | null
    p95ExecutionMs: number | null
    p99ExecutionMs: number | null
}

interface TopApp {
    appId: string
    executionCount: number
    successCount: number
    failureCount: number
    successRate: number
}

interface ExecutionDistribution {
    distribution: Record<string, number>
}

const formatMs = (ms: number | null): string => {
    if (ms === null) return 'N/A'
    if (ms < 1000) return `${Math.round(ms)}ms`
    return `${(ms / 1000).toFixed(2)}s`
}

const formatPercent = (value: number): string => {
    return `${Math.round(value * 10) / 10}%`
}

export function TelemetryDashboard(): React.JSX.Element {
    // Fetch platform telemetry
    const { data: telemetry, isLoading: isTelemetryLoading } =
        useQuery<PlatformTelemetry>({
            queryKey: ['telemetry', 'platform'],
            queryFn: async () => {
                const res = await fetch('/api/flow-gallery/telemetry/platform')
                if (!res.ok) throw new Error('Failed to fetch telemetry')
                return res.json()
            },
            refetchInterval: 30000, // Refresh every 30s
        })

    // Fetch top apps
    const { data: topAppsData, isLoading: isTopAppsLoading } = useQuery<{
        apps: TopApp[]
    }>({
        queryKey: ['telemetry', 'top-apps'],
        queryFn: async () => {
            const res = await fetch('/api/flow-gallery/telemetry/top-apps')
            if (!res.ok) throw new Error('Failed to fetch top apps')
            return res.json()
        },
        refetchInterval: 30000,
    })

    // Fetch execution distribution
    const { data: distributionData, isLoading: isDistributionLoading } =
        useQuery<ExecutionDistribution>({
            queryKey: ['telemetry', 'execution-distribution'],
            queryFn: async () => {
                const res = await fetch(
                    '/api/flow-gallery/telemetry/execution-distribution',
                )
                if (!res.ok) throw new Error('Failed to fetch distribution')
                return res.json()
            },
            refetchInterval: 30000,
        })

    const isLoading =
        isTelemetryLoading || isTopAppsLoading || isDistributionLoading

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-8">
                <div className="text-muted-foreground">Loading telemetry...</div>
            </div>
        )
    }

    const successRate = telemetry?.successRate ?? 0
    const failureRate = 100 - successRate

    return (
        <div className="space-y-6 p-6">
            <div>
                <h1 className="text-3xl font-bold">Apps Platform Telemetry</h1>
                <p className="text-sm text-muted-foreground">
                    Real-time metrics and performance analytics
                </p>
            </div>

            {/* High-Level Stats */}
            <div className="grid gap-4 md:grid-cols-4">
                {/* Total Executions */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            Total Executions
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {telemetry?.totalExecutions ?? 0}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Cumulative app runs
                        </p>
                    </CardContent>
                </Card>

                {/* Success Rate */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="flex items-center justify-between text-sm font-medium text-muted-foreground">
                            Success Rate
                            <TrendingUp className="size-4" />
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div
                            className={`text-2xl font-bold ${
                                successRate >= 95
                                    ? 'text-green-600'
                                    : successRate >= 80
                                      ? 'text-yellow-600'
                                      : 'text-red-600'
                            }`}
                        >
                            {formatPercent(successRate)}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            {telemetry?.successfulExecutions ?? 0} successful
                        </p>
                    </CardContent>
                </Card>

                {/* Median Time */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            Median Time
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {formatMs(telemetry?.medianExecutionMs ?? null)}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            50th percentile
                        </p>
                    </CardContent>
                </Card>

                {/* P95 Time */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            P95 Time
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {formatMs(telemetry?.p95ExecutionMs ?? null)}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            95th percentile
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Execution Distribution (Histogram) */}
            <Card>
                <CardHeader>
                    <CardTitle>Execution Time Distribution</CardTitle>
                    <CardDescription>
                        Successful app runs grouped by execution time
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {Object.entries(
                            distributionData?.distribution ?? {},
                        ).map(([bucket, count]) => {
                            const maxCount = Math.max(
                                ...Object.values(
                                    distributionData?.distribution ?? {},
                                ),
                            )
                            const percentage =
                                maxCount > 0 ? (count / maxCount) * 100 : 0

                            return (
                                <div key={bucket}>
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="font-medium">
                                            {bucket}
                                        </span>
                                        <span className="text-muted-foreground">
                                            {count}
                                        </span>
                                    </div>
                                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                                        <div
                                            className="h-full bg-blue-500 transition-all duration-300"
                                            style={{
                                                width: `${percentage}%`,
                                            }}
                                        />
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </CardContent>
            </Card>

            {/* Top Apps Table */}
            <Card>
                <CardHeader>
                    <CardTitle>Top Apps by Usage</CardTitle>
                    <CardDescription>
                        Most executed apps in last 24 hours
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b">
                                    <th className="px-4 py-2 text-left font-medium">
                                        App ID
                                    </th>
                                    <th className="px-4 py-2 text-right font-medium">
                                        Executions
                                    </th>
                                    <th className="px-4 py-2 text-right font-medium">
                                        Success Rate
                                    </th>
                                    <th className="px-4 py-2 text-right font-medium">
                                        Failed
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {(topAppsData?.apps ?? []).map((app) => (
                                    <tr
                                        key={app.appId}
                                        className="border-b hover:bg-slate-50"
                                    >
                                        <td
                                            className="px-4 py-3 font-mono text-xs"
                                            title={app.appId}
                                        >
                                            {app.appId.substring(0, 8)}...
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {app.executionCount}
                                        </td>
                                        <td
                                            className={`px-4 py-3 text-right font-medium ${
                                                app.successRate >= 95
                                                    ? 'text-green-600'
                                                    : app.successRate >= 80
                                                      ? 'text-yellow-600'
                                                      : 'text-red-600'
                                            }`}
                                        >
                                            {formatPercent(
                                                app.successRate,
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {app.failureCount > 0 ? (
                                                <span className="inline-flex items-center gap-1 rounded bg-red-50 px-2 py-1 text-red-700">
                                                    <AlertTriangle className="size-3" />
                                                    {app.failureCount}
                                                </span>
                                            ) : (
                                                <span className="text-muted-foreground">
                                                    0
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {(!topAppsData?.apps || topAppsData.apps.length === 0) && (
                        <div className="py-8 text-center text-muted-foreground">
                            No app executions yet
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
