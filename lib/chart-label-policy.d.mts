export function persistentChartLabel(strategy: string, label: string, mode?: string): boolean;
export function selectCompactChartLabels<T extends {
  strategy: string; isSell: boolean; labelVisible: boolean; labelRendered: boolean;
  observation: { time: string };
}>(markers: T[], scoreOf: (marker: T) => number | null | undefined): T[];
