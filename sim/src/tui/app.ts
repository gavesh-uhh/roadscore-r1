/**
 * Interactive Terminal UI Application & Input Controller
 */

import readline from 'node:readline';
import { ANSI } from './ansi.js';
import { renderDashboard } from './views/dashboard.js';
import { renderDriverDetail } from './views/driver-detail.js';
import { renderAddDriver, SPEED_PROFILES, type AddDriverFormState } from './views/add-driver.js';
import { EVENT_OPTIONS, renderTriggerEvent } from './views/trigger-event.js';
import { renderScenarios } from './views/scenarios.js';
import { renderTelemetryMonitor } from './views/telemetry-mon.js';
import { renderRouteManagement } from './views/route-mgmt.js';
import { renderLogViewer } from './views/log-viewer.js';
import { SimulationEngine } from '../core/simulation.js';
import { fetchOsrmRoute } from '../routing/osrm.js';
import { SRI_LANKA_PLACES } from '../routing/places.js';
import { PREDEFINED_SCENARIOS } from '../core/scenarios.js';
import { getAllCachedRoutes } from '../routing/cache.js';
import type { TuiView } from '../types.js';

export class SimulatorTuiApp {
  private engine: SimulationEngine;
  private currentView: TuiView = 'dashboard';
  private selectedDriverIdx = 0;
  private selectedScenarioIdx = 0;
  private selectedEventIdx = 0;
  private selectedRouteIdx = 0;
  private logScrollOffset = 0;

  private addDriverForm: AddDriverFormState = {
    driverId: 'driver-04',
    vehicleId: 'ROADSCORE_004',
    originIndex: 0,
    destIndex: 6,
    speedProfileIndex: 0,
    activeField: 'driverId',
    isRouting: false,
  };

  private renderTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastRenderedOutput = '';

  constructor(engine: SimulationEngine) {
    this.engine = engine;
  }

  public async start(): Promise<void> {
    this.isRunning = true;

    // Load initial default scenario (Normal Fleet: 3 drivers) if no drivers active
    if (this.engine.getAllDrivers().length === 0) {
      await this.engine.loadScenario('normal_fleet');
    }

    this.engine.start();

    // Setup terminal raw mode & keyboard listeners
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      readline.emitKeypressEvents(process.stdin);
      process.stdin.on('keypress', this.handleKeypress.bind(this));
    }

    // Handle terminal resize
    process.stdout.on('resize', () => {
      this.render();
    });

    // Enter alternate screen and hide cursor
    process.stdout.write(ANSI.enterAltScreen + ANSI.hideCursor);

    // Initial render and recurring UI refresh timer (100ms)
    this.render();
    this.renderTimer = setInterval(() => {
      this.render();
    }, 100);
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.renderTimer) {
      clearInterval(this.renderTimer);
      this.renderTimer = null;
    }

    this.engine.stop();

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }

    // Restore terminal cursor & exit alternate screen
    process.stdout.write(ANSI.showCursor + ANSI.exitAltScreen);
    process.exit(0);
  }

  private render(): void {
    if (!this.isRunning) return;

    const termCols = process.stdout.columns || 80;
    const termRows = process.stdout.rows || 24;
    const boxWidth = Math.min(termCols, 76);

    const stats = this.engine.getStats();
    const drivers = this.engine.getAllDriverStates();
    const logs = this.engine.getLogs(100);

    let outputLines: string[] = [];

    switch (this.currentView) {
      case 'dashboard':
        outputLines = renderDashboard(stats, drivers, this.selectedDriverIdx, logs, boxWidth);
        break;

      case 'driver_detail': {
        const driver = drivers[this.selectedDriverIdx] || drivers[0];
        if (driver) {
          outputLines = renderDriverDetail(driver, boxWidth);
        } else {
          this.currentView = 'dashboard';
          outputLines = renderDashboard(stats, drivers, this.selectedDriverIdx, logs, boxWidth);
        }
        break;
      }

      case 'add_driver':
        outputLines = renderAddDriver(this.addDriverForm, boxWidth);
        break;

      case 'trigger_event': {
        const targetDriver = drivers[this.selectedDriverIdx] || drivers[0];
        const driverId = targetDriver ? targetDriver.driverId : 'driver-01';
        outputLines = renderTriggerEvent(driverId, this.selectedEventIdx, boxWidth);
        break;
      }

      case 'scenarios':
        outputLines = renderScenarios(this.selectedScenarioIdx, boxWidth);
        break;

      case 'telemetry':
        outputLines = renderTelemetryMonitor(drivers, logs, boxWidth);
        break;

      case 'routes':
        outputLines = renderRouteManagement(this.selectedRouteIdx, boxWidth);
        break;

      case 'logs':
        outputLines = renderLogViewer(logs, this.logScrollOffset, Math.max(8, termRows - 10), boxWidth);
        break;

      default:
        outputLines = renderDashboard(stats, drivers, this.selectedDriverIdx, logs, boxWidth);
        break;
    }

    const fullText = ANSI.cursorHome + outputLines.join('\n') + '\n';
    if (fullText !== this.lastRenderedOutput) {
      process.stdout.write(fullText);
      this.lastRenderedOutput = fullText;
    }
  }

  private handleKeypress(str: string, key: readline.Key): void {
    if (!key) return;

    // Global Quit
    if (key.ctrl && key.name === 'c') {
      this.stop();
      return;
    }

    if (this.currentView === 'dashboard') {
      this.handleDashboardKeys(str, key);
    } else if (this.currentView === 'driver_detail') {
      this.handleDriverDetailKeys(str, key);
    } else if (this.currentView === 'add_driver') {
      this.handleAddDriverKeys(str, key);
    } else if (this.currentView === 'trigger_event') {
      this.handleTriggerEventKeys(str, key);
    } else if (this.currentView === 'scenarios') {
      this.handleScenarioKeys(str, key);
    } else if (this.currentView === 'telemetry') {
      this.handleTelemetryKeys(str, key);
    } else if (this.currentView === 'routes') {
      this.handleRouteKeys(str, key);
    } else if (this.currentView === 'logs') {
      this.handleLogKeys(str, key);
    }
  }

  private handleDashboardKeys(str: string, key: readline.Key): void {
    const drivers = this.engine.getAllDrivers();

    if (key.name === 'q') {
      this.stop();
      return;
    }

    if (key.name === 'space') {
      this.engine.togglePause();
      return;
    }

    if (str === '+' || str === '=') {
      this.engine.increaseSpeed();
      return;
    }

    if (str === '-' || str === '_') {
      this.engine.decreaseSpeed();
      return;
    }

    if (key.name === 'a') {
      const nextNum = drivers.length + 1;
      this.addDriverForm = {
        driverId: `driver-${String(nextNum).padStart(2, '0')}`,
        vehicleId: `ROADSCORE_${String(nextNum).padStart(3, '0')}`,
        originIndex: (nextNum - 1) % SRI_LANKA_PLACES.length,
        destIndex: (nextNum + 5) % SRI_LANKA_PLACES.length,
        speedProfileIndex: 0,
        activeField: 'driverId',
        isRouting: false,
      };
      this.currentView = 'add_driver';
      return;
    }

    if (key.name === 'd' || key.name === 'return') {
      if (drivers.length > 0) {
        this.currentView = 'driver_detail';
      }
      return;
    }

    if (key.name === 'r') {
      this.currentView = 'routes';
      return;
    }

    if (key.name === 's') {
      this.currentView = 'scenarios';
      return;
    }

    if (key.name === 'e') {
      if (drivers.length > 0) {
        this.currentView = 'trigger_event';
      }
      return;
    }

    if (key.name === 't') {
      this.currentView = 'telemetry';
      return;
    }

    if (key.name === 'l') {
      this.currentView = 'logs';
      return;
    }

    if (key.name === 'c') {
      this.engine.clearLogs();
      return;
    }

    if (key.name === 'p') {
      const d = drivers[this.selectedDriverIdx];
      if (d) {
        this.engine.toggleDriverPause(d.driverId);
      }
      return;
    }

    if (key.name === 'up') {
      if (this.selectedDriverIdx > 0) {
        this.selectedDriverIdx--;
      }
      return;
    }

    if (key.name === 'down') {
      if (this.selectedDriverIdx < drivers.length - 1) {
        this.selectedDriverIdx++;
      }
      return;
    }
  }

  private handleDriverDetailKeys(str: string, key: readline.Key): void {
    const drivers = this.engine.getAllDrivers();
    const currentDriver = drivers[this.selectedDriverIdx];

    if (key.name === 'escape' || key.name === 'backspace' || key.name === 'd') {
      this.currentView = 'dashboard';
      return;
    }

    if (key.name === 'p' && currentDriver) {
      this.engine.toggleDriverPause(currentDriver.driverId);
      return;
    }

    if (key.name === 'e' && currentDriver) {
      this.currentView = 'trigger_event';
      return;
    }

    if (key.name === 'left' || key.name === 'up') {
      if (this.selectedDriverIdx > 0) {
        this.selectedDriverIdx--;
      }
      return;
    }

    if (key.name === 'right' || key.name === 'down') {
      if (this.selectedDriverIdx < drivers.length - 1) {
        this.selectedDriverIdx++;
      }
      return;
    }
  }

  private handleAddDriverKeys(str: string, key: readline.Key): void {
    if (key.name === 'escape') {
      this.currentView = 'dashboard';
      return;
    }

    const fields: AddDriverFormState['activeField'][] = ['driverId', 'vehicleId', 'origin', 'dest', 'profile', 'submit'];
    const curIdx = fields.indexOf(this.addDriverForm.activeField);

    if (key.name === 'tab' || key.name === 'down') {
      const nextIdx = (curIdx + 1) % fields.length;
      this.addDriverForm.activeField = fields[nextIdx]!;
      return;
    }

    if (key.name === 'up') {
      const prevIdx = (curIdx - 1 + fields.length) % fields.length;
      this.addDriverForm.activeField = fields[prevIdx]!;
      return;
    }

    if (this.addDriverForm.activeField === 'origin') {
      if (key.name === 'left') {
        this.addDriverForm.originIndex =
          (this.addDriverForm.originIndex - 1 + SRI_LANKA_PLACES.length) % SRI_LANKA_PLACES.length;
      } else if (key.name === 'right') {
        this.addDriverForm.originIndex =
          (this.addDriverForm.originIndex + 1) % SRI_LANKA_PLACES.length;
      }
      return;
    }

    if (this.addDriverForm.activeField === 'dest') {
      if (key.name === 'left') {
        this.addDriverForm.destIndex =
          (this.addDriverForm.destIndex - 1 + SRI_LANKA_PLACES.length) % SRI_LANKA_PLACES.length;
      } else if (key.name === 'right') {
        this.addDriverForm.destIndex =
          (this.addDriverForm.destIndex + 1) % SRI_LANKA_PLACES.length;
      }
      return;
    }

    if (this.addDriverForm.activeField === 'profile') {
      if (key.name === 'left') {
        this.addDriverForm.speedProfileIndex =
          (this.addDriverForm.speedProfileIndex - 1 + SPEED_PROFILES.length) % SPEED_PROFILES.length;
      } else if (key.name === 'right') {
        this.addDriverForm.speedProfileIndex =
          (this.addDriverForm.speedProfileIndex + 1) % SPEED_PROFILES.length;
      }
      return;
    }

    if (key.name === 'return') {
      this.submitAddDriver();
      return;
    }
  }

  private async submitAddDriver(): Promise<void> {
    const oPlace = SRI_LANKA_PLACES[this.addDriverForm.originIndex] || SRI_LANKA_PLACES[0]!;
    const dPlace = SRI_LANKA_PLACES[this.addDriverForm.destIndex] || SRI_LANKA_PLACES[6]!;
    const profile = SPEED_PROFILES[this.addDriverForm.speedProfileIndex] || 'normal';

    this.addDriverForm.isRouting = true;
    this.render();

    try {
      const route = await fetchOsrmRoute(
        { lat: oPlace.lat, lon: oPlace.lon },
        { lat: dPlace.lat, lon: dPlace.lon },
        oPlace.name,
        dPlace.name,
      );

      this.engine.addDriver({
        driverId: this.addDriverForm.driverId,
        vehicleId: this.addDriverForm.vehicleId,
        route,
        speedProfile: profile,
        loopOnComplete: true,
      });

      this.addDriverForm.isRouting = false;
      this.currentView = 'dashboard';
      this.selectedDriverIdx = this.engine.getAllDrivers().length - 1;
    } catch (err: any) {
      this.addDriverForm.isRouting = false;
      this.addDriverForm.statusMessage = `Error: ${err.message}`;
    }
  }

  private handleTriggerEventKeys(str: string, key: readline.Key): void {
    if (key.name === 'escape') {
      this.currentView = 'dashboard';
      return;
    }

    if (key.name === 'up') {
      if (this.selectedEventIdx > 0) {
        this.selectedEventIdx--;
      }
      return;
    }

    if (key.name === 'down') {
      if (this.selectedEventIdx < EVENT_OPTIONS.length - 1) {
        this.selectedEventIdx++;
      }
      return;
    }

    if (key.name === 'return') {
      const drivers = this.engine.getAllDrivers();
      const targetDriver = drivers[this.selectedDriverIdx];
      const selectedEvent = EVENT_OPTIONS[this.selectedEventIdx]!;

      if (targetDriver) {
        if (selectedEvent.type === 'normal') {
          this.engine.clearDriverEvent(targetDriver.driverId);
        } else {
          this.engine.triggerDriverEvent(targetDriver.driverId, selectedEvent.type, 5);
        }
      }
      this.currentView = 'dashboard';
      return;
    }
  }

  private async handleScenarioKeys(str: string, key: readline.Key): Promise<void> {
    if (key.name === 'escape') {
      this.currentView = 'dashboard';
      return;
    }

    if (key.name === 'up') {
      if (this.selectedScenarioIdx > 0) {
        this.selectedScenarioIdx--;
      }
      return;
    }

    if (key.name === 'down') {
      if (this.selectedScenarioIdx < PREDEFINED_SCENARIOS.length - 1) {
        this.selectedScenarioIdx++;
      }
      return;
    }

    if (key.name === 'return') {
      const sc = PREDEFINED_SCENARIOS[this.selectedScenarioIdx]!;
      await this.engine.loadScenario(sc.id);
      this.selectedDriverIdx = 0;
      this.currentView = 'dashboard';
      return;
    }
  }

  private handleTelemetryKeys(str: string, key: readline.Key): void {
    if (key.name === 'escape' || key.name === 't') {
      this.currentView = 'dashboard';
      return;
    }
    if (key.name === 'space') {
      this.engine.togglePause();
      return;
    }
    if (key.name === 'e') {
      this.currentView = 'trigger_event';
      return;
    }
  }

  private handleRouteKeys(str: string, key: readline.Key): void {
    const routes = getAllCachedRoutes();
    if (key.name === 'escape' || key.name === 'r') {
      this.currentView = 'dashboard';
      return;
    }
    if (key.name === 'up') {
      if (this.selectedRouteIdx > 0) {
        this.selectedRouteIdx--;
      }
      return;
    }
    if (key.name === 'down') {
      if (this.selectedRouteIdx < routes.length - 1) {
        this.selectedRouteIdx++;
      }
      return;
    }
  }

  private handleLogKeys(str: string, key: readline.Key): void {
    if (key.name === 'escape' || key.name === 'l') {
      this.currentView = 'dashboard';
      return;
    }
    if (key.name === 'c') {
      this.engine.clearLogs();
      return;
    }
    if (key.name === 'up') {
      if (this.logScrollOffset > 0) {
        this.logScrollOffset--;
      }
      return;
    }
    if (key.name === 'down') {
      const logs = this.engine.getLogs(100);
      if (this.logScrollOffset < logs.length - 5) {
        this.logScrollOffset++;
      }
      return;
    }
  }
}
