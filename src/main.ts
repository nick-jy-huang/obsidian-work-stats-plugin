import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, MyPluginSettings, SampleSettingTab } from "./settings";
import { VIEW_TYPE_WORK_STATS, WorkStatsView } from "./workStatsView";
import {
	WorkDayRecord,
	WorkStatsData,
	clampHours,
	dateKeyFromDate,
	getAllowedWeekdays,
} from "./workStats";

// @ts-ignore
interface PersistedData {
	settings: MyPluginSettings;
	records: WorkStatsData;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null;
}

function coerceNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string" && value.trim().length > 0) {
		const coerced = Number(value);
		if (Number.isFinite(coerced)) {
			return coerced;
		}
	}
	return null;
}

function sanitizeSettings(input: unknown): MyPluginSettings {
	const next: MyPluginSettings = { ...DEFAULT_SETTINGS };
	if (isRecord(input)) {
		const workingDays = coerceNumber(input.workingDaysPerWeek);
		if (workingDays !== null) {
			next.workingDaysPerWeek = Math.min(Math.max(Math.round(workingDays), 0), 7);
		}
		const hoursPerDay = coerceNumber(input.hoursPerDay);
		if (hoursPerDay !== null) {
			next.hoursPerDay = Math.min(Math.max(Math.round(hoursPerDay), 1), 24);
		}
	}
	return next;
}

function sanitizeRecords(input: unknown): WorkStatsData {
	const safeRecords: Record<string, WorkDayRecord> = {};
	if (isRecord(input)) {
		for (const [key, value] of Object.entries(input)) {
			if (isRecord(value)) {
				const rawHours = coerceNumber(value.hours ?? value.slots);
				if (rawHours !== null) {
					safeRecords[key] = { hours: clampHours(rawHours) };
				}
			}
		}
	}
	return { records: safeRecords };
}

function parseStoredData(raw: unknown): PersistedData {
	const container = isRecord(raw) ? raw : {};
	const settingsSource = "settings" in container ? container.settings : container;
	const recordsRoot = "records" in container ? container.records : container;
	const recordsSource = isRecord(recordsRoot) && "records" in recordsRoot ? recordsRoot.records : recordsRoot;
	return {
		settings: sanitizeSettings(settingsSource),
		records: sanitizeRecords(recordsSource),
	};
}

export default class WorkHourStatsPlugin extends Plugin {
	settings: MyPluginSettings;
	records: WorkStatsData = { records: {} };
	private statsObservers = new Set<() => void>();

	async onload(): Promise<void> {
		await this.loadPluginData();

		this.addSettingTab(new SampleSettingTab(this.app, this));
		this.addRibbonIcon('clock', 'Open work stats', () => {
			this.activateStatsView();
		});
		this.addCommand({
			id: 'open-work-stats',
			name: 'Open work stats',
			callback: () => this.activateStatsView(),
		});

		this.registerView(VIEW_TYPE_WORK_STATS, (leaf) => new WorkStatsView(leaf, this));
		this.app.workspace.onLayoutReady(() => {
			this.revealExistingView();
		});
	}

	onunload() {
		this.app.workspace.getLeavesOfType(VIEW_TYPE_WORK_STATS).forEach((leaf) => leaf.detach());
	}

	private async loadPluginData(): Promise<void> {
		const stored = await this.loadData();
		const parsed = parseStoredData(stored);
		this.settings = parsed.settings;
		this.records = parsed.records;
	}

	private async persist(): Promise<void> {
		const payload: PersistedData = {
			settings: this.settings,
			records: this.records,
		};
		await this.saveData(payload);
	}

	async saveSettings(): Promise<void> {
		await this.persist();
		this.emitStatsChanged();
	}

	async saveRecord(key: string, record: WorkDayRecord): Promise<void> {
		this.records.records[key] = {
			hours: clampHours(record.hours),
		};
		await this.persist();
		this.emitStatsChanged();
	}

	async clearMonth(year: number, month: number): Promise<void> {
		const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
		for (const key of Object.keys(this.records.records)) {
			if (key.startsWith(prefix)) {
				delete this.records.records[key];
			}
		}
		await this.persist();
		this.emitStatsChanged();
	}

	async fillMonthWithExpectedHours(year: number, month: number): Promise<void> {
		const allowedWeekdays = getAllowedWeekdays(Math.min(Math.max(this.settings.workingDaysPerWeek, 0), 7));
		const targetHours = clampHours(this.settings.hoursPerDay);
		const daysInMonth = new Date(year, month + 1, 0).getDate();
		for (let day = 1; day <= daysInMonth; day++) {
			const date = new Date(year, month, day);
			const key = dateKeyFromDate(date);
			const shouldWork = allowedWeekdays.has(date.getDay());
			this.records.records[key] = {
				hours: shouldWork ? targetHours : 0,
			};
		}
		await this.persist();
		this.emitStatsChanged();
	}

	onStatsChanged(callback: () => void): () => void {
		this.statsObservers.add(callback);
		return () => this.statsObservers.delete(callback);
	}

	private emitStatsChanged(): void {
		for (const listener of this.statsObservers) {
			try {
				listener();
			} catch (err) {
				console.error('work-stats listener failed', err);
			}
		}
	}

	private async activateStatsView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_WORK_STATS)[0];
		if (!leaf) {
			let target = workspace.getRightLeaf(false) ?? workspace.getRightLeaf(true);
			if (!target) {
				return;
			}
			await target.setViewState({ type: VIEW_TYPE_WORK_STATS, active: true });
			leaf = target;
		}
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	private revealExistingView(): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_WORK_STATS);
		if (leaves.length === 0) {
			return;
		}
		const [first] = leaves;
		if (first) {
			this.app.workspace.revealLeaf(first);
		}
	}
}
