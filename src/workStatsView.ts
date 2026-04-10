import { App, ItemView, Modal, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import WorkHourStatsPlugin from "./main";
import {
  WorkDayRecord,
  dateKeyFromDate,
  getMonthMetadata,
  getMonthTotalHours,
  getExpectedMonthlyHours,
} from "./workStats";

const HOUR_HEAT_COLORS = [
  "var(--work-heat-neutral, var(--background-modifier-border))",
  "color-mix(in srgb, var(--color-accent) 20%, #ffffff)",
  "color-mix(in srgb, var(--color-accent) 35%, #ffffff)",
  "color-mix(in srgb, var(--color-accent) 50%, #ffffff)",
  "color-mix(in srgb, var(--color-accent) 65%, var(--background-primary))",
  "color-mix(in srgb, var(--color-accent) 80%, var(--background-secondary))",
  "color-mix(in srgb, var(--color-accent) 90%, rgba(255, 255, 255, 0.05))",
  "color-mix(in srgb, var(--color-accent) 95%, rgba(0, 0, 0, 0.1))",
  "color-mix(in srgb, var(--color-accent) 100%, rgba(0, 0, 0, 0.25))",
];

export const VIEW_TYPE_WORK_STATS = "work-stats-view";

export class WorkStatsView extends ItemView {
  private currentMonth: Date;
  private unsubscribe?: () => void;
  private popover?: HTMLElement;
  private popoverUnsubs: Array<() => void> = [];

  constructor(leaf: WorkspaceLeaf, private plugin: WorkHourStatsPlugin) {
    super(leaf);
    const now = new Date();
    this.currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  getViewType() {
    return VIEW_TYPE_WORK_STATS;
  }

  getDisplayText() {
    return "Work hours";
  }

  getIcon() {
    return "bar-chart-2";
  }

  async onOpen() {
    this.containerEl.empty();
    this.containerEl.classList.add("work-stats-view");
    this.render();
    this.unsubscribe = this.plugin.onStatsChanged(() => this.render());
  }

  async onClose() {
    this.containerEl.empty();
    this.unsubscribe?.();
    this.closePopover();
  }

  private render() {
    const container = this.containerEl;
    container.empty();
    container.createEl("div", { cls: "work-stats-bg" });

    const shell = container.createEl("div", { cls: "work-stats-shell" });
    const header = shell.createEl("div", { cls: "work-stats-header" });
    const monthName = this.currentMonth.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
    });
    header.createEl("h2", { text: monthName });

    const controls = header.createEl("div", { cls: "work-stats-controls" });
    const totalHours = getMonthTotalHours(
      this.plugin.records,
      this.currentMonth.getFullYear(),
      this.currentMonth.getMonth(),
    );
    const expectedHours = getExpectedMonthlyHours(
      this.currentMonth.getFullYear(),
      this.currentMonth.getMonth(),
      this.plugin.settings.workingDaysPerWeek,
      this.plugin.settings.hoursPerDay,
    );
    const slackHours = Math.max(expectedHours - totalHours, 0);
    const utilization = expectedHours > 0 ? totalHours / expectedHours : 0;
    const buttons = controls.createEl("div", { cls: "work-stats-month-switch" });
    const prevBtn = buttons.createEl("button", { text: "‹" });
    prevBtn.addEventListener("click", () => {
      this.shiftMonth(-1);
    });
    const todayBtn = buttons.createEl("button", { text: "Today" });
    todayBtn.addEventListener("click", () => {
      const now = new Date();
      this.currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      this.render();
    });
    const nextBtn = buttons.createEl("button", { text: "›" });
    nextBtn.addEventListener("click", () => {
      this.shiftMonth(1);
    });

    this.renderLegend(shell);
    this.renderHeatmap(shell);

    const dashboard = container.createEl("div", { cls: "work-stats-dashboard" });

    const actions = dashboard.createEl("div", { cls: "work-stats-actions" });
    actions.createEl("h3", { text: "Actions" });
    const buttonsRow = actions.createEl("div", { cls: "work-stats-actions-row" });

    const fillButton = buttonsRow.createEl("button", { cls: "work-stats-icon-button" });
    fillButton.setAttribute("aria-label", "Fill expected hours");
    fillButton.setAttribute("title", "Fill expected hours");
    setIcon(fillButton, "clipboard-paste");
    fillButton.addEventListener("click", () => {
      new FillMonthModal(
        this.app,
        this.currentMonth,
        this.plugin.settings.workingDaysPerWeek,
        this.plugin.settings.hoursPerDay,
        async () => {
          await this.fillCurrentMonthWithExpectedHours();
        },
      ).open();
    });

    const clearButton = buttonsRow.createEl("button", { cls: "work-stats-icon-button" });
    clearButton.setAttribute("aria-label", "Clear this month" );
    clearButton.setAttribute("title", "Clear this month" );
    setIcon(clearButton, "trash-2");
    clearButton.addEventListener("click", () => {
      new ClearMonthModal(
        this.app,
        this.currentMonth,
        async () => {
          await this.clearCurrentMonthRecords();
        },
      ).open();
    });

    const settingsButton = buttonsRow.createEl("button", { cls: "work-stats-icon-button" });
    settingsButton.setAttribute("aria-label", "Open plugin settings");
    settingsButton.setAttribute("title", "Open plugin settings");
    setIcon(settingsButton, "settings");
    settingsButton.addEventListener("click", () => {
      this.openSettingsTab();
    });

    const summary = dashboard.createEl("div", { cls: "work-stats-summary" });
    summary.createEl("h3", { text: "This month" });
    summary.createEl("p", { text: `${formatHours(totalHours)} work hours` });
    const meta = summary.createEl("div", { cls: "work-stats-summary-meta" });
    const progressPercent = utilization * 100;
    const progressText = progressPercent.toFixed(expectedHours > 0 && progressPercent < 100 ? 1 : 0);
    meta.createSpan({
      cls: `work-stats-fulfillment ${getFulfillmentClass(progressPercent)}`,
      text: `Progress ${progressText}%`,
    });
    meta.createSpan({ text: ` · Slack off ${formatHours(slackHours)}h` });

  }

  private renderLegend(parent: HTMLElement) {
    const legend = parent.createEl("div", { cls: "work-stats-legend" });
    legend.createEl("span", { text: "Cool" });
    const scale = legend.createEl("div", { cls: "work-stats-legend-scale" });
    const legendHours = [1, 2, 3, 5, 8];
    legendHours.forEach((hours) => {
      const chip = scale.createEl("div", { cls: "work-stats-legend-chip" });
      chip.style.setProperty("--legend-color", this.getColorForHours(hours));
      chip.setAttribute("aria-label", `${hours}h`);
    });
    legend.createEl("span", { text: "Busy" });
  }

  private renderHeatmap(parent: HTMLElement) {
    const grid = parent.createEl("div", { cls: "work-stats-grid" });
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const head = grid.createEl("div", { cls: "work-stats-grid-head" });
    weekdays.forEach((day) => {
      head.createEl("div", { cls: "work-stats-grid-label", text: day });
    });

    const body = grid.createEl("div", { cls: "work-stats-grid-body" });
    const { daysInMonth, firstWeekday } = getMonthMetadata(this.currentMonth);
    let dayCounter = 1;
    const slotsPerWeek = 7;
    const rows = Math.ceil((daysInMonth + firstWeekday) / slotsPerWeek);

    for (let row = 0; row < rows; row++) {
      const rowEl = body.createEl("div", { cls: "work-stats-week" });
      for (let col = 0; col < slotsPerWeek; col++) {
        const cell = rowEl.createEl("div", { cls: "work-stats-day" });
        const cellIndex = row * slotsPerWeek + col;
        if (cellIndex < firstWeekday || dayCounter > daysInMonth) {
          cell.classList.add("is-empty");
          continue;
        }
        const date = new Date(
          this.currentMonth.getFullYear(),
          this.currentMonth.getMonth(),
          dayCounter,
        );
        this.decorateDayCell(cell, date);
        dayCounter++;
      }
    }
  }

  private decorateDayCell(cell: HTMLElement, date: Date) {
    const key = dateKeyFromDate(date);
    const record = this.plugin.records.records[key];
    const label = cell.createEl("div", { cls: "work-stats-day-number", text: String(date.getDate()) });
    const detail = cell.createEl("div", { cls: "work-stats-day-detail" });
    const detailValue = detail.createSpan({ cls: "work-stats-day-hours-value" });
    const detailUnit = detail.createSpan({ cls: "work-stats-day-hours-unit", text: "h" });

    const hours = record?.hours ?? 0;
    const hasHours = hours > 0;
    const isOvertime = hasHours && hours >= 9;
    const effectiveHours = isOvertime ? 9 : hours;
    const ratio = Math.min(1, effectiveHours / 8);
    let displayRatio = ratio;
    let color: string | undefined;
    if (hasHours) {
      color = this.getColorForHours(Math.min(8, hours));
      if (hours === 8) {
        displayRatio = 1.15;
      }
    }
    if (color) {
      cell.style.setProperty("--work-stats-color", color);
      cell.style.setProperty("--work-stats-intensity", displayRatio.toString());
      const ink = displayRatio >= 0.6 ? "var(--text-on-accent, #fff)" : "#1b1f29";
      cell.style.setProperty("--work-stats-text", ink);
    } else {
      cell.style.setProperty("--work-stats-text", "var(--text-muted)");
      cell.style.setProperty("--work-stats-intensity", "0");
    }
    if (hasHours) {
      detailValue.setText(isOvertime ? "8+" : String(hours));
      detailUnit.setText("h");
      cell.classList.add("has-data");
      if (isOvertime) {
        cell.classList.add("is-overtime");
      }
    } else {
      detailValue.setText("0");
      detailUnit.setText("h");
      cell.classList.add("is-zero");
    }

    if (this.isToday(date)) {
      cell.classList.add("is-today");
      label.append(" ·");
    }

    cell.addEventListener("click", (event) => {
      event.stopPropagation();
      this.openPopover(cell, date);
    });
  }

  private shiftMonth(delta: number) {
    this.currentMonth = new Date(
      this.currentMonth.getFullYear(),
      this.currentMonth.getMonth() + delta,
      1,
    );
    this.render();
  }

  private isToday(date: Date) {
    const now = new Date();
    return (
      now.getFullYear() === date.getFullYear() &&
      now.getMonth() === date.getMonth() &&
      now.getDate() === date.getDate()
    );
  }

  private getColorForHours(hours: number): string {
    const index = Math.max(0, Math.min(8, Math.round(hours)));
    return (HOUR_HEAT_COLORS[index] ?? HOUR_HEAT_COLORS[HOUR_HEAT_COLORS.length - 1]) as string;
  }

  private openPopover(cell: HTMLElement, date: Date) {
    this.closePopover();
    const popover = document.body.createDiv({ cls: "work-stats-popover" });
    this.popover = popover;

    const dateLabel = popover.createEl("div", { cls: "work-stats-popover-date" });
    dateLabel.setText(
      date.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    );

    const form = popover.createEl("form", { cls: "work-stats-popover-form" });
    const selectWrapper = form.createEl("label", { cls: "work-stats-popover-field" });
    selectWrapper.createEl("span", { text: "Hours" });
    const select = selectWrapper.createEl("select");
    for (let i = 0; i <= 8; i++) {
      const option = document.createElement("option");
      option.value = String(i);
      option.text = `${i} h`;
      select.appendChild(option);
    }
    const overtimeOption = document.createElement("option");
    overtimeOption.value = "9";
    overtimeOption.text = "8+ h";
    select.appendChild(overtimeOption);

    const key = dateKeyFromDate(date);
    const existing = this.plugin.records.records[key];
    if (existing) {
      select.value = existing.hours >= 9 ? "9" : String(existing.hours);
    } else {
      select.value = "0";
    }

    const actions = form.createEl("div", { cls: "work-stats-popover-actions" });
    const saveBtn = actions.createEl("button", { text: "Save", cls: "primary" });
    saveBtn.type = "submit";
    const clearBtn = actions.createEl("button", { text: "Clear", type: "button" });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const hoursChoice = Number(select.value);
      const record: WorkDayRecord = { hours: hoursChoice };
      await this.plugin.saveRecord(key, record);
      this.closePopover();
    });

    clearBtn.addEventListener("click", async () => {
      select.value = "0";
      await this.plugin.saveRecord(key, { hours: 0 });
      new Notice("Logged as 0 hours");
      this.closePopover();
    });

    const rect = cell.getBoundingClientRect();
    const width = 240;
    popover.style.width = `${width}px`;
    const { height } = popover.getBoundingClientRect();
    const padding = 12;
    const candidateTop = rect.top + window.scrollY + rect.height / 2 - height / 2;
    const candidateLeft = rect.left + window.scrollX + rect.width / 2 - width / 2;
    const maxTop = window.scrollY + window.innerHeight - height - padding;
    const maxLeft = window.scrollX + window.innerWidth - width - padding;
    const top = Math.max(window.scrollY + padding, Math.min(candidateTop, maxTop));
    const left = Math.max(window.scrollX + padding, Math.min(candidateLeft, maxLeft));
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;

    const onClick = (event: MouseEvent) => {
      if (!popover.contains(event.target as Node)) {
        this.closePopover();
      }
    };
    document.addEventListener("mousedown", onClick, true);
    this.popoverUnsubs.push(() => document.removeEventListener("mousedown", onClick, true));

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        this.closePopover();
      }
    };
    document.addEventListener("keydown", onKey, true);
    this.popoverUnsubs.push(() => document.removeEventListener("keydown", onKey, true));
  }

  private closePopover() {
    if (this.popover && this.popover.isConnected) {
      this.popover.remove();
    }
    this.popover = undefined;
    while (this.popoverUnsubs.length) {
      const dispose = this.popoverUnsubs.pop();
      dispose?.();
    }
  }

  private async fillCurrentMonthWithExpectedHours() {
    await this.plugin.fillMonthWithExpectedHours(
      this.currentMonth.getFullYear(),
      this.currentMonth.getMonth(),
    );
    new Notice("Month filled with expected hours");
  }

  private async clearCurrentMonthRecords() {
    await this.plugin.clearMonth(
      this.currentMonth.getFullYear(),
      this.currentMonth.getMonth(),
    );
    new Notice("Month cleared");
  }

  private openSettingsTab() {
    const pluginAny = this.plugin as unknown as { openSettingTab?: () => void };
    if (typeof pluginAny.openSettingTab === "function") {
      pluginAny.openSettingTab();
    } else {
      const setting = (this.app as any).setting;
      if (setting?.openTabById) {
        setting.openTabById(this.plugin.manifest.id);
      } else {
        new Notice("Open Settings → Community plugins → Work Hours Stats");
      }
    }
  }
}

class FillMonthModal extends Modal {
  constructor(
    app: App,
    private month: Date,
    private workingDaysPerWeek: number,
    private hoursPerDay: number,
    private onConfirm: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    const monthLabel = this.month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    this.titleEl.setText(`Fill ${monthLabel}?`);
    contentEl.empty();
    contentEl.createEl("p", {
      text: `This replaces every day in ${monthLabel} with your scheduled hours.`,
    });
    contentEl.createEl("p", {
      cls: "work-stats-fill-details",
      text: `Weekly schedule: ${Math.min(Math.max(this.workingDaysPerWeek, 0), 7)} days · ${this.hoursPerDay}h/day`,
    });

    const actions = contentEl.createDiv({ cls: "work-stats-modal-actions" });
    const confirmButton = actions.createEl("button", { text: "Fill" });
    confirmButton.addEventListener("click", async () => {
      await this.onConfirm();
      this.close();
    });

    const cancelButton = actions.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class ClearMonthModal extends Modal {
  constructor(
    app: App,
    private month: Date,
    private onConfirm: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    const monthLabel = this.month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    this.titleEl.setText(`Clear ${monthLabel}?`);
    contentEl.empty();
    contentEl.createEl("p", {
      text: `This removes every entry in ${monthLabel}.`,
    });
    const actions = contentEl.createDiv({ cls: "work-stats-modal-actions" });
    actions.createEl("button", { text: "Clear" }).addEventListener("click", async () => {
      await this.onConfirm();
      this.close();
    });
    actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function formatHours(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function getFulfillmentClass(percent: number): string {
  if (percent >= 90) {
    return "is-high";
  }
  if (percent >= 75) {
    return "is-mid";
  }
  if (percent >= 50) {
    return "is-low";
  }
  return "is-very-low";
}
